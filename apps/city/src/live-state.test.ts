import { describe, expect, it } from "vitest";
import { initialLiveCityState, reduceLiveCity } from "./live-state.js";

describe("live city event fold", () => {
  it("raises and clears only the matching visible gate", () => {
    const raised = reduceLiveCity(initialLiveCityState, {
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "tc_1",
        office: "charge.refund",
        args: { amount: 4900 },
        at: 1,
      },
    });
    expect(raised.phase).toBe("awaiting_countersign");
    expect(raised.gate?.district).toBe("exchequer");

    const stale = reduceLiveCity(raised, {
      type: "world",
      event: { type: "gate.cleared", toolCallId: "tc_other", approved: true, at: 2 },
    });
    expect(stale.gate).toEqual(raised.gate);

    const cleared = reduceLiveCity(stale, {
      type: "world",
      event: { type: "gate.cleared", toolCallId: "tc_1", approved: true, at: 3 },
    });
    expect(cleared.gate).toBeNull();
  });

  it("queues concurrent gates so each remains visible and decidable", () => {
    const first = reduceLiveCity(initialLiveCityState, {
      type: "world",
      event: { type: "gate.raised", threadId: "main", toolCallId: "tc_1", office: "charge.refund", args: {}, at: 1 },
    });
    const second = reduceLiveCity(first, {
      type: "world",
      event: { type: "gate.raised", threadId: "worker", toolCallId: "tc_2", office: "email.send", args: {}, at: 2 },
    });

    expect(second.gate?.toolCallId).toBe("tc_1");
    expect(second.pendingGates.map((gate) => gate.toolCallId)).toEqual(["tc_2"]);

    const advanced = reduceLiveCity(second, {
      type: "world",
      event: { type: "gate.cleared", toolCallId: "tc_1", approved: true, at: 3 },
    });
    expect(advanced.gate?.toolCallId).toBe("tc_2");
    expect(advanced.phase).toBe("awaiting_countersign");
  });

  it("renders proxy refusals as boundary events", () => {
    const state = reduceLiveCity(initialLiveCityState, {
      type: "proxy",
      event: {
        type: "call.out_of_scope",
        missionId: "m_1",
        office: "charge.get",
        district: "exchequer",
        reason: "resource_not_in_scope",
        detail: "charge ch_185 is outside charge_ids",
        at: 1,
      },
    });
    expect(state.log.at(-1)?.kind).toBe("refused");
    expect(state.log.at(-1)?.what).toMatch(/OUT OF SCOPE/);
    expect(state.refusedAt).not.toBeNull();
  });

  it("maps the one proxy connection to the systems it actually fronts", () => {
    const state = reduceLiveCity(initialLiveCityState, {
      type: "world",
      event: { type: "district.online", district: "scope-city-live", at: 1 },
    });
    expect(state.online).toEqual(["records", "exchequer", "post-house", "gate"]);
  });

  it("drops the visible boundary and pending gate when the server expires scope", () => {
    const state = reduceLiveCity(
      { ...initialLiveCityState, phase: "awaiting_countersign", gate: {
        toolCallId: "tc_1",
        office: "charge.refund",
        district: "exchequer",
        args: {},
      } },
      { type: "scope.expired", at: 1 },
    );
    expect(state.scopeExpired).toBe(true);
    expect(state.gate).toBeNull();
  });
});

describe("subagent figures carry the assignment the harness gave them", () => {
  const joined = (threadId: string, title: string | null, at: number) =>
    ({ type: "world", event: { type: "field.joined", threadId, title, at } }) as never;

  it("keeps the thread title on the figure", () => {
    // TrueForge names the child threads it spawns, and on a real run those
    // names come back as the two assignments the brief describes. Dropping
    // them left identical tokens standing in a row, which reads as decoration
    // rather than as delegation that actually happened.
    const state = reduceLiveCity(
      initialLiveCityState,
      joined("thread-a", "Source investigator", 1),
    );

    const figure = state.figures.find((f) => f.id === "thread-a");
    expect(figure?.kind).toBe("team");
    expect(figure?.title).toBe("Source investigator");
  });

  it("tolerates a thread the harness did not name", () => {
    const state = reduceLiveCity(initialLiveCityState, joined("thread-b", null, 1));
    expect(state.figures.find((f) => f.id === "thread-b")?.title).toBeNull();
  });

  it("gives each concurrent subagent its own plot rather than stacking them", () => {
    // Five threads were observed on one real run. Overlapping them would show
    // one figure where there are five.
    let state = initialLiveCityState;
    state = reduceLiveCity(state, joined("a", "Source investigator", 1));
    state = reduceLiveCity(state, joined("b", "Target verifier", 2));

    const team = state.figures.filter((f) => f.kind === "team");
    expect(team).toHaveLength(2);
    expect(team[0]!.u).not.toBe(team[1]!.u);
  });

  it("removes the figure when its thread ends", () => {
    let state = reduceLiveCity(initialLiveCityState, joined("a", "Target verifier", 1));
    state = reduceLiveCity(state, {
      type: "world",
      event: { type: "field.left", threadId: "a", at: 2 },
    } as never);

    expect(state.figures.some((f) => f.id === "a")).toBe(false);
  });
});

