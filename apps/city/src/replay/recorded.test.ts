import { describe, expect, it, vi } from "vitest";
import { playRecording, replayDelay, type RecordedMission } from "./recorded.js";
import { initialLiveCityState, reduceLiveCity } from "../live-state.js";

const record: RecordedMission = {
  missionId: "m".repeat(20),
  scopeId: "SC-1",
  job: "Refund order #184",
  scope: {
    scopeId: "SC-1",
    job: "Refund order #184",
    offices: ["charge.refund"],
    countersignRequired: ["charge.refund"],
    resources: { charge_ids: ["ch_184"] },
    limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 } },
    expiresAt: 2_000_000,
    grantedAt: 1_000_000,
  },
  startedAt: 1_000_000,
  finishedAt: 1_000_500,
  head: "abc",
  algorithm: "sha256",
  lossy: false,
  entries: [
    { sequence: 1, at: 1_000_000, hash: "a", event: { type: "mission.status", status: "starting" } },
    { sequence: 2, at: 1_000_100, hash: "b", event: { type: "mission.status", status: "running" } },
    { sequence: 3, at: 1_060_000, hash: "c", event: { type: "mission.status", status: "completed" } },
  ],
};

describe("replayDelay", () => {
  it("compresses real elapsed time", () => {
    expect(replayDelay(1_000_000, 1_000_600)).toBe(100);
  });

  it("caps a long model pause so a viewer is not watching an idle city", () => {
    // The least interesting thing in the file is how long a turn took.
    expect(replayDelay(1_000_000, 1_060_000)).toBe(1_200);
  });

  it("keeps a floor so events do not arrive all at once", () => {
    expect(replayDelay(1_000_000, 1_000_000)).toBe(90);
  });

  it("treats a clock that goes backwards as no gap", () => {
    expect(replayDelay(1_000_500, 1_000_000)).toBe(90);
  });
});

describe("playRecording", () => {
  it("plays every event in order", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const done = vi.fn();

    playRecording(record, (e) => seen.push(JSON.stringify(e)), done);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain("starting");
    expect(seen[2]).toContain("completed");
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops dispatching once stopped", async () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    const handle = playRecording(record, (e) => seen.push(e));

    await vi.advanceTimersByTimeAsync(1);
    handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    // A replay that keeps dispatching into an unmounted tree is a leak with a
    // React warning attached.
    expect(seen.length).toBeLessThan(3);
    vi.useRealTimers();
  });

  it("survives being stopped twice", () => {
    const handle = playRecording(record, () => undefined);
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  it("drives the same reducer the live stream drives", async () => {
    // The point of replaying a real recording rather than scripting one: there
    // is no second code path that could flatter the first.
    vi.useFakeTimers();
    let state = initialLiveCityState;
    playRecording(record, (e) => {
      state = reduceLiveCity(state, e);
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(state.status).toBe("completed");
    vi.useRealTimers();
  });

  it("does nothing for an empty recording", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    playRecording({ ...record, entries: [] }, () => undefined, done);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
