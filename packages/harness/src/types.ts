/**
 * Shapes taken from a live TrueForge instance's OpenAPI document, not from the
 * documentation prose -- the two have already disagreed once (the hosted
 * platform SDK is a different product from the open-source harness).
 *
 * See docs/TRUEFORGE.md. If you change anything here, re-run
 * scripts/dump-trueforge-schemas.sh first and match what it prints.
 */

/** AgentSpec.mcp_servers[] -- how a scope becomes something the harness enforces too. */
export interface McpServerBinding {
  readonly name: string;
  readonly enableTools?: readonly string[];
  readonly disableTools?: readonly string[];
  readonly preloadTools?: readonly string[];
  /**
   * Tools the harness pauses on. This is The Gate: it asks a human. It is a
   * different mechanism from the scope proxy, which never asks anyone.
   */
  readonly requireApprovalForTools?: readonly string[];
  readonly preload?: boolean;
}

/**
 * Mirrors the SDK's TypeScript surface, which is camelCase.
 *
 * The OpenAPI document describes the wire format and is snake_case. The two are
 * not interchangeable: the SDK converts on the way out, so a snake_case key is
 * accepted and dropped rather than rejected. That failure is invisible -- the
 * session starts, the agent simply has no tools.
 */
export interface AgentSpec {
  readonly model: {
    readonly name: string;
    readonly params?: Record<string, unknown>;
  };
  readonly instructions?: string;
  readonly mcpServers?: readonly McpServerBinding[];
  readonly skills?: readonly { readonly name: string }[];
  readonly config?: {
    readonly iterationLimit?: number;
    readonly sandbox?: { readonly enabled: boolean; readonly fileDownloads?: boolean };
    readonly dynamicSubAgents?: { readonly enabled?: boolean };
    readonly generativeUi?: { readonly enabled?: boolean };
    readonly askUserQuestions?: { readonly enabled?: boolean };
  };
}

/** POST /api/v1/settings/mcp-servers */
export interface McpServerManifest {
  readonly type: "remote";
  /** Constrained by the API: ^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$ */
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly auth?:
    | { readonly type: "header"; readonly headers: Record<string, string> }
    | { readonly type: "dcr" };
}

/** The name pattern the API enforces. Fail here rather than on a 422. */
export const MCP_SERVER_NAME_PATTERN = /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/;

/* -------------------------------------------------------------------------- */
/* Turn input                                                                  */
/* -------------------------------------------------------------------------- */

export type TurnInput = UserMessage | UserToolApproval | UserToolResponse;

export interface UserMessage {
  readonly type: "user.message";
  readonly content: string;
}

/**
 * How a paused turn is resumed. Note this is an *input to a new turn*, not a
 * reply to the event that paused things -- there is no callback to answer.
 */
export interface UserToolApproval {
  readonly type: "user.tool_approval";
  readonly threadId: string;
  readonly toolCallId: string;
  readonly approval: { readonly status: "allow" } | { readonly status: "deny"; readonly reason?: string };
}

export interface UserToolResponse {
  readonly type: "user.tool_response";
  readonly threadId: string;
  readonly toolCallId: string;
  readonly content: string;
}

/* -------------------------------------------------------------------------- */
/* Turn events                                                                 */
/* -------------------------------------------------------------------------- */

export interface PendingToolCall {
  readonly tool_call_id: string;
  readonly source_event_id?: string;
  readonly name?: string;
  readonly arguments?: unknown;
}

export type TurnEvent =
  | { readonly type: "turn.created"; readonly turn_id: string; readonly previous_turn_id?: string | null }
  | { readonly type: "turn.done"; readonly state: { readonly status: string } }
  | {
      readonly type: "model.message";
      readonly id: string;
      readonly thread_id: string;
      readonly content?: string | null;
      readonly tool_calls?: readonly PendingToolCall[];
    }
  | {
      readonly type: "model.message.delta";
      readonly id: string;
      readonly thread_id: string;
      readonly content?: string | null;
    }
  | {
      readonly type: "tool.response";
      readonly thread_id: string;
      readonly tool_call_id: string;
      readonly content?: unknown;
    }
  | {
      /** The Gate. The turn is paused until a new turn carries the approval. */
      readonly type: "tool.approval_required";
      readonly thread_id: string;
      readonly tool_calls: readonly PendingToolCall[];
    }
  | {
      readonly type: "tool.response_required";
      readonly thread_id: string;
      readonly tool_calls: readonly PendingToolCall[];
    }
  | {
      /** A subagent. One of these is a second figure appearing in the field. */
      readonly type: "thread.created";
      readonly thread_id: string;
      readonly title?: string | null;
      readonly parent?: string | null;
    }
  | {
      readonly type: "thread.done";
      readonly thread_id: string;
      readonly state?: { readonly status: string };
    }
  | {
      readonly type: "mcp.initialize";
      readonly thread_id: string | null;
      readonly mcp_servers: readonly { readonly name: string; readonly session_id?: string }[];
    }
  | {
      readonly type: "mcp.auth_required";
      readonly thread_id: string | null;
      readonly mcp_servers: readonly { readonly id: string; readonly name: string; readonly auth_url: string }[];
    }
  | { readonly type: "sandbox.created"; readonly thread_id: string | null; readonly sandbox_id: string }
  | { readonly type: string; readonly [key: string]: unknown };

/** Narrowing helper, since the union has an open-ended fallback member. */
export function isEvent<T extends TurnEvent["type"]>(
  event: TurnEvent,
  type: T,
): event is Extract<TurnEvent, { type: T }> {
  return event.type === type;
}
