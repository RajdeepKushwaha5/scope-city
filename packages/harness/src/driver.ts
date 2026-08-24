import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { AgentSpec, McpServerManifest, TurnEvent, TurnInput } from "./types.js";
import { MCP_SERVER_NAME_PATTERN } from "./types.js";

/**
 * Drives a real TrueForge session.
 *
 * Everything above this file is pure and testable; this is the one place that
 * talks to a running harness. It is deliberately thin -- it creates a session,
 * streams turns, and resumes a paused one -- because anything with logic in it
 * belongs upstream where it can be tested without a server.
 *
 * The one piece of judgement here is `resume`. A TrueForge approval is not a
 * callback: the harness pauses the turn and waits for a *new* turn carrying a
 * UserToolApprovalEvent. Callers that expect to answer an event in place will
 * hang forever, so the shape of this API makes that impossible to get wrong.
 */

export interface DriverOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutInSeconds?: number;
}

export class HarnessDriver {
  readonly #client: TrueForge;

  constructor(options: DriverOptions = {}) {
    this.#client = new TrueForge({
      baseUrl: options.baseUrl ?? process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790",
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      timeoutInSeconds: options.timeoutInSeconds ?? 600,
    });
  }

  /**
   * Registers an MCP server so the harness can reach it.
   *
   * This is how Scope City's proxy becomes something the agent can call. The
   * name is validated here rather than at the API, because a 422 halfway
   * through a mission setup is a much worse place to learn that a dot was not
   * allowed.
   */
  async registerMcpServer(manifest: McpServerManifest): Promise<void> {
    if (!MCP_SERVER_NAME_PATTERN.test(manifest.name)) {
      throw new Error(
        `mcp server name ${manifest.name} must match ${MCP_SERVER_NAME_PATTERN} ` +
          `(lowercase, starting with a letter)`,
      );
    }

    // createOrUpdate rather than create: a mission that reconnects should not
    // fail because the proxy from its previous run is still registered.
    await this.#client.settings.mcpServers.createOrUpdate({
      manifest: manifest as never,
    });
  }

  async listMcpServers(): Promise<readonly { name: string }[]> {
    const response = await this.#client.settings.mcpServers.list();
    return ((response as { data?: { name: string }[] }).data ?? []) as { name: string }[];
  }

  /** Opens a session against an inline agent spec. */
  async createSession(spec: AgentSpec): Promise<string> {
    const response = await this.#client.sessions.create({
      agent: { spec: spec as never },
    } as never);

    const id = (response as { data?: { id?: string } }).data?.id;
    if (!id) throw new Error("TrueForge returned a session with no id");
    return id;
  }

  /**
   * Starts a turn and yields every event as it arrives.
   *
   * An async generator rather than a callback so a caller can stop consuming --
   * closing the loop tears the stream down, which is what makes cancelling a
   * mission from the UI possible.
   */
  async *runTurn(
    sessionId: string,
    input: readonly TurnInput[],
  ): AsyncGenerator<TurnEvent, void, undefined> {
    const stream = await this.#client.sessions.createTurnStream(sessionId, {
      input: input as never,
    } as never);

    for await (const event of stream) {
      yield event as TurnEvent;
    }
  }

  /**
   * Resumes a turn paused on tool.approval_required.
   *
   * Structurally identical to starting a turn, because to the harness it *is* a
   * new turn -- the approval is its input. Kept as its own method so the call
   * site reads as what it means.
   */
  async *resume(
    sessionId: string,
    approvals: readonly {
      threadId: string;
      toolCallId: string;
      approved: boolean;
      reason?: string;
    }[],
  ): AsyncGenerator<TurnEvent, void, undefined> {
    const input: TurnInput[] = approvals.map((approval) => ({
      type: "user.tool_approval",
      threadId: approval.threadId,
      toolCallId: approval.toolCallId,
      approval: approval.approved
        ? { status: "allow" }
        : { status: "deny", ...(approval.reason ? { reason: approval.reason } : {}) },
    }));

    yield* this.runTurn(sessionId, input);
  }

  /** Reconnects to a turn already in flight, from its last seen event. */
  async *subscribe(
    sessionId: string,
    turnId: string,
  ): AsyncGenerator<TurnEvent, void, undefined> {
    const stream = await this.#client.sessions.subscribeToTurn(sessionId, turnId);
    for await (const event of stream) {
      yield event as TurnEvent;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#client.sessions.cancel(sessionId, {} as never);
  }

  /**
   * Whether a harness is actually listening, and if not, why.
   *
   * Returning a bare boolean here was a mistake worth not repeating: a health
   * check that says "no" without saying why sends you looking at the network
   * when the answer is in the response body. The reason is always carried.
   */
  async reachable(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.#client.sessions.list();
      return { ok: true };
    } catch (error) {
      const parts: string[] = [];
      if (error instanceof Error) parts.push(error.message);

      const status = (error as { statusCode?: number }).statusCode;
      if (status) parts.push(`status ${status}`);

      const body = (error as { body?: unknown }).body;
      if (body !== undefined && body !== null) {
        parts.push(typeof body === "string" ? body : JSON.stringify(body).slice(0, 200));
      }

      return { ok: false, reason: parts.join(" — ") || "unknown error" };
    }
  }
}

/**
 * The agent spec Scope City runs missions with.
 *
 * `require_approval_for_tools` is what raises The Gate. It is a different
 * mechanism from the proxy's boundary and the distinction matters: this asks a
 * human, the proxy asks nobody. Both are needed -- a scope stops what should
 * never happen, a gate pauses what should happen only once someone has looked.
 */
export function missionAgentSpec(params: {
  model: string;
  proxyName: string;
  instructions: string;
  gatedTools: readonly string[];
  sandbox: boolean;
}): AgentSpec {
  // Every key here is camelCase, and that is not a style choice.
  //
  // The SDK's TypeScript surface is camelCase and converts to snake_case on the
  // wire; the OpenAPI document shows the wire format, so reading the spec and
  // writing what it says produces an object the SDK accepts and then silently
  // drops. An agent spec whose `mcpServers` was spelled `mcp_servers` starts a
  // perfectly healthy session with no tools at all, and nothing anywhere says
  // why. Do not "fix" these to match the OpenAPI document.
  return {
    model: { name: params.model },
    instructions: params.instructions,
    mcpServers: [
      {
        name: params.proxyName,
        // No enable/disable list. The proxy already returns only what the scope
        // allows, and duplicating that here would create a second place for the
        // truth to live.
        requireApprovalForTools: params.gatedTools,
        preload: true,
      },
    ],
    config: {
      sandbox: { enabled: params.sandbox, fileDownloads: false },
      dynamicSubAgents: { enabled: true },
      generativeUi: { enabled: false },
      askUserQuestions: { enabled: false },
      iterationLimit: 24,
    },
  };
}
