import { describe, expect, it } from "vitest";
import type { TurnEvent, WorldEvent } from "@scope-city/harness";
import type { Scope } from "@scope-city/scope";
import { MissionOrchestrator } from "../src/index.js";

const NOW = 1_700_000_000_000;

function scope(overrides: Partial<Scope> = {}): Scope {
  return {
    missionId: "m_0123456789abcdef",
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184",
    state: "active",
    offices: ["ticket.get", "charge.refund"],
    resources: { ticket_ids: ["tkt_184"], charge_ids: ["ch_184"] },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1 },
      maxResponseBytes: 64_000,
    },
    projection: { "charge.refund": ["id", "status"] },
    countersignRequired: ["charge.refund"],
    expiresAt: NOW + 600_000,
    grantedBy: "operator",
    grantedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function build() {
  const emitted: WorldEvent[] = [];
  const mission = new MissionOrchestrator({ emit: (e) => emitted.push(e) });
  const feed = (events: TurnEvent[]) => {
    for (const event of events) mission.ingest(event, NOW);
  };
  return { mission, emitted, feed };
}

/** The refund arriving at the gate, as the harness reports it. */
const GATE: TurnEvent = {
  type: "tool.approval_required",
  thread_id: "root",
  tool_calls: [
    { tool_call_id: "tc1", name: "charge.refund", arguments: { charge_id: "ch_184", amount: 4900 } },
  ],
};

describe("a mission from start to finish", () => {
  it("begins drafting, with nothing granted", () => {
    const { mission } = build();
    expect(mission.snapshot()).toMatchObject({ phase: "drafting", scope: null });
  });

  it("runs once a scope is granted", () => {
    const { mission } = build();
    mission.grant(scope());
    expect(mission.snapshot().phase).toBe("running");
  });

  it("brings districts online as the harness connects them", () => {
    const { mission, feed } = build();
    feed([
      {
        type: "mcp.initialize",
        thread_id: null,
        mcp_servers: [{ name: "records" }, { name: "exchequer" }],
      },
    ]);
    expect(mission.snapshot().districts).toEqual(["records", "exchequer"]);
  });

  it("counts figures in the field and lets them go", () => {
    const { mission, feed } = build();
    feed([
      { type: "thread.created", thread_id: "t1", parent: "root" },
      { type: "thread.created", thread_id: "t2", parent: "root" },
    ]);
    expect(mission.snapshot().fieldSize).toBe(2);

    feed([{ type: "thread.done", thread_id: "t1" }]);
    expect(mission.snapshot().fieldSize).toBe(1);
  });

  it("opens the yard when the harness provisions a sandbox", () => {
    const { mission, feed } = build();
    expect(mission.snapshot().sandboxOpen).toBe(false);
    feed([{ type: "sandbox.created", thread_id: null, sandbox_id: "sb_1" }]);
    expect(mission.snapshot().sandboxOpen).toBe(true);
  });

  it("ends done or failed according to the turn", () => {
    const { mission, feed } = build();
    feed([{ type: "turn.done", state: { status: "error" } }]);
    expect(mission.snapshot().phase).toBe("failed");
  });
});

describe("the gate", () => {
  it("holds the mission and records what the operator will read", () => {
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);

    expect(mission.snapshot()).toMatchObject({ phase: "awaiting_countersign", gatesOpen: 1 });
    expect(mission.book.pending("tc1")).toMatchObject({
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
    });
  });

  it("does not raise a gate it could not fingerprint", () => {
    // No scope means no fingerprint, and a gate we cannot bind is one we must
    // not honour later. Better to have no gate than an unbindable one.
    const { mission, feed } = build();
    feed([GATE]);
    expect(mission.book.allPending()).toEqual([]);
  });

  it("returns what the caller must send back as a new turn", () => {
    // The harness has no callback to answer -- an approval is the input to a
    // fresh turn, so decide() describes rather than performs.
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);

    expect(mission.decide({ toolCallId: "tc1", approved: true, now: NOW })).toEqual({
      threadId: "root",
      toolCallId: "tc1",
      approved: true,
      reason: undefined,
    });
  });

  it("carries the operator's reason when they refuse", () => {
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);

    const resume = mission.decide({
      toolCallId: "tc1",
      approved: false,
      reason: "wrong customer",
      now: NOW,
    });

    expect(resume).toMatchObject({ approved: false, reason: "wrong customer" });
    expect(mission.book.check("tc1", "x")).toMatchObject({ approved: false });
  });

  it("returns nothing for a call that is not waiting", () => {
    const { mission } = build();
    mission.grant(scope());
    expect(mission.decide({ toolCallId: "unknown", approved: true })).toBeUndefined();
  });

  it("goes back to running once the last gate is answered", () => {
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);
    mission.decide({ toolCallId: "tc1", approved: true, now: NOW });
    expect(mission.snapshot().phase).toBe("running");
  });

  it("announces the gate clearing so the map can lower it", () => {
    const { mission, emitted, feed } = build();
    mission.grant(scope());
    feed([GATE]);
    mission.decide({ toolCallId: "tc1", approved: true, now: NOW });

    expect(emitted.at(-1)).toMatchObject({ type: "gate.cleared", toolCallId: "tc1", approved: true });
  });
});

describe("what the operator approved is what may run", () => {
  it("agrees with the call it fingerprinted", () => {
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);
    mission.decide({ toolCallId: "tc1", approved: true, now: NOW });

    const raised = mission.book.pending("tc1");
    expect(mission.book.check("tc1", raised!.fingerprint).approved).toBe(true);
  });

  it("does not agree with a call that drifted after it was shown", () => {
    const { mission, feed } = build();
    mission.grant(scope());
    feed([GATE]);
    mission.decide({ toolCallId: "tc1", approved: true, now: NOW });

    const result = mission.book.check("tc1", "the-fingerprint-of-a-different-refund");
    expect(result.fingerprint).not.toBe("the-fingerprint-of-a-different-refund");
  });
});

describe("revocation", () => {
  it("marks the scope revoked and bumps its version", () => {
    // The version bump matters: it invalidates every countersign granted
    // under the previous terms.
    const { mission } = build();
    mission.grant(scope());
    mission.revoke();

    expect(mission.scope).toMatchObject({ state: "revoked", version: 2 });
  });

  it("is harmless when nothing was granted", () => {
    const { mission } = build();
    expect(() => mission.revoke()).not.toThrow();
    expect(mission.scope).toBeNull();
  });
});

describe("replay", () => {
  it("reconstructs the same state from the same stream", () => {
    // A mission is replayable because the orchestrator owns no I/O. That is
    // what lets a reconnecting client catch up without re-running anything.
    const stream: TurnEvent[] = [
      { type: "turn.created", turn_id: "t1" },
      { type: "mcp.initialize", thread_id: null, mcp_servers: [{ name: "records" }] },
      { type: "thread.created", thread_id: "t1", parent: "root" },
      { type: "sandbox.created", thread_id: null, sandbox_id: "sb_1" },
    ];

    const a = build();
    a.mission.grant(scope());
    a.feed(stream);

    const b = build();
    b.mission.grant(scope());
    b.feed(stream);

    expect(b.mission.snapshot()).toEqual(a.mission.snapshot());
    expect(b.emitted).toEqual(a.emitted);
  });
});
