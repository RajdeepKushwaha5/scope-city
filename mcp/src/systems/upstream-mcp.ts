import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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
  /**
   * How to make a non-idempotent upstream write safe to retry.
   *
   * Most write APIs worth the name take an idempotency key. GitHub's
   * `add_issue_comment` does not, so an ambiguous failure -- GitHub creates the
   * comment, the response is lost -- leaves the proxy releasing its claim and a
   * retry posting the same comment again, emailing every watcher twice.
   *
   * The boundary can supply what the upstream lacks. Stamp the operation key
   * into the written text as an HTML comment, which GitHub renders as nothing,
   * and before writing, read back what is already there and look for it. A
   * retry of the same intended action finds its own marker and returns instead
   * of writing; a genuinely new comment carries a different key and goes
   * through.
   *
   * This is not a distributed transaction and does not pretend to be. It closes
   * the window that matters here -- retry after an ambiguous failure -- and the
   * cost of losing the race is the duplicate that happens today anyway.
   */
  readonly idempotency?: {
    /** The declared argument whose text carries the marker. */
    readonly markerIn: string;
    /**
     * The upstream tool that lists what has already been written, if it has one.
     *
     * Optional because plenty do not. `@modelcontextprotocol/server-github`
     * 2025.4.8 can add a comment and cannot read comments back, so the Forge
     * gets the marker and the in-process record and no read-back. When a server
     * does offer one, reconciliation survives a restart as well.
     */
    readonly lookupTool?: string;
    /** Fixed arguments for the lookup, e.g. the pinned owner and repo. */
    readonly lookupArgs?: Readonly<Record<string, unknown>>;
    /** Call arguments to forward to the lookup, mapped onto its names. */
    readonly lookupArgMap?: Readonly<Record<string, string>>;
    /** Where the items live in the lookup's flattened result. */
    readonly itemsField?: string;
    /** The field on each item to scan for the marker. */
    readonly scanField: string;
  };
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
  /*
   * `structuredContent` first, because a server that fills it means it.
   *
   * MCP lets a result carry structured data alongside the text blocks, and a
   * server using it is handing over exactly the field-bearing object the
   * projector wants. Reading only `content` turned those results into `{ text:
   * "" }` -- an empty answer that looks like a server with nothing to say
   * rather than a reader that did not look.
   */
  const structured = (result as { structuredContent?: unknown })
    .structuredContent;
  if (
    typeof structured === "object" &&
    structured !== null &&
    !Array.isArray(structured)
  ) {
    return structured as Record<string, unknown>;
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return { text: "" };

  const text = content
    .filter(
      (block): block is { type: string; text: string } =>
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
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return { text, parsed };
  } catch {
    return { text };
  }
}

/**
 * A string turned into the integer it literally spells, or nothing.
 *
 * Exported because it is the join between what a scope grants and what an
 * upstream receives, and that join is worth testing on its own.
 */
export function canonicalInteger(raw: string): number | undefined {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return String(parsed) === raw ? parsed : undefined;
}

/** Renames declared arguments onto the upstream's own parameter names. */
export function mapArgs(
  args: Record<string, unknown>,
  office: Pick<UpstreamOffice, "argMap" | "fixedArgs" | "numericArgs">,
): Record<string, unknown> {
  const numeric = new Set(office.numericArgs ?? []);
  const value = (name: string, raw: unknown): unknown => {
    if (!numeric.has(name)) return raw;
    if (typeof raw !== "string") return raw;
    /*
     * Only a string that is already the number it says it is.
     *
     * `Number()` was doing the conversion, and `Number()` is generous in ways
     * the evaluator is not. The evaluator compares `String(value)` against the
     * grant, so a scope granting issue `"0x10"` authorises the string "0x10" --
     * and `Number("0x10")` is 16. The call the operator approved and the call
     * GitHub receives would be about two different issues. `"1e3"`, `" 7 "`
     * and integers past `Number.MAX_SAFE_INTEGER` all break the same way.
     *
     * `canonical` is the round trip: convert, and require that converting back
     * gives the string that was granted. Anything else is left as it arrived,
     * so the upstream answers with a schema error naming the argument -- a
     * legible refusal instead of a silent redirection.
     */
    return canonicalInteger(raw) ?? raw;
  };

  const out: Record<string, unknown> = {};
  if (office.argMap) {
    for (const [ours, theirs] of Object.entries(office.argMap)) {
      if (ours in args) out[theirs] = value(ours, args[ours]);
    }
  } else {
    for (const [name, raw] of Object.entries(args))
      out[name] = value(name, raw);
  }

  // Last, and therefore not reachable by a caller that guessed the name.
  for (const [name, fixed] of Object.entries(office.fixedArgs ?? {}))
    out[name] = fixed;
  return out;
}

/**
 * The marker an operation leaves in what it writes, invisible where it lands.
 *
 * An HTML comment because GitHub renders one as nothing: the reader sees the
 * agent's sentence, and the boundary sees a key it can recognise on a retry.
 */
