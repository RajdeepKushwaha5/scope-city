import { TrueForge } from "@truefoundry/trueforge-sdk";
import { iterationLimitFor } from "./reasoning-effort.js";
import type { AgentSpec, McpServerManifest, TurnEvent, TurnInput } from "./types.js";
import { MCP_SERVER_NAME_PATTERN } from "./types.js";
import { qualifiedModelNames, reasoningEffortsByModel, type ModelListEntry } from "./model-names.js";

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

  /**
   * Every model configured on this harness, as fully-qualified `provider/model`.
   *
   * Rotation is worthless if the pool has one entry, and the surest way to end
   * up with one entry is to depend on an environment variable somebody forgot
   * to set -- which is exactly what happened: several keys were registered, the
   * default was a single model, and a rate limit ended the mission with two
   * untouched keys sitting right there.
   *
   * Asking the harness what it has removes that failure entirely.
   */
  async listModels(): Promise<readonly string[]> {
    const response = await this.#client.models.list();
    const data = (response as { data?: ModelListEntry[] }).data ?? [];
    return qualifiedModelNames(data);
  }

  /**
   * What each model says it will accept, not just what it is called.
   *
   * The names alone were enough while every model was the same Gemini behind
   * four keys. They are not once a local model is in the pool: a reasoning
   * effort that Gemini honours is a 400 from Ollama, so the control plane has
   * to know which is which before it builds a spec.
   */
  async listModelCapabilities(): Promise<ReadonlyMap<string, readonly string[]>> {
    const response = await this.#client.models.list();
    const data = (response as { data?: ModelListEntry[] }).data ?? [];
    return reasoningEffortsByModel(data);
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

  /**
   * Whether this harness has a sandbox provider configured.
   *
   * Asked at boot rather than discovered when a mission fails. With
   * `sandbox: { enabled: true }` and no provider, the harness rejects the
   * *session* with a 422, so every mission dies at creation with a message
   * about `PUT /settings/sandbox-providers` that surfaces to the operator as
   * "mission failed" and to the map as nothing at all. Checking once, up
   * front, turns that into a line in the startup log.
   */
  async hasSandboxProvider(): Promise<boolean> {
    try {
      const response = await this.#client.settings.sandboxProviders.get();
      return (response as { data?: unknown }).data !== undefined;
    } catch {
      // The harness answers "no provider configured" with an error rather than
      // an empty body, so a throw here is the expected negative case and not a
      // transport failure worth propagating.
      return false;
    }
  }

  /**
   * Configures Daytona as the sandbox provider.
   *
   * Daytona is the only provider TrueForge 0.1.4 accepts -- the manifest's
   * `type` enum has exactly one member -- so on this build a sandbox means a
   * Daytona key and nothing else will do.
   *
   * The lifecycle fields are taken from the harness's own catalog rather than
   * written here. `GET /catalogs/sandbox-providers` describes itself as presets
   * to copy into the PUT, and copying them is the point: they are all required,
   * and hardcoding a second set of timeouts would silently diverge from the
   * harness's defaults the first time it changed one. Sending our own numbers
   * would also be inventing policy -- how long a sandbox idles before being
   * archived is the harness's business, not ours.
   */
  async configureDaytonaSandbox(apiKey: string): Promise<void> {
    const catalog = await this.#client.catalogs.sandboxProviders.list();
    const presets = ((catalog as { data?: unknown }).data ?? []) as Record<string, unknown>[];
    const preset = presets.find((entry) => entry["type"] === "daytona");

    if (!preset) {
      throw new Error(
        "this harness offers no daytona preset — check /catalogs/sandbox-providers",
      );
    }

    // The catalog answers in wire form (snake_case) while the SDK takes
    // camelCase and converts on the way out, so the preset is translated rather
    // than passed through. Getting this wrong is quiet: the SDK accepts the
    // object, drops the unrecognised keys, and the server rejects the manifest
    // for missing exactly the fields that were just supplied.
    const manifest: Record<string, unknown> = { type: "daytona", auth: { apiKey } };
    for (const [key, value] of Object.entries(preset)) {
      if (key === "type") continue;
      manifest[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    }

    await this.#client.settings.sandboxProviders.createOrUpdate({
      manifest: manifest as never,
    } as never);
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
  /**
   * How hard the model should think, when the operator has said.
   *
   * Passed through to the provider rather than interpreted here. TrueForge
   * validates it against what the registered model declares it supports and
   * refuses the session with a 422 otherwise, which is why this is a real
   * control rather than a label: an effort the model cannot honour never
   * silently becomes an effort it ignores.
   */
  reasoningEffort?: string;
  /**
   * The turn budget, when the caller has to state it rather than let it follow
   * from the effort.
   *
   * These are two settings that happen to share an input. The effort is the
   * provider's; the budget is ours, and a model that accepts no effort still
   * gets one. Deriving the budget from an effort that was dropped because the
   * chosen model refuses it silently promoted every low and medium run to the
   * high ceiling -- and the brief, which reads the operator's original choice,
   * went on promising the smaller number.
   */
  iterationLimit?: number;
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
    model: {
      name: params.model,
      // Omitted entirely when unset. An empty `params` object is accepted and
      // means something different from "no preference" to some providers.
      ...(params.reasoningEffort
        ? { params: { reasoningEffort: params.reasoningEffort } }
        : {}),
    },
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
      // Off, and the reason is the product rather than an oversight.
      //
      // Generative UI lets the model draw into the operator's view. Everything
      // this project argues rests on the operator seeing what the *boundary*
      // did, not what the model says it did -- every building, figure and held
      // gate in the city is a harness event or a proxy decision. Handing the
      // model a channel to render its own account of the mission would put the
      // one untrusted party in the room in charge of the display, which is the
      // contradiction this whole thing exists to avoid.
      generativeUi: { enabled: false },
      // Off for a sharper reason: it is an unbound channel from the model to
      // the operator.
      //
      // The Gate is the human interaction here, and it is bound to one call's
      // exact arguments -- the operator is answering "may this run", about a
      // specific call they can read. A clarifying question is free text with
      // nothing behind it, and the model composing it has just read a support
      // ticket written by a member of the public. An injected instruction that
      // cannot reach a tool can still reach a person: "confirm you want the
      // customer list sent" is a question, not a tool call, and it would arrive
      // looking like the agent asking rather than the attacker.
      askUserQuestions: { enabled: false },
      // Scaled with the effort, not fixed.
      //
      // Effort used to reach only the provider, so an agent asked for "low"
      // still had twenty-four turns to work through the job -- the label
      // described the thinking and not the work. "high" keeps the ceiling every
      // run has had, so only the lower settings change anything.
      iterationLimit: params.iterationLimit ?? iterationLimitFor(params.reasoningEffort),
      /*
       * Both of these are on by default, and were running unstated.
       *
       * Confirmed by asking the server what it stores for this exact spec:
       * with no `contextManagement` sent, it comes back holding
       * `compaction.enabled: true` and `largeToolResponse.enabled: true`.
       * Written out here because a project whose argument is "state what the
       * agent may do" should not be relying on two defaults that change what
       * the model sees and where tool output is kept.
       *
       * Compaction stays on. It replaces older conversation history with a
       * summary once the input passes the trigger, and the thing worth being
       * clear about is that it cannot touch the record: the mission log is
       * built from the harness event stream and the proxy's decisions, not
       * from the model's conversation. A summarised history changes what the
       * agent remembers, never what is attested to have happened. Turning it
       * off would instead cap how long a delegated mission can run before the
       * context fills, which is a real cost for no gain in evidence.
       *
       * Only `enabled` is sent. The documentation describes a
       * `compaction.trigger` of `{ type: "input_tokens", value }`, and this
       * server drops it: an agent created with a non-default trigger of 40000
       * comes back holding `{ "compaction": { "enabled": true } }` and nothing
       * else, in either spelling. Sending it anyway would be the same mistake
       * as the snake_case one warned about above -- a setting that reads as
       * configured and is not. The trigger the run actually gets is whatever
       * the harness defaults to.
       */
      contextManagement: {
        compaction: { enabled: true },
        /*
         * Also on, and it interacts with the boundary in a way worth stating.
         *
         * A tool response over the threshold is written to a file in the
         * sandbox and replaced in context with a short preview and the path.
         * What lands on that disk is whatever the proxy returned -- already
         * projected down to the granted fields and already scanned for
         * injected instructions -- so offloading relocates a response the
         * scope has already filtered rather than smuggling one past it.
         *
         * It does not widen reach, and it is worth being precise about why:
         * `maxResponseBytes` is still enforced by the proxy before any of this
         * happens, so the file can only ever hold what the agent was allowed
         * to receive. Offloading changes how much of it enters the model's
         * context in one step, not how much the agent may have.
         */
        largeToolResponse: { enabled: true },
      },
    },
  };
}
