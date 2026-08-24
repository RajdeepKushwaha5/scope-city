import type { PendingToolCall, TurnEvent } from "./types.js";
import { initialState, type TranslatorState, type WorldEvent } from "./world-events.js";

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
      events.push({ type: "mission.started", turnId: id(event, "turn_id") ?? "", at: now });
      break;
    }

    case "turn.done": {
      const status = (event as { state?: { status?: string } }).state?.status ?? "unknown";
      events.push({ type: "mission.ended", status, at: now });
      break;
    }

    case "mcp.initialize": {
      const servers = (event as { mcp_servers?: readonly { name: string }[] }).mcp_servers ?? [];
      for (const server of servers) {
        events.push({ type: "district.online", district: server.name, at: now });
      }
      break;
    }

    case "mcp.auth_required": {
      const servers =
        (event as { mcp_servers?: readonly { name: string; auth_url: string }[] }).mcp_servers ?? [];
      for (const server of servers) {
        events.push({
          type: "district.auth_required",
          district: server.name,
          authUrl: server.auth_url,
          at: now,
        });
      }
      break;
    }

    case "sandbox.created": {
      const sandboxId = id(event, "sandbox_id");
      if (sandboxId) events.push({ type: "yard.opened", sandboxId, at: now });
      break;
    }

    case "thread.created": {
      const threadId = id(event, "thread_id");
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
      const threadId = id(event, "thread_id");
      if (threadId && next.threads.has(threadId)) {
        events.push({ type: "field.left", threadId, at: now });
        const threads = new Set(next.threads);
        threads.delete(threadId);
        next = { ...next, threads };
      }
      break;
    }

    case "model.message": {
      const e = event as {
        id?: string;
        thread_id?: string;
        content?: string | null;
        tool_calls?: readonly PendingToolCall[];
      };
      const threadId = e.thread_id ?? "";

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
      if (e.tool_calls?.length) {
        const toolCalls = new Map(next.toolCalls);
        for (const call of e.tool_calls) {
          const office = call.name ?? call.tool_call_id;
          toolCalls.set(call.tool_call_id, office);
          events.push({ type: "agent.arrived", threadId, office, at: now });
        }
        next = { ...next, toolCalls };
      }
      break;
    }

    case "model.message.delta": {
      const e = event as { id?: string; thread_id?: string; content?: string | null };
      // Without a trustworthy id there is no buffer this delta belongs to.
      // Dropping it loses a fragment; guessing merges two conversations.
      const messageId = id(event, "id");
      if (messageId && e.content) {
        const messages = new Map(next.messages);
        messages.set(messageId, (messages.get(messageId) ?? "") + e.content);
        next = { ...next, messages };
      }
      // Deltas are not emitted as transmissions -- the accumulated text is read
      // from state, otherwise the log would show one entry per token.
      break;
    }

    case "tool.response": {
      const e = event as { thread_id?: string; tool_call_id?: string };
      const toolCallId = id(event, "tool_call_id");
      const office = toolCallId ? next.toolCalls.get(toolCallId) : undefined;
      if (toolCallId && office) {
        events.push({
          type: "agent.finished",
          threadId: e.thread_id ?? "",
          office,
          at: now,
        });
        const toolCalls = new Map(next.toolCalls);
        toolCalls.delete(toolCallId);
        next = { ...next, toolCalls };
      }
      break;
    }

    case "tool.approval_required": {
      const e = event as { thread_id?: string; tool_calls?: readonly PendingToolCall[] };
      for (const call of e.tool_calls ?? []) {
        events.push({
          type: "gate.raised",
          threadId: e.thread_id ?? "",
          toolCallId: call.tool_call_id,
          office: call.name ?? next.toolCalls.get(call.tool_call_id) ?? null,
          args: call.arguments ?? null,
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