/** GitHub's maximum page size, and a ceiling on how far back the scan reads. */
/** An attempt that went out and never answered. Not safe to repeat. */
const MAY_HAVE_LANDED = Symbol("may have landed");

const LOOKUP_PAGE_SIZE = 100;
const MAX_LOOKUP_PAGES = 10;

export function idempotencyMarker(key: string): string {
  return `<!-- scope-city:${key} -->`;
}

/** Whether a previous attempt at this exact operation already landed. */
export function alreadyWritten(
  items: unknown,
  scanField: string,
  marker: string,
): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    const field = (item as Record<string, unknown> | null)?.[scanField];
    return typeof field === "string" && field.includes(marker);
  });
}

/**
 * Every page of `tools/list`, not just the first.
 *
 * `tools/list` is cursor-paginated. Reading one page and calling it the tool
 * set meant a server that advertised a configured tool on page two failed
 * startup with "does not advertise" -- a refusal naming the wrong cause, about
 * a tool that was there all along.
 */
async function listAllTools(client: Client): Promise<readonly Tool[]> {
  const all: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? {} : { cursor });
    all.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return all;
}

export async function upstreamMcpSystem(
  options: UpstreamMcpOptions,
): Promise<UpstreamSystem> {
  /*
   * The child gets the SDK's safe default environment and nothing else.
   *
   * This spread `process.env` into it, which handed a third-party subprocess
   * every credential this process holds: the Gemini keys, the Stripe key, the
   * Daytona token, the SMTP settings. The office needs exactly one of those and
   * the server is somebody else's code, fetched at startup.
   *
   * It is also the same mistake the whole project is about, made one layer
   * down. A scope exists so an agent gets one charge instead of every charge;
   * handing its upstream every secret instead of the one it needs is that
   * failure with the word "environment" in front of it.
   *
   * `getDefaultEnvironment()` is the SDK's allowlist -- PATH, HOME and the
   * platform necessities a process needs to run at all. `options.env` adds the
   * one credential the district was configured with.
   */
  const transport = new StdioClientTransport({
    command: options.command,
    args: [...(options.args ?? [])],
    env: { ...getDefaultEnvironment(), ...(options.env ?? {}) },
  });

  const client = new Client(
    { name: "scope-city", version: "1.0.0" },
    { capabilities: {} },
  );

  /*
   * Every failure between here and the returned handle closes the child.
   *
   * The caller only gets a `close()` once this function returns, so a rejection
   * from `connect()`, discovery or validation used to leave the spawned
   * third-party process and its pipes alive with nobody holding a handle to
   * them. A startup that fails is exactly when a stray privileged subprocess is
   * least likely to be noticed.
   */
  let tools: readonly Tool[];
  try {
    await client.connect(transport);
    tools = await listAllTools(client);

    /*
     * Fail at startup, not at the first call.
     *
     * An office naming a tool the server does not advertise is a scope that
     * grants something unreachable: the agent sees it in `tools/list`, calls
     * it, and gets an error from three layers down. The operator granted
     * authority over nothing and only finds out mid-mission.
     */
    const discovered = tools.map((tool) => tool.name);
    // A declared lookup tool is checked with the same strictness. An office
    // that reconciles against a tool the server does not have is an office that
    // silently stops reconciling.
    const required = options.offices.flatMap((office) => [
      office.tool,
      ...(office.idempotency?.lookupTool
        ? [office.idempotency.lookupTool]
        : []),
    ]);
    const missing = [...new Set(required)].filter(
      (name) => !discovered.includes(name),
    );
    if (missing.length > 0) {
      throw new UpstreamMcpError(
        `${options.title} does not advertise ${missing.join(", ")}. ` +
          `It offers: ${discovered.join(", ")}`,
      );
    }
  } catch (error) {
    // The startup error is what the operator needs; a failure to clean up after
    // it is not allowed to replace it.
    await client.close().catch(() => {});
    throw error;
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  /*
   * One record of attempted writes for the life of the connection.
   *
   * Keyed by the proxy's idempotency key, which identifies an intended action
   * rather than an attempt at one. It is deliberately not persisted: it exists
   * to answer a retry that arrives after an ambiguous failure, which is a
   * within-process event. An office whose upstream can read its own writes back
   * declares `lookupTool` as well, and that part does survive a restart.
   */
  const attempts = new Map<
    string,
    Record<string, unknown> | typeof MAY_HAVE_LANDED
  >();

  const offices: OfficeHandler[] = options.offices.map((office) => {
    const tool = byName.get(office.tool)!;
    return {
      office: office.office,
      description: office.description ?? tool.description ?? office.office,
      inputSchema: (tool.inputSchema ?? { type: "object" }) as Record<
        string,
        unknown
      >,
      call: async (args, context) => {
        let sent = mapArgs(args, office);

        /*
         * Read back before writing, when the office says its upstream cannot.
         *
         * Only reached when an idempotency key exists, which is the retry case
         * the proxy hands down. The first attempt of a fresh operation pays one
         * extra read; a retry pays it to avoid a duplicate that a human then
         * has to go and delete.
         */
        const idem = office.idempotency;
        if (idem && context?.idempotencyKey) {
          /*
           * The mission is part of the key, because the connection is not.
           *
           * One Forge connection serves every mission -- it spawns a subprocess
           * and holds a token, so it is deliberately not per-mission -- while
           * the proxy derives its key from the office and the arguments. Two
           * missions posting the same sentence to the same issue produce the
           * same key, and without the mission in front of it the second one
           * would silently receive the first one's result and never post.
           *
           * The ledger has always namespaced by mission. This matches it.
           */
          const key = `${context.missionId ?? "no-mission"}:${context.idempotencyKey}`;
          const marker = idempotencyMarker(key);

          /*
           * What this process already tried, before asking anyone else.
           *
           * The failure in the finding is a retry inside one process: the call
           * reaches GitHub, the response is lost, the proxy releases its claim,
           * and the next attempt posts the comment again. The boundary saw both
           * attempts, so the boundary can answer the second one.
           *
           * A completed attempt returns what it returned. An attempt that
           * failed *ambiguously* -- the request went out and nothing came back
           * -- is the case that must not be retried blindly: it is recorded as
           * possibly-landed and the retry is refused, because a human deleting
           * one duplicate comment is a worse outcome than an operator reading a
           * message that says the call may already have gone through.
           */
          const attempted = attempts.get(key);
          if (attempted === MAY_HAVE_LANDED) {
            throw new UpstreamMcpError(
              `${office.office} was already attempted with this key and may have gone through`,
            );
          }
          if (attempted !== undefined) return attempted;
          const lookup: Record<string, unknown> = {
            ...(idem.lookupArgs ?? {}),
          };
          for (const [ours, theirs] of Object.entries(
            idem.lookupArgMap ?? {},
          )) {
            if (ours in args) lookup[theirs] = sent[ours] ?? args[ours];
          }
          const lookupTool = idem.lookupTool;

          /*
           * Every page, because a busy issue puts the marker on page three.
           *
           * A scan that reads one page and concludes "not written yet" is a
           * scan that duplicates on exactly the threads where a duplicate is
           * most visible. Bounded, so a pathological thread cannot turn one
           * comment into an unbounded read.
           */
          let found = false;
          for (
            let page = 1;
            lookupTool && page <= MAX_LOOKUP_PAGES && !found;
            page += 1
          ) {
            const existing = flattenMcpResult(
              await client.callTool({
                name: lookupTool,
                arguments: { ...lookup, page, perPage: LOOKUP_PAGE_SIZE },
              }),
            );
            const items = idem.itemsField
              ? existing[idem.itemsField]
              : existing.parsed;
            found = alreadyWritten(items, idem.scanField, marker);
            if (!Array.isArray(items) || items.length < LOOKUP_PAGE_SIZE) break;
          }

          if (found) {
            // The action happened. Saying so is the whole point: reporting a
            // failure here is what makes a caller retry into a duplicate.
            const settled = {
              deduplicated: true,
              idempotencyKey: context.idempotencyKey,
            };
            attempts.set(key, settled);
            return settled;
          }

          const text = sent[idem.markerIn];
          if (typeof text === "string") {
            sent = { ...sent, [idem.markerIn]: `${text}\n\n${marker}` };
          }

          // Recorded before the call, not after, because the case being
          // defended against is the one where nothing comes back.
          attempts.set(key, MAY_HAVE_LANDED);
        }

        const result = await client.callTool({
          name: office.tool,
          arguments: sent,
        });

        // The upstream's own refusal, surfaced as a failure rather than
        // returned as data. A tool error that reaches the projector as a
        // result is an error the mission records as a successful call.
        if ((result as { isError?: boolean }).isError === true) {
          /*
           * The upstream's own words do not cross the boundary.
           *
           * A refusal is returned to the agent, and this used to put the
           * foreign server's error text straight into it -- around the
           * projector, which never sees a thrown error, and around the
           * injection scan. A server could disclose whatever it liked through
           * its error channel, or write an instruction there, and the one path
           * that filters responses would not have been on it.
           *
           * The detail is worth keeping, so it is logged where the operator can
           * read it and not returned. What the agent gets is that the call
           * failed, which is all it can act on anyway.
           */
          const flat = flattenMcpResult(result);
          console.error(
            `[upstream] ${options.title} ${office.tool} failed:`,
            typeof flat.text === "string" ? flat.text : flat,
          );
          throw new UpstreamMcpError(`${office.office} failed upstream`);
        }

        const flat = flattenMcpResult(result);
        if (office.idempotency && context?.idempotencyKey) {
          // The attempt is no longer ambiguous. A retry now gets this back
          // rather than a refusal.
          attempts.set(
            `${context.missionId ?? "no-mission"}:${context.idempotencyKey}`,
            flat,
          );
        }
        return flat;
      },
    };
  });

  return {
    district: options.district,
    title: options.title,
    offices,
    discovered: tools.map((tool) => tool.name),
    close: () => client.close(),
  };
}
