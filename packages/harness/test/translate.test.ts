import { describe, expect, it } from "vitest";
import { initialState, messageText, translate, translateAll } from "../src/index.js";
import type { TurnEvent } from "../src/index.js";

const NOW = 1_700_000_000_000;
const at = () => NOW;

function run(stream: TurnEvent[]) {
  return translateAll(stream, at);
}

describe("mission lifecycle", () => {
  it("opens on turn.created and closes on turn.done", () => {
    const { events } = run([
      { type: "turn.created", turn_id: "t_1" },
      { type: "turn.done", state: { status: "done" } },
    ]);

    expect(events).toEqual([
      { type: "mission.started", turnId: "t_1", at: NOW },
      { type: "mission.ended", status: "done", at: NOW },
    ]);
  });

  it("accepts the camelCase event shape emitted by the TrueForge SDK", () => {
    const { events } = run([
      { type: "turn.created", turnId: "t_live" } as never,
      { type: "turn.done", state: { status: "done" } },
    ]);

    expect(events[0]).toEqual({ type: "mission.started", turnId: "t_live", at: NOW });
  });
});

describe("districts come online from the harness, not from a hand-drawn map", () => {
  it("emits one district per connected MCP server", () => {
    const { events } = run([
      {
        type: "mcp.initialize",
        thread_id: null,
        mcp_servers: [{ name: "records" }, { name: "exchequer" }, { name: "post-house" }],
      },
    ]);

    expect(events.map((e) => e.type === "district.online" && e.district)).toEqual([
      "records",
      "exchequer",
      "post-house",
    ]);
  });

  it("surfaces a district that needs OAuth rather than silently omitting it", () => {
    const { events } = run([
      {
        type: "mcp.auth_required",
        thread_id: null,
        mcp_servers: [{ id: "m1", name: "exchequer", auth_url: "https://auth.example/x" }],
      },
    ]);

    expect(events[0]).toMatchObject({
      type: "district.auth_required",
      district: "exchequer",
      authUrl: "https://auth.example/x",
    });
  });

  it("accepts camelCase MCP server and auth fields from the SDK", () => {
    const { events } = run([
      {
        type: "mcp.initialize",
        threadId: null,
        mcpServers: [{ name: "records" }],
      } as never,
      {
        type: "mcp.auth_required",
        threadId: null,
        mcpServers: [{ id: "m1", name: "exchequer", authUrl: "https://auth.example/live" }],
      } as never,
    ]);

    expect(events).toEqual([
      { type: "district.online", district: "records", at: NOW },
      {
        type: "district.auth_required",
        district: "exchequer",
        authUrl: "https://auth.example/live",
        at: NOW,
      },
    ]);
  });
});

describe("the agent moving between offices", () => {
  it("arrives when a tool call is issued and finishes when its response lands", () => {
    const { events } = run([
      {
        type: "model.message",
        id: "m1",
        thread_id: "root",
        content: null,
        tool_calls: [{ tool_call_id: "tc1", name: "charge.get" }],
      },
      { type: "tool.response", thread_id: "root", tool_call_id: "tc1", content: {} },
    ]);

    expect(events).toEqual([
      { type: "agent.arrived", threadId: "root", office: "charge.get", at: NOW },
      { type: "agent.finished", threadId: "root", office: "charge.get", at: NOW },
    ]);
  });

  it("ignores a response for a call it never saw start", () => {
    const { events } = run([
      { type: "tool.response", thread_id: "root", tool_call_id: "unknown", content: {} },
    ]);
    expect(events).toEqual([]);
  });

  it("tracks camelCase tool calls and responses from a live SDK stream", () => {
    const { events } = run([
      {
        type: "model.message",
        id: "m-live",
        threadId: "root",
        content: null,
        toolCalls: [{ toolCallId: "tc-live", name: "charge.get", arguments: {} }],
      } as never,
      {
        type: "tool.response",
        threadId: "root",
        toolCallId: "tc-live",
        content: {},
      } as never,
    ]);

    expect(events.map((event) => event.type)).toEqual(["agent.arrived", "agent.finished"]);
    expect(events[0]).toMatchObject({ office: "charge.get", threadId: "root" });
  });
});

