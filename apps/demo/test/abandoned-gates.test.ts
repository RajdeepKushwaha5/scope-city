import { describe, expect, it } from "vitest";
import { OperatorGateQueue } from "../src/live-feed.js";
import { retireMission } from "../src/live-lifecycle.js";

const gate = (toolCallId: string, office: string) => ({
  threadId: "main",
  toolCallId,
  office,
  args: { charge_id: "ch_184", amount: 4900 },
});

/**
 * A refusal and an unanswered question end the same way and mean opposite
 * things. One is a control that fired. The other is a control that was never
 * exercised, which is usually a fact about the operators rather than the agent.
 */
describe("gates nobody answered", () => {
  it("reports what was still waiting when the mission ended", () => {
    const queue = new OperatorGateQueue();
    void queue.wait(gate("tc_1", "charge.refund"));
    void queue.wait(gate("tc_2", "mail.send"));

    const abandoned = queue.cancelAll("scope expired");

    expect(abandoned.map((a) => a.toolCallId)).toEqual(["tc_1", "tc_2"]);
    expect(abandoned.map((a) => a.office)).toEqual(["charge.refund", "mail.send"]);
  });

  it("still refuses the calls, exactly as before", () => {
    // The behaviour that matters most is unchanged: nothing runs. This only
    // adds the record of it.
    const queue = new OperatorGateQueue();
    const waiting = queue.wait(gate("tc_1", "charge.refund"));

    queue.cancelAll("scope expired");

    return expect(waiting).resolves.toEqual({ approved: false, reason: "scope expired" });
  });

  it("says how long the question stood", () => {
    const queue = new OperatorGateQueue();
    void queue.wait(gate("tc_1", "charge.refund"));

    const [abandoned] = queue.cancelAll("scope expired", Date.now() + 90_000);

    expect(abandoned!.waitedMs).toBeGreaterThanOrEqual(90_000);
  });

  it("never records a negative wait", () => {
    // A clock that steps backwards mid-mission should not put a nonsense
    // duration into a record offered as evidence.
    const queue = new OperatorGateQueue();
    void queue.wait(gate("tc_1", "charge.refund"));

    const [abandoned] = queue.cancelAll("scope expired", Date.now() - 60_000);

    expect(abandoned!.waitedMs).toBe(0);
  });

  it("reports nothing when every gate was already decided", () => {
    const queue = new OperatorGateQueue();
    void queue.wait(gate("tc_1", "charge.refund"));
    queue.decide("tc_1", { approved: true });

    expect(queue.cancelAll("mission completed")).toEqual([]);
  });
});

describe("the record says the question went unanswered", () => {
  function harness() {
    const appended: unknown[] = [];
    const queue = new OperatorGateQueue();
    const mission = {
      id: "m_1",
      feed: { append: (event: unknown) => appended.push(event) },
      gates: queue,
      status: "running" as const,
    };
    return { appended, queue, mission };
  }

  it("writes one gate.abandoned per unanswered gate, before the terminal status", () => {
    const { appended, queue, mission } = harness();
    void queue.wait(gate("tc_1", "charge.refund"));

    retireMission(mission, { forget: () => undefined }, "cancelled", "scope expired");

    const types = appended.map((e) => {
      const entry = e as { type: string; event?: { type: string } };
      return entry.type === "world" ? entry.event!.type : entry.type;
    });

    // Order matters: the gate fell, then the mission ended.
    expect(types).toEqual(["gate.abandoned", "mission.status"]);
  });

  it("carries the office and the reason the mission ended", () => {
    const { appended, queue, mission } = harness();
    void queue.wait(gate("tc_1", "charge.refund"));

    retireMission(mission, { forget: () => undefined }, "cancelled", "scope expired");

    const event = (appended[0] as { event: Record<string, unknown> }).event;
    expect(event["office"]).toBe("charge.refund");
    expect(event["reason"]).toBe("scope expired");
  });

  it("writes nothing extra when no gate was pending", () => {
    // The common case. A mission that finished its work should not gain an
    // event implying somebody failed to answer something.
    const { appended, mission } = harness();

    retireMission(mission, { forget: () => undefined }, "completed");

    expect(appended).toHaveLength(1);
  });
});
