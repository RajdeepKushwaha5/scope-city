import { describe, expect, it } from "vitest";
import { ModelPool, classifyFailure, isWorthRotating } from "../src/index.js";

const NOW = 1_700_000_000_000;

const pool = () =>
  new ModelPool([
    { model: "flash-a", priority: 0 },
    { model: "flash-b", priority: 1 },
    { model: "flash-c", priority: 2 },
  ]);

describe("ModelPool — a rate limit should not end a demo", () => {
  it("hands back the best model first", () => {
    expect(pool().next(NOW)).toBe("flash-a");
  });

  it("moves on when the first is rate limited", () => {
    const p = pool();
    p.penalise("flash-a", "rate_limited", NOW);
    expect(p.next(NOW)).toBe("flash-b");
  });

  it("returns to the preferred model once its cooldown passes", () => {
    const p = pool();
    p.penalise("flash-a", "rate_limited", NOW);
    expect(p.next(NOW + 61_000)).toBe("flash-a");
  });

  it("keeps an exhausted quota out of the way for hours, not a minute", () => {
    // A daily quota will not come back inside a demo. Retrying it every minute
    // just spends a request to be told no again.
    const p = pool();
    p.penalise("flash-a", "quota_exhausted", NOW);
    expect(p.next(NOW + 5 * 60_000)).toBe("flash-b");
  });

  it("returns undefined when everything is cooling, rather than a bad suggestion", () => {
    // Handing back a model known to be rate limited produces a confusing
    // failure one layer down, where the caller can no longer explain it.
    const p = pool();
    for (const m of ["flash-a", "flash-b", "flash-c"]) p.penalise(m, "rate_limited", NOW);
    expect(p.next(NOW)).toBeUndefined();
  });

  it("says when the pool will have something again", () => {
    const p = pool();
    for (const m of ["flash-a", "flash-b", "flash-c"]) p.penalise(m, "rate_limited", NOW);
    expect(p.nextAvailableAt(NOW)).toBe(NOW + 60_000);
  });

  it("clears a cooldown when a model works again", () => {
    const p = pool();
    p.penalise("flash-a", "rate_limited", NOW);
    p.restore("flash-a");
    expect(p.next(NOW)).toBe("flash-a");
  });

  it("refuses to be built empty", () => {
    expect(() => new ModelPool([])).toThrow(/at least one/);
  });
});

describe("classifyFailure — err toward the shorter cooldown", () => {
  it("reads a 429 as a rate limit", () => {
    expect(classifyFailure({ statusCode: 429 })).toBe("rate_limited");
  });

  it("reads Gemini's RESOURCE_EXHAUSTED as a rate limit", () => {
    expect(classifyFailure(new Error("RESOURCE_EXHAUSTED: quota"))).toBe("quota_exhausted");
  });

  it("reads an explicit quota message as exhausted", () => {
    expect(
      classifyFailure(new Error("You exceeded your current quota")),
    ).toBe("quota_exhausted");
  });

  it("reads a 503 as temporarily unavailable", () => {
    expect(classifyFailure({ statusCode: 503 })).toBe("unavailable");
  });

  it("rotates when one provider entry rejects its credentials", () => {
    const fromStatus = classifyFailure({ statusCode: 401 });
    const fromTrueForgeMessage = classifyFailure(new Error("Request failed (403): Forbidden"));

    expect(fromStatus).toBe("credential_rejected");
    expect(fromTrueForgeMessage).toBe("credential_rejected");
    expect(isWorthRotating(fromTrueForgeMessage)).toBe(true);
  });

  it("treats a malformed request as not worth rotating for", () => {
    // A bad spec fails identically on every model; rotating multiplies noise.
    const kind = classifyFailure({ statusCode: 400, body: { message: "bad spec" } });
    expect(kind).toBe("other");
    expect(isWorthRotating(kind)).toBe(false);
  });

  it("treats every transient failure as worth rotating for", () => {
    for (const kind of [
      "rate_limited",
      "quota_exhausted",
      "credential_rejected",
      "unavailable",
    ] as const) {
      expect(isWorthRotating(kind)).toBe(true);
    }
  });
});
