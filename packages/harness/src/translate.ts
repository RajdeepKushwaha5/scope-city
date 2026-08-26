import type { PendingToolCall, TurnEvent } from "./types.js";
import { initialState, type TranslatorState, type WorldEvent } from "./world-events.js";
import { readVerdict } from "./verdict.js";

export interface TranslateResult {
  readonly state: TranslatorState;
  readonly events: readonly WorldEvent[];
}

/**
 * Reads an identifier off an event, or nothing.
 *
 * These arrive over the wire, so a field the schema calls a string may not be
 * one. Coercing with String() would turn a malformed object into the literal
 * "[object Object]" and then use it as a map key, which is how unrelated
 * streams end up sharing state. An id we cannot trust is treated as absent.
 */
function id(event: TurnEvent, field: string): string | undefined {
  const value = (event as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eitherId(event: TurnEvent, snake: string, camel: string): string | undefined {
  return id(event, snake) ?? id(event, camel);
}

interface NormalisedToolCall {
  readonly toolCallId: string;
  readonly name?: string;
  readonly arguments?: unknown;
}

function toolCalls(event: TurnEvent): readonly NormalisedToolCall[] {
  const record = event as Record<string, unknown>;
  const raw = record.tool_calls ?? record.toolCalls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const call = value as Record<string, unknown>;
    // Approval events emitted by the SDK use `id`; the OpenAPI wire schema
    // calls the same value `tool_call_id`.
    const toolCallId = call.tool_call_id ?? call.toolCallId ?? call.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) return [];
    const toolInfo = call.toolInfo as Record<string, unknown> | undefined;
    const fn = call.function as Record<string, unknown> | undefined;
    const name = call.name ?? toolInfo?.name ?? fn?.name;
    const args = call.arguments ?? fn?.arguments;
    return [{
      toolCallId,
      ...(typeof name === "string" ? { name } : {}),
      ...(args !== undefined ? { arguments: args } : {}),
    }];
  });
}

function parsedArguments(text: string): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Turns one harness event into zero or more things the city can show.
 *
 * A pure reducer rather than a class with callbacks, so the whole mapping can
 * be tested by replaying a recorded event stream -- no server, no sockets. That
 * matters because this is the layer where a wrong assumption about the harness
 * would quietly produce a city that animates the wrong thing.
 */