describe("streamed messages", () => {
  it("merges deltas into the message they belong to", () => {
    const { state } = run([
      { type: "model.message", id: "m1", thread_id: "root", content: "" },
      { type: "model.message.delta", id: "m1", thread_id: "root", content: "Refunding " },
      { type: "model.message.delta", id: "m1", thread_id: "root", content: "order 184." },
    ]);

    expect(messageText(state, "m1")).toBe("Refunding order 184.");
  });

  it("does not emit one transmission per token", () => {
    const { events } = run([
      { type: "model.message", id: "m1", thread_id: "root", content: "" },
      { type: "model.message.delta", id: "m1", thread_id: "root", content: "a" },
      { type: "model.message.delta", id: "m1", thread_id: "root", content: "b" },
    ]);

    expect(events.filter((e) => e.type === "transmission")).toHaveLength(0);
  });
});

describe("the field — real subagents only", () => {
  it("adds a figure for a thread that has a parent", () => {
    const { events } = run([
      { type: "thread.created", thread_id: "child", parent: "root", title: "resolve resources" },
    ]);

    expect(events[0]).toMatchObject({ type: "field.joined", threadId: "child" });
  });

  it("does not add a figure for the root thread", () => {
    // The root thread is the agent itself. Counting it would show two figures
    // for a mission that never delegated anything.
    const { events } = run([{ type: "thread.created", thread_id: "root", parent: null }]);
    expect(events).toEqual([]);
  });

  it("removes the figure when the thread finishes", () => {
    const { events } = run([
      { type: "thread.created", thread_id: "child", parent: "root" },
      { type: "thread.done", thread_id: "child", state: { status: "done" } },
    ]);

    expect(events.map((e) => e.type)).toEqual(["field.joined", "field.left"]);
  });

  it("ignores the end of a thread it never counted", () => {
    const { events } = run([{ type: "thread.done", thread_id: "root" }]);
    expect(events).toEqual([]);
  });
});

describe("the gate", () => {
  it("raises with the arguments the operator needs to read before countersigning", () => {
    const { events } = run([
      {
        type: "tool.approval_required",
        thread_id: "root",
        tool_calls: [
          {
            tool_call_id: "tc9",
            name: "charge.refund",
            arguments: { charge_id: "ch_184", amount: 4900 },
          },
        ],
      },
    ]);

    expect(events[0]).toMatchObject({
      type: "gate.raised",
      toolCallId: "tc9",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
    });
  });

  it("recovers the office from an earlier tool call when the event omits the name", () => {
    const { events } = run([
      {
        type: "model.message",
        id: "m1",
        thread_id: "root",
        tool_calls: [{ tool_call_id: "tc9", name: "charge.refund" }],
      },
      { type: "tool.approval_required", thread_id: "root", tool_calls: [{ tool_call_id: "tc9" }] },
    ]);

    expect(events.at(-1)).toMatchObject({ office: "charge.refund" });
  });

  it("raises a gate from the camelCase approval event emitted live", () => {
    const { events } = run([
      {
        type: "tool.approval_required",
        threadId: "root",
        toolCalls: [
          {
            toolCallId: "tc-live",
            name: "charge.refund",
            arguments: { charge_id: "ch_184", amount: 4900 },
          },
        ],
      } as never,
    ]);

    expect(events[0]).toMatchObject({
      type: "gate.raised",
      toolCallId: "tc-live",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
    });
  });

  it("assembles streamed SDK arguments before a sparse live approval event", () => {
    const { events } = run([
      { type: "model.message", id: "m-live", threadId: "main" } as never,
      {
        type: "model.message.delta",
        id: "m-live",
        threadId: "main",
        toolCalls: [
          {
            index: 0,
            id: "function-call-live",
            toolInfo: { name: "charge.refund" },
            function: { name: "charge_refund", arguments: "" },
          },
        ],
      } as never,
      {
        type: "model.message.delta",
        id: "m-live",
        threadId: "main",
        toolCalls: [{ index: 0, function: { arguments: '{"charge_id":"ch_184",' } }],
      } as never,
      {
        type: "model.message.delta",
        id: "m-live",
        threadId: "main",
        toolCalls: [{ index: 0, function: { arguments: '"amount":4900}' } }],
      } as never,
      {
        type: "tool.approval_required",
        threadId: "main",
        toolCalls: [{ id: "function-call-live", sourceEventId: "m-live" }],
      } as never,
    ]);

    expect(events.map((event) => event.type)).toEqual(["agent.arrived", "gate.raised"]);
    expect(events.at(-1)).toMatchObject({
      toolCallId: "function-call-live",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
    });
  });
});