describe("a gate that nobody answered", () => {
  const raised = {
    type: "world",
    event: {
      type: "gate.raised",
      threadId: "main",
      toolCallId: "tc_1",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
      at: 1,
    },
  } as never;

  const abandoned = {
    type: "world",
    event: {
      type: "gate.abandoned",
      toolCallId: "tc_1",
      office: "charge.refund",
      waitedMs: 92_000,
      reason: "scope expired",
      at: 2,
    },
  } as never;

  it("stops holding for a countersign that is never coming", () => {
    // Left pending, the city shows a finished run still waiting on a human,
    // which is the opposite of what the record says happened.
    const held = reduceLiveCity(initialLiveCityState, raised);
    expect(held.phase).toBe("awaiting_countersign");

    const released = reduceLiveCity(held, abandoned);
    expect(released.gate).toBeNull();
    expect(released.pendingGates).toHaveLength(0);
  });

  it("says the question went unanswered rather than that it was refused", () => {
    // "Refused" would credit an operator with a decision nobody made. The run
    // ended with the question still standing, which is a fact about the people
    // rather than about the agent.
    const state = reduceLiveCity(reduceLiveCity(initialLiveCityState, raised), abandoned);
    const line = state.log[state.log.length - 1]!;

    expect(line.what).toMatch(/unanswered/i);
    expect(line.what).toContain("charge.refund");
    expect(line.what).toMatch(/nothing ran/i);
    expect(line.what).not.toMatch(/\brefused\b/i);
  });

  it("reports how long it stood, in seconds", () => {
    const state = reduceLiveCity(reduceLiveCity(initialLiveCityState, raised), abandoned);
    expect(state.log[state.log.length - 1]!.what).toContain("92s");
  });

  it("promotes the next gate rather than showing none", () => {
    // The looser version of this test only checked that tc_2 was still
    // somewhere in state. It was -- sitting in `pendingGates` while `gate` was
    // null, so the city displayed no gate at all and stayed in
    // awaiting_countersign for a question it had stopped showing.
    const second = {
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "tc_2",
        office: "mail.send",
        args: {},
        at: 2,
      },
    } as never;

    let state = reduceLiveCity(initialLiveCityState, raised);
    state = reduceLiveCity(state, second);
    state = reduceLiveCity(state, abandoned);

    expect(state.gate?.toolCallId).toBe("tc_2");
    expect(state.pendingGates).toHaveLength(0);
    expect(state.phase).toBe("awaiting_countersign");
  });

  it("returns to running when the abandoned gate was the last one", () => {
    const state = reduceLiveCity(reduceLiveCity(initialLiveCityState, raised), abandoned);

    expect(state.gate).toBeNull();
    expect(state.phase).toBe("running");
  });

  it("does not disturb the active gate when a queued one is abandoned", () => {
    // The other direction: abandoning something further down the queue must
    // leave whatever the operator is currently looking at exactly where it is.
    const second = {
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "tc_2",
        office: "mail.send",
        args: {},
        at: 2,
      },
    } as never;

    const abandonSecond = {
      type: "world",
      event: {
        type: "gate.abandoned",
        toolCallId: "tc_2",
        office: "mail.send",
        waitedMs: 1_000,
        reason: "scope expired",
        at: 3,
      },
    } as never;

    let state = reduceLiveCity(initialLiveCityState, raised);
    state = reduceLiveCity(state, second);
    state = reduceLiveCity(state, abandonSecond);

    expect(state.gate?.toolCallId).toBe("tc_1");
    expect(state.pendingGates).toHaveLength(0);
    expect(state.phase).toBe("awaiting_countersign");
  });
});
