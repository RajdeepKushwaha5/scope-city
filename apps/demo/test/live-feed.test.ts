import { describe, expect, it, vi } from "vitest";
import { MissionFeed, OperatorGateQueue } from "../src/live-feed.js";

describe("MissionFeed", () => {
  it("replays before subscribing and then publishes each new event once", () => {
    const feed = new MissionFeed();
    feed.append({ type: "mission.status", status: "starting" }, 1);
    expect(feed.since(0).events).toHaveLength(1);

    const listener = vi.fn();
    const unsubscribe = feed.subscribe(listener);
    feed.append({ type: "mission.status", status: "running" }, 2);
    unsubscribe();
    feed.append({ type: "mission.status", status: "completed" }, 3);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].sequence).toBe(2);
  });

  it("surfaces a replay gap instead of constructing a partial city", () => {
    const feed = new MissionFeed(1);
    feed.append({ type: "mission.status", status: "starting" }, 1);
    feed.append({ type: "mission.status", status: "running" }, 2);
    expect(feed.since(0).truncated).toBe(true);
  });
});

describe("OperatorGateQueue", () => {
  const gate = {
    threadId: "main",
    toolCallId: "tc_1",
    office: "charge.refund",
    args: { charge_id: "ch_184", amount: 4900 },
  } as const;

  it("does not continue until a person resolves the exact gate", async () => {
    const queue = new OperatorGateQueue();
    const decision = queue.wait(gate);
    expect(queue.decide("a_different_call", { approved: true })).toBe(false);
    expect(queue.list()).toEqual([gate]);

    expect(queue.decide("tc_1", { approved: true })).toBe(true);
    await expect(decision).resolves.toEqual({ approved: true });
    expect(queue.list()).toEqual([]);
  });

  it("returns the same pending decision when the stream arms a gate before the runner waits", async () => {
    const queue = new OperatorGateQueue();
    const armed = queue.wait(gate);
    const runner = queue.wait(gate);
    expect(runner).toBe(armed);
    queue.decide("tc_1", { approved: false });
    await expect(runner).resolves.toEqual({ approved: false });
  });

  it("fails closed when a mission is cancelled", async () => {
    const queue = new OperatorGateQueue();
    const decision = queue.wait(gate);
    queue.cancelAll();
    await expect(decision).resolves.toEqual({ approved: false, reason: "mission cancelled" });
  });
});
