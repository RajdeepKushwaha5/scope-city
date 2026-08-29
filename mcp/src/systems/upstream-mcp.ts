import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { OfficeHandler, SystemDefinition } from "./types.js";

/**
 * A district backed by somebody else's MCP server.
 *
 * Every other system here is code in this repository: the Exchequer knows
 * Stripe's API, the Post House knows SMTP. That is fine for showing what a
 * boundary does and useless for showing that the boundary is a boundary rather
 * than three careful implementations. A scope that only holds over systems its
 * author wrote is not an enforcement layer, it is a coding convention.
 *
 * So this connects to an MCP server nobody here wrote, discovers its tools, and
 * exposes the chosen ones as offices. The evaluator, the projector, the ledger
 * and the gate are untouched and never learn what is behind them -- which is
 * the point, and is only demonstrated once something behind them is foreign.
 *
 * Scope City is already an MCP *server*: TrueForge connects to it and sees the
 * offices a scope permits. This makes it a client as well, so the shape is
 *
 *   TrueForge --MCP--> Scope City --MCP--> the other server
 *
 * with the scope enforced in the middle.
 */

export interface UpstreamOffice {
  /** The office id the evaluator polices, e.g. `issue.close`. */
  readonly office: string;
  /** The tool name on the upstream server, e.g. `close_issue`. */
  readonly tool: string;
  readonly description?: string;
  /**
   * Argument names this office passes through, mapped to the upstream's own.
   *
   * Declared rather than forwarded wholesale. The evaluator refuses an
   * undeclared argument, so anything not named here can never reach the
   * upstream -- and a server that grows a `force` parameter next week does not
   * silently acquire the ability to use it.
   */
  readonly argMap?: Readonly<Record<string, string>>;
  /**
   * Arguments the office supplies itself, which the agent cannot set or see.
   *
   * This is where most of the authority actually lives. `update_issue` takes an
   * owner, a repo and a state; if the agent supplies those, a scope over one
   * issue is really a scope over every repository the token can reach, and
   * `state: "open"` reopens what a human just closed. Fixing them here means
   * the agent's entire say over this office is an issue number the scope has
   * granted, and no argument it invents can widen that.
   *
   * Applied after the map, so a caller cannot reach one by guessing its name.
   */
  readonly fixedArgs?: Readonly<Record<string, unknown>>;
  /**
   * Declared arguments the upstream wants as numbers.
   *
   * A scope names resources as strings, because that is what an operator wrote
   * and what the evaluator compares. `get_issue` wants `issue_number: 7`, and a
   * server given "7" answers with a schema error the operator cannot read.
   */
  readonly numericArgs?: readonly string[];
}

export interface UpstreamMcpOptions {
  readonly district: string;
  readonly title: string;
  /** The command that starts the server, e.g. `npx`. */
  readonly command: string;
  readonly args?: readonly string[];
  /** Extra environment for the child, e.g. a token. Never logged. */
  readonly env?: Readonly<Record<string, string>>;
  readonly offices: readonly UpstreamOffice[];
}

export interface UpstreamSystem extends SystemDefinition {
  /** The tool names the upstream actually advertised, for the startup line. */
  readonly discovered: readonly string[];
  close(): Promise<void>;
}

/** Thrown when the upstream server refuses or fails a call. */
export class UpstreamMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamMcpError";
  }
}

/**
 * An MCP result, flattened into something the projector can police.
 *
 * Projection is a subtraction from a declared set of fields, so a result has to
 * *have* fields. MCP returns content blocks, and a server that answers in JSON
 * text is the common case -- so JSON is parsed and returned as itself.
 *
 * Anything else becomes `{ text }`, and that is a real limitation stated rather
 * than hidden: a scope cannot redact inside an opaque string. An office whose
 * upstream answers in prose must declare `text` in `responseFields` and treat
 * it as free text, which is exactly what it is.
 */
export function flattenMcpResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return { text: "" };

  const text = content
    .filter((block): block is { type: string; text: string } =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");

  if (text === "") return { text: "" };

  try {
    const parsed: unknown = JSON.parse(text);
    // An array is not a field-bearing object, and neither is a bare number.
    // Wrapping keeps the projector's contract: it always receives a record.
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { text, parsed };
  } catch {
    return { text };
  }
}

/** Renames declared arguments onto the upstream's own parameter names. */
export function mapArgs(
  args: Record<string, unknown>,
  office: Pick<UpstreamOffice, "argMap" | "fixedArgs" | "numericArgs">,
): Record<string, unknown> {
  const numeric = new Set(office.numericArgs ?? []);
  const value = (name: string, raw: unknown): unknown => {
    if (!numeric.has(name)) return raw;
    const asNumber = typeof raw === "string" ? Number(raw) : raw;
    return typeof asNumber === "number" && Number.isFinite(asNumber) ? asNumber : raw;
  };

  const out: Record<string, unknown> = {};
  if (office.argMap) {
    for (const [ours, theirs] of Object.entries(office.argMap)) {
      if (ours in args) out[theirs] = value(ours, args[ours]);
    }
  } else {
    for (const [name, raw] of Object.entries(args)) out[name] = value(name, raw);
  }

  // Last, and therefore not reachable by a caller that guessed the name.
  for (const [name, fixed] of Object.entries(office.fixedArgs ?? {})) out[name] = fixed;
  return out;
}

export async function upstreamMcpSystem(options: UpstreamMcpOptions): Promise<UpstreamSystem> {
  const transport = new StdioClientTransport({
    command: options.command,
    args: [...(options.args ?? [])],
    env: { ...(process.env as Record<string, string>), ...(options.env ?? {}) },
  });

  const client = new Client({ name: "scope-city", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  const discovered = listed.tools.map((tool) => tool.name);

  /*
   * Fail at startup, not at the first call.
   *
   * An office naming a tool the server does not advertise is a scope that
   * grants something unreachable: the agent sees it in `tools/list`, calls it,
   * and gets an error from three layers down. The operator granted authority
   * over nothing and only finds out mid-mission.
   */
  const missing = options.offices.filter((office) => !discovered.includes(office.tool));
  if (missing.length > 0) {
    await client.close();
    throw new UpstreamMcpError(
      `${options.title} does not advertise ${missing.map((m) => m.tool).join(", ")}. ` +
        `It offers: ${discovered.join(", ")}`,
    );
  }

  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

  const offices: OfficeHandler[] = options.offices.map((office) => {
    const tool = byName.get(office.tool)!;
    return {
      office: office.office,
      description: office.description ?? tool.description ?? office.office,
      inputSchema: (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
      call: async (args) => {
        const result = await client.callTool({
          name: office.tool,
          arguments: mapArgs(args, office),
        });

        // The upstream's own refusal, surfaced as a failure rather than
        // returned as data. A tool error that reaches the projector as a
        // result is an error the mission records as a successful call.
        if ((result as { isError?: boolean }).isError === true) {
          const flat = flattenMcpResult(result);
          throw new UpstreamMcpError(
            `${office.tool} failed: ${typeof flat.text === "string" ? flat.text : "upstream error"}`,
          );
        }

        return flattenMcpResult(result);
      },
    };
  });

  return {
    district: options.district,
    title: options.title,
    offices,
    discovered,
    close: () => client.close(),
  };
}
