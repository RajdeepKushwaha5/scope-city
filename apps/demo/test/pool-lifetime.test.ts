import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ModelPool } from "@scope-city/harness";

/**
 * A cooldown is a memory, and it has to outlive the mission that learned it.
 *
 * The pool was built inside `runLiveMission`, so every mission started with a
 * clean one. That threw the memory away in exactly the case it was written for:
 * two missions in a row.
 *
 * The demo *is* two missions in a row. An unscoped run and a scoped run, back
 * to back, on free-tier keys. The first exhausts a key; the second starts a
 * pool that knows nothing, picks that same key first, waits for its 429, and
 * only then rotates -- a visible stall the first run had already learned how to
 * avoid, and one that lands in the middle of a recording.
 */
describe("remembering a rate limit between missions", () => {
  const server = readFileSync(
    fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
    "utf8",
  );

  it("does not build a pool per mission", () => {
    // The regression. A `new ModelPool` inside the mission runner is a pool
    // that forgets, however carefully the cooldowns are set.
    const runner = server.slice(
      server.indexOf("async function runLiveMission"),
    );
    expect(runner).not.toContain("new ModelPool(");
  });

  it("builds one for the life of the server", () => {
    // Optional, not eager: `ModelPool` refuses to be empty and discovery can
    // legitimately find no rotation candidates, so building it unconditionally
    // threw before the HTTP server bound -- taking down the one endpoint able
    // to report the problem.
    expect(server).toContain("const pool =");
    expect(server).toContain("models.length > 0");
    expect(server).toContain("new ModelPool(models.map(");
  });

  // --- and the behaviour that makes the lifetime matter --------------------

  it("still avoids a model it saw fail a moment ago", () => {
    const pool = new ModelPool([
      { model: "gemini-a/flash-a", priority: 0 },
      { model: "gemini-b/flash-b", priority: 1 },
    ]);
    const now = 1_000_000;

    expect(pool.next(now)).toBe("gemini-a/flash-a");
    pool.penalise("gemini-a/flash-a", "rate_limited", now);

    // The second mission's first choice, which used to be the exhausted key.
    expect(pool.next(now + 1_000)).toBe("gemini-b/flash-b");
  });

  it("forgives a model as soon as it works again", () => {
    // The reason a long-lived pool does not accumulate grudges: one success
    // clears the cooldown, so a key throttled for one busy minute is first
    // choice again on the next mission that uses it.
    const pool = new ModelPool([
      { model: "gemini-a/flash-a", priority: 0 },
      { model: "gemini-b/flash-b", priority: 1 },
    ]);
    const now = 1_000_000;

    pool.penalise("gemini-a/flash-a", "rate_limited", now);
    expect(pool.next(now)).toBe("gemini-b/flash-b");

    pool.restore("gemini-a/flash-a");
    expect(pool.next(now)).toBe("gemini-a/flash-a");
  });

  it("comes back on its own once the window has passed", () => {
    // Nothing has to succeed for a rate limit to lapse; the minute is the
    // whole penalty.
    const pool = new ModelPool([{ model: "only/one", priority: 0 }]);
    const now = 1_000_000;

    pool.penalise("only/one", "rate_limited", now);
    expect(pool.next(now + 30_000)).toBeUndefined();
    expect(pool.next(now + 61_000)).toBe("only/one");
  });
});

describe("one pool serving every mission", () => {
  /*
   * A shared pool is shared state, and the two ways it can go wrong are the
   * two tests above the line.
   */

  it("does not let a slow success clear a cooldown recorded after it started", () => {
    /*
     * Missions overlap: two unscoped launches can both pass the active-mission
     * check before `driver.reachable()` resolves, and a cancelling runner can
     * outlive the launch that replaced it. So a success and a failure on the
     * same model arrive out of order.
     *
     * The older attempt succeeding must not forgive a penalty recorded by the
     * newer one -- that hands the next mission a key rate-limited seconds ago,
     * which is exactly the memory this pool exists to keep.
     */
    const pool = new ModelPool([
      { model: "gemini-a/flash-a", priority: 0 },
      { model: "gemini-b/flash-b", priority: 1 },
    ]);
    const started = 1_000_000;

    // A later mission finds the key rate limited.
    pool.penalise("gemini-a/flash-a", "rate_limited", started + 5_000);
    // The earlier attempt, begun before that, now reports success.
    pool.restore("gemini-a/flash-a", started);

    expect(pool.next(started + 6_000)).toBe("gemini-b/flash-b");
  });

  it("does not start a pool with nothing in it", () => {
    // `ModelPool` refuses to be empty, and discovery can legitimately find no
    // rotation candidates -- a machine with only a local model registered. The
    // server has to start anyway to say so, which is why the pool is optional
    // at the call site rather than built eagerly.
    expect(() => new ModelPool([])).toThrow();
  });

  // --- and the ordering that should still forgive -------------------------

  it("clears a cooldown that predates the success", () => {
    const pool = new ModelPool([
      { model: "gemini-a/flash-a", priority: 0 },
      { model: "gemini-b/flash-b", priority: 1 },
    ]);
    const now = 1_000_000;

    pool.penalise("gemini-a/flash-a", "rate_limited", now);
    pool.restore("gemini-a/flash-a", now + 5_000);

    expect(pool.next(now + 6_000)).toBe("gemini-a/flash-a");
  });

  it("still forgives unconditionally when no time is given", () => {
    // The old signature, kept working: callers that have no attempt time are
    // saying "this model is fine now" with nothing to order it against.
    const pool = new ModelPool([{ model: "only/one", priority: 0 }]);
    const now = 1_000_000;

    pool.penalise("only/one", "rate_limited", now);
    pool.restore("only/one");
    expect(pool.next(now)).toBe("only/one");
  });
});
