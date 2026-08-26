import { describe, expect, it } from "vitest";
import { MissionFeed, OperatorGateQueue } from "../src/live-feed.js";

/**
 * A pending approval has to survive the browser going away.
 *
 * This is the property that makes The Gate usable rather than a demo trick. An
 * irreversible action is paused waiting for a person, and people close tabs,
 * lose wifi, and reload. If the pending call is lost with the connection, the
 * agent waits forever on a decision nobody can make, and the operator is left
 * with no way to finish or abandon the job.
 *
 * The pieces are deliberately separate: the harness keeps the turn paused, the
 * queue holds the pending call server-side, and the feed can replay the whole
 * mission from any cursor. None of it lives in the browser, which is exactly
 * why a refresh costs nothing.
 */
describe("a waiting gate survives a reconnect", () => {
  it("replays the pending gate to a client that has nothing", async () => {
    const feed = new MissionFeed();
    const gates = new OperatorGateQueue();

    feed.append({ type: "mission.status", status: "starting" });
    const pending = gates.wait({
      threadId: "main",
      toolCallId: "call-1",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount: 4900 },
    });
    feed.append({
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "call-1",
        office: "charge.refund",
        args: { charge_id: "ch_184", amount: 4900 },
        at: 1_000_000,
      },
    });

    // A reload: the client has seen nothing and asks from zero.
    const replay = feed.since(0);
    const raised = replay.events.filter(
      (e) => e.event.type === "world" && e.event.event.type === "gate.raised",
    );

    expect(raised).toHaveLength(1);
    expect(replay.truncated).toBe(false);

    // And the recovered call is still decidable, which is the point: seeing the
    // gate again would be useless if the decision no longer landed anywhere.
    expect(gates.decide("call-1", { approved: true })).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true });
  });

  it("keeps the exact call, not merely the fact that something was waiting", async () => {
    // A gate replayed without its arguments would ask the operator to approve
    // "a refund" rather than this refund, and the countersign is bound to the
    // fingerprint of an exact call.
    const feed = new MissionFeed();
    feed.append({
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "call-2",
        office: "charge.refund",
        args: { charge_id: "ch_184", amount: 4900 },
        at: 1_000_000,
      },
    });

    const replayed = feed.since(0).events[0]?.event;
    expect(replayed?.type).toBe("world");
    if (replayed?.type === "world" && replayed.event.type === "gate.raised") {
      expect(replayed.event.args).toEqual({ charge_id: "ch_184", amount: 4900 });
      expect(replayed.event.office).toBe("charge.refund");
    }
  });

  it("does not double-register a gate a reconnecting client re-reports", async () => {
    // Waiting twice on one call must not create two promises, or one approval
    // resolves one of them and the turn stays paused on the other.
    const gates = new OperatorGateQueue();
    const gate = {
      threadId: "main",
      toolCallId: "call-3",
      office: "mail.send",
      args: { to: "a@b.test" },
    };

    const first = gates.wait(gate);
    const second = gates.wait(gate);
    expect(first).toBe(second);

    gates.decide("call-3", { approved: true });
    await expect(first).resolves.toEqual({ approved: true });
    await expect(second).resolves.toEqual({ approved: true });
  });

  it("refuses a decision for a call nobody is waiting on", () => {
    const gates = new OperatorGateQueue();
    expect(gates.decide("never-existed", { approved: true })).toBe(false);
  });
});