describe("the yard", () => {
  it("opens when the harness provisions a sandbox", () => {
    const { events } = run([
      { type: "sandbox.created", thread_id: null, sandbox_id: "sb_1" },
    ]);
    expect(events[0]).toMatchObject({ type: "yard.opened", sandboxId: "sb_1" });
  });
});

describe("unknown events", () => {
  it("passes over anything it does not recognise instead of throwing", () => {
    // The harness will add events; a new one must not take the city down.
    const result = translate({ type: "something.new", payload: 1 }, initialState(), NOW);
    expect(result.events).toEqual([]);
  });
});

describe("malformed events must not corrupt well-formed ones", () => {
  // Both found by Qodo review.
  it("still finishes a tool call whose name the harness omitted", () => {
    // PendingToolCall.name is optional. Recording the mapping only when it was
    // present meant a nameless call never produced agent.finished, so the agent
    // appeared to stand in that office forever.
    const { events } = run([
      {
        type: "model.message",
        id: "m1",
        thread_id: "root",
        tool_calls: [{ tool_call_id: "tc1" }],
      },
      { type: "tool.response", thread_id: "root", tool_call_id: "tc1", content: {} },
    ]);

    expect(events.map((e) => e.type)).toEqual(["agent.arrived", "agent.finished"]);
    expect(events[0]).toMatchObject({ office: "tc1" });
  });

  it("does not merge two id-less messages into one buffer", () => {
    // Defaulting a missing id to "" gave every such message the same key, so
    // two unrelated streams concatenated into each other.
    const { state } = run([
      { type: "model.message", thread_id: "a", content: "first" },
      { type: "model.message", thread_id: "b", content: "second" },
      { type: "model.message.delta", thread_id: "a", content: "-more" },
    ]);

    expect(messageText(state, "")).toBe("");
  });

  it("ignores an id that is not a string, rather than stringifying it", () => {
    // String({}) is "[object Object]", which is a perfectly usable map key and
    // exactly the wrong one.
    const { state } = run([
      { type: "model.message", id: { nested: true } as never, thread_id: "a", content: "x" },
    ]);

    expect(messageText(state, "[object Object]")).toBe("");
  });

  it("keeps two properly-identified streams apart", () => {
    const { state } = run([
      { type: "model.message", id: "m1", thread_id: "a", content: "" },
      { type: "model.message", id: "m2", thread_id: "b", content: "" },
      { type: "model.message.delta", id: "m1", content: "one" },
      { type: "model.message.delta", id: "m2", content: "two" },
    ]);

    expect(messageText(state, "m1")).toBe("one");
    expect(messageText(state, "m2")).toBe("two");
  });

  it("ignores a sandbox event with no id", () => {
    const { events } = run([{ type: "sandbox.created", thread_id: null } as never]);
    expect(events).toEqual([]);
  });

  it("ignores a thread event with no id", () => {
    const { events } = run([{ type: "thread.created", parent: "root" } as never]);
    expect(events).toEqual([]);
  });
});
