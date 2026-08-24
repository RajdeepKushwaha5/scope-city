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
