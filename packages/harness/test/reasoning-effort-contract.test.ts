import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS, isReasoningEffort, parseReasoningEffort } from "../src/index.js";

/**
 * Only an absent field may launch without an effort.
 *
 * The first version coerced anything that was not a string to `""` and treated
 * that as "no preference", so a number, a boolean, an array, an object or null
 * all launched as though the field had never been sent. A malformed request
 * quietly becoming a different valid request is worse than one that is refused.
 */
describe("parsing a requested effort", () => {
  it("accepts every level the slots register", () => {
    for (const level of REASONING_EFFORTS) {
      expect(parseReasoningEffort(level)).toEqual({ ok: true, effort: level });
    }
  });

  it("treats an absent field as no preference", () => {
    expect(parseReasoningEffort(undefined)).toEqual({ ok: true, effort: null });
  });

  it("refuses anything present that is not a supported level", () => {
    // null is included deliberately: it is *present*, so it is a malformed
    // request rather than an omission, and it was one of the values the old
    // coercion let through.
    for (const bad of [null, 0, 1, true, false, [], {}, "", "HIGH", "max", "banana"]) {
      const parsed = parseReasoningEffort(bad);
      expect(parsed.ok, `${JSON.stringify(bad)} should be refused`).toBe(false);
    }
  });

  it("says what would have been acceptable", () => {
    const parsed = parseReasoningEffort("banana");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      for (const level of REASONING_EFFORTS) expect(parsed.reason).toContain(level);
    }
  });

  it("narrows the type, so callers cannot forget the check", () => {
    const value: unknown = "medium";
    expect(isReasoningEffort(value)).toBe(true);
    expect(isReasoningEffort("xhigh")).toBe(false);
  });

  it("offers only levels TrueForge will accept for these models", () => {
    // TrueForge's enum has seven; these slots register three. Offering one the
    // slots do not declare produces a dispatch the operator has already pressed
    // and which then dies at session creation with a 422.
    expect([...REASONING_EFFORTS]).toEqual(["low", "medium", "high"]);
  });
});