export function translate(
  event: TurnEvent,
  state: TranslatorState = initialState(),
  now: number = Date.now(),
): TranslateResult {
  const events: WorldEvent[] = [];
  let next = state;

  switch (event.type) {
    case "turn.created": {
      events.push({
        type: "mission.started",
        turnId: eitherId(event, "turn_id", "turnId") ?? "",
        at: now,
      });
      break;
    }

    case "turn.done": {
      const status = (event as { state?: { status?: string } }).state?.status ?? "unknown";
      events.push({ type: "mission.ended", status, at: now });
      break;
    }

    case "mcp.initialize": {
      const eventRecord = event as unknown as {
        mcp_servers?: readonly { name: string }[];
        mcpServers?: readonly { name: string }[];
      };
      const servers = eventRecord.mcp_servers ?? eventRecord.mcpServers ?? [];
      for (const server of servers) {
        events.push({ type: "district.online", district: server.name, at: now });
      }
      break;
    }

    case "mcp.auth_required": {
      const eventRecord = event as unknown as {
        mcp_servers?: readonly { name: string; auth_url?: string; authUrl?: string }[];
        mcpServers?: readonly { name: string; auth_url?: string; authUrl?: string }[];
      };
      const servers = eventRecord.mcp_servers ?? eventRecord.mcpServers ?? [];
      for (const server of servers) {
        events.push({
          type: "district.auth_required",
          district: server.name,
          authUrl: server.auth_url ?? server.authUrl ?? "",
          at: now,
        });
      }
      break;
    }

    case "sandbox.created": {
      const sandboxId = eitherId(event, "sandbox_id", "sandboxId");
      if (sandboxId) events.push({ type: "yard.opened", sandboxId, at: now });
      break;
    }

    case "thread.created": {
      const threadId = eitherId(event, "thread_id", "threadId");
      // The root thread is the agent itself; only additional threads are extra
      // figures in the field. A parent is what distinguishes them.
      const parent = (event as { parent?: unknown }).parent;
      if (threadId && parent) {
        const title = (event as { title?: string | null }).title ?? null;
        events.push({ type: "field.joined", threadId, title, at: now });
        next = { ...next, threads: new Set(next.threads).add(threadId) };
      }
      break;
    }

    case "thread.done": {
      const threadId = eitherId(event, "thread_id", "threadId");
      if (threadId && next.threads.has(threadId)) {
        events.push({ type: "field.left", threadId, at: now });
        const threads = new Set(next.threads);
        threads.delete(threadId);
        next = { ...next, threads };
      }
      break;
    }

    case "model.message": {
      const e = event as unknown as {
        id?: string;
        thread_id?: string;
        threadId?: string;
        content?: string | null;
        tool_calls?: readonly PendingToolCall[];
        toolCalls?: readonly PendingToolCall[];
      };
      const threadId = e.thread_id ?? e.threadId ?? "";

      // A model.message arrives with empty content and is filled in by deltas
      // sharing its id. Seed the buffer so those deltas have somewhere to go.
      //
      // An event with no id is not given one: defaulting to "" would make every
      // such event share a single buffer, so two unrelated streamed messages
      // would concatenate into each other. Better to lose a malformed message
      // than to corrupt a well-formed one.
      if (e.id) {
        const messages = new Map(next.messages);
        messages.set(e.id, e.content ?? "");
        next = { ...next, messages };
      }

      if (e.content) {
        events.push({ type: "transmission", threadId, text: e.content, at: now });
      }

      // Remember which office each pending call belongs to, so the matching
      // tool.response can say where the agent finished.
      //
      // `name` is optional in the harness's schema. Recording the mapping only
      // when it is present meant a nameless call never produced agent.finished
      // and the agent appeared to stand in that office forever, so the id is
      // used as its own label when nothing better exists.
      const pendingCalls = toolCalls(event);
      if (pendingCalls.length) {
        const toolCalls = new Map(next.toolCalls);
        const toolCallArgs = new Map(next.toolCallArgs);
        for (const call of pendingCalls) {
          const office = call.name ?? call.toolCallId;
          toolCalls.set(call.toolCallId, office);
          if (call.arguments !== undefined) toolCallArgs.set(call.toolCallId, call.arguments);
          events.push({ type: "agent.arrived", threadId, office, at: now });
        }
        next = { ...next, toolCalls, toolCallArgs };
      }
      break;
    }

    case "model.message.delta": {
      const e = event as unknown as {
        id?: string;
        thread_id?: string;
        threadId?: string;
        content?: string | null;
      };
      // Without a trustworthy id there is no buffer this delta belongs to.
      // Dropping it loses a fragment; guessing merges two conversations.
      const messageId = id(event, "id");
      if (messageId && e.content) {
        const messages = new Map(next.messages);
        messages.set(messageId, (messages.get(messageId) ?? "") + e.content);
        next = { ...next, messages };
      }
      // TrueForge's SDK does not put completed tool calls on model.message.
      // It streams them here: the first delta has id/name/index and later ones
      // often have only index plus another arguments fragment. Assemble that
      // exact call so the sparse approval event can be bound to what the human
      // actually saw.
      const rawCalls = (event as Record<string, unknown>).toolCalls;
      if (messageId && Array.isArray(rawCalls)) {
        const toolCalls = new Map(next.toolCalls);
        const toolCallArgs = new Map(next.toolCallArgs);
        const toolCallIndexes = new Map(next.toolCallIndexes);
        const toolCallArgumentText = new Map(next.toolCallArgumentText);
        const threadId = e.thread_id ?? e.threadId ?? "";

        for (const raw of rawCalls) {
          if (!raw || typeof raw !== "object") continue;
          const call = raw as Record<string, unknown>;
          const index = typeof call.index === "number" ? call.index : 0;
          const indexKey = `${messageId}:${index}`;
          const directId = call.id ?? call.toolCallId ?? call.tool_call_id;
          const toolCallId =
            typeof directId === "string" && directId.length > 0
              ? directId
              : toolCallIndexes.get(indexKey);
          if (!toolCallId) continue;

          toolCallIndexes.set(indexKey, toolCallId);
          const toolInfo = call.toolInfo as Record<string, unknown> | undefined;
          const fn = call.function as Record<string, unknown> | undefined;
          const rawName = call.name ?? toolInfo?.name ?? fn?.name;
          const office = typeof rawName === "string" ? rawName : toolCalls.get(toolCallId);
          if (office && !toolCalls.has(toolCallId)) {
            toolCalls.set(toolCallId, office);
            events.push({ type: "agent.arrived", threadId, office, at: now });
          }

          const fragment = fn?.arguments;
          if (typeof fragment === "string") {
            const text = (toolCallArgumentText.get(toolCallId) ?? "") + fragment;
            toolCallArgumentText.set(toolCallId, text);
            const args = parsedArguments(text);
            if (args !== undefined) toolCallArgs.set(toolCallId, args);
          }
        }
        next = { ...next, toolCalls, toolCallArgs, toolCallIndexes, toolCallArgumentText };
      }
      // Deltas are not emitted as transmissions -- the accumulated text is read
      // from state, otherwise the log would show one entry per token.
      break;
    }

    case "tool.response": {
      const e = event as unknown as { thread_id?: string; threadId?: string };
      const toolCallId = eitherId(event, "tool_call_id", "toolCallId");
      const office = toolCallId ? next.toolCalls.get(toolCallId) : undefined;
      if (toolCallId && office) {
        events.push({
          type: "agent.finished",
          threadId: e.thread_id ?? e.threadId ?? "",
          office,
          at: now,
        });

        // A sandbox response is the one tool result worth keeping.
        //
        // Everything else the agent calls goes through the proxy, which already
        // reports what was allowed and what came back. Sandbox execution does
        // not: it is the agent's own working, and discarding it left the map
        // able to say "a sandbox opened" and nothing about why its verdict
        // should be trusted. An operator approving an irreversible transfer on
        // the strength of a check they cannot see is not really checking.
        if (isSandboxOffice(office)) {
          const content = (event as unknown as { content?: unknown }).content;
          const output = typeof content === "string" ? content : "";
          const args = next.toolCallArgs.get(toolCallId);
          events.push({
            type: "yard.verified",
            toolCallId,
            script: scriptFrom(args),
            output,
            passed: readVerdict(output),
            at: now,
          });
        }
        const toolCalls = new Map(next.toolCalls);
        toolCalls.delete(toolCallId);
        const toolCallArgs = new Map(next.toolCallArgs);
        toolCallArgs.delete(toolCallId);
        const toolCallArgumentText = new Map(next.toolCallArgumentText);
        toolCallArgumentText.delete(toolCallId);
        next = { ...next, toolCalls, toolCallArgs, toolCallArgumentText };
      }
      break;
    }

    case "tool.approval_required": {
      const e = event as unknown as { thread_id?: string; threadId?: string };
      for (const call of toolCalls(event)) {
        events.push({
          type: "gate.raised",
          threadId: e.thread_id ?? e.threadId ?? "",
          toolCallId: call.toolCallId,
          office: call.name ?? next.toolCalls.get(call.toolCallId) ?? null,
          args: call.arguments ?? next.toolCallArgs.get(call.toolCallId) ?? null,
          at: now,
        });
      }
      break;
    }

    default:
      break;
  }

  return { state: next, events };
}

