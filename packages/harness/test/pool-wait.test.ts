import { describe, expect, it } from "vitest";
import { ModelPool } from "../src/model-pool.js";

/**
 * What the pool says when everything is cooling.
 *
 * `nextAvailableAt` existed and nothing used it, so the live server iterated a
 * snapshot of what was available at the instant a mission started. If all three
 * keys happened to be rate-limited at that moment the loop body never ran and
 * the mission failed outright -- while every one of them was sixty seconds from
 * working again. On free-tier keys that is not an edge case.
 */
const pool = () =>
  new ModelPool([
    { model: "a/one", priority: 0 },
    { model: "b/two", priority: 1 },
    { model: "c/three", priority: 2 },
  ]);

const NOW = 1_000_000;

describe("nextAvailableAt", () => {
  it("says nothing is needed while a model is ready", () => {
    expect(pool().nextAvailableAt(NOW)).toBeUndefined();
  });

  it("reports the soonest recovery when every model is cooling", () => {
    const p = pool();
    p.penalise("a/one", "rate_limited", NOW);
    p.penalise("b/two", "unavailable", NOW);
    p.penalise("c/three", "quota_exhausted", NOW);

    // rate_limited is the shortest cooldown, so it is the one to wait for --
    // waiting for the longest would idle for hours behind a key that recovers
    // in a minute.
    expect(p.nextAvailableAt(NOW)).toBe(p.nextAvailableAt(NOW));
    expect(p.nextAvailableAt(NOW)! - NOW).toBe(60_000);
  });

  it("clears once the soonest cooldown has passed", () => {
    const p = pool();
    for (const model of ["a/one", "b/two", "c/three"]) p.penalise(model, "rate_limited", NOW);

    expect(p.next(NOW)).toBeUndefined();
    expect(p.next(NOW + 60_001)).toBe("a/one");
    expect(p.nextAvailableAt(NOW + 60_001)).toBeUndefined();
  });

  it("prefers the highest-priority model that has recovered", () => {
    const p = pool();
    p.penalise("a/one", "quota_exhausted", NOW);
    // a/one is out for hours; b/two is next in priority and never failed.
    expect(p.next(NOW)).toBe("b/two");
  });

  it("brings a model back immediately once it succeeds", () => {
    const p = pool();
    p.penalise("a/one", "quota_exhausted", NOW);
    p.restore("a/one");
    expect(p.next(NOW)).toBe("a/one");
  });
});
