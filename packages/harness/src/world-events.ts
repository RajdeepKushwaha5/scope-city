/**
 * What the city renders. Deliberately a different vocabulary from TrueForge's
 * events: the map should not care that a "thread" is what the harness calls a
 * subagent, and renaming one of these must be a conscious decision because a
 * building stops lighting up when it happens.
 */
export type WorldEvent =
  | { readonly type: "mission.started"; readonly turnId: string; readonly at: number }
  | { readonly type: "mission.ended"; readonly status: string; readonly at: number }
  /** Districts coming online as the harness connects their MCP servers. */
  | { readonly type: "district.online"; readonly district: string; readonly at: number }
  | { readonly type: "district.auth_required"; readonly district: string; readonly authUrl: string; readonly at: number }
  /** The agent is working an office. */
  | { readonly type: "agent.arrived"; readonly threadId: string; readonly office: string; readonly at: number }
  | { readonly type: "agent.finished"; readonly threadId: string; readonly office: string; readonly at: number }
  /** A second figure in the field. */
  | { readonly type: "field.joined"; readonly threadId: string; readonly title: string | null; readonly at: number }
  | { readonly type: "field.left"; readonly threadId: string; readonly at: number }
  /** The Gate: the harness is holding for a human. */
  | {
      readonly type: "gate.raised";
      readonly threadId: string;
      readonly toolCallId: string;
      readonly office: string | null;
      readonly args: unknown;
      readonly at: number;
    }
  | { readonly type: "gate.cleared"; readonly toolCallId: string; readonly approved: boolean; readonly at: number }
  | { readonly type: "yard.opened"; readonly sandboxId: string; readonly at: number }
  | { readonly type: "transmission"; readonly threadId: string; readonly text: string; readonly at: number };

/** Carried between events so deltas can be merged and offices remembered. */
export interface TranslatorState {
  /** model.message id -> accumulated content, for delta merging. */
  readonly messages: ReadonlyMap<string, string>;
  /** tool_call_id -> office name, so tool.response knows where the agent was. */
  readonly toolCalls: ReadonlyMap<string, string>;
  /** tool_call_id -> the complete arguments shown by the streamed model call. */
  readonly toolCallArgs: ReadonlyMap<string, unknown>;
  /** message-id/index -> tool_call_id, because later SDK deltas carry only an index. */
  readonly toolCallIndexes: ReadonlyMap<string, string>;
  /** tool_call_id -> partial JSON text assembled across SDK deltas. */
  readonly toolCallArgumentText: ReadonlyMap<string, string>;
  readonly threads: ReadonlySet<string>;
}

export function initialState(): TranslatorState {
  return {
    messages: new Map(),
    toolCalls: new Map(),
    toolCallArgs: new Map(),
    toolCallIndexes: new Map(),
    toolCallArgumentText: new Map(),
    threads: new Set(),
  };
}