/** Accumulated text for a streamed message, once its deltas have landed. */
export function messageText(state: TranslatorState, id: string): string {
  return state.messages.get(id) ?? "";
}

/** Replays a whole recorded stream. Used by tests and by session resume. */
export function translateAll(
  stream: Iterable<TurnEvent>,
  now: () => number = () => Date.now(),
): { state: TranslatorState; events: WorldEvent[] } {
  let state = initialState();
  const events: WorldEvent[] = [];
  for (const event of stream) {
    const result = translate(event, state, now());
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/**
 * Whether a tool call was sandbox execution.
 *
 * Matched by name because the harness does not label sandbox tools distinctly
 * in the event stream. The list is narrow on purpose: a false positive would
 * attach an unrelated tool's output to the gate as though it were verification,
 * which is worse than attaching nothing.
 */
export function isSandboxOffice(office: string): boolean {
  const name = office.toLowerCase();
  return name === "exec" || name === "bash" || name === "shell" || name.endsWith(".exec");
}

/**
 * The script out of an exec call's arguments.
 *
 * Argument names vary by harness version, so several are tried rather than
 * assuming one. An empty string is returned rather than a guess: showing the
 * operator the wrong text next to a verdict is worse than showing them none.
 */
export function scriptFrom(args: unknown): string {
  if (typeof args === "string") return args;
  if (typeof args !== "object" || args === null) return "";

  const record = args as Record<string, unknown>;
  for (const key of ["script", "code", "command", "cmd", "input", "source"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}
