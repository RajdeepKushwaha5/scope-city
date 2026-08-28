import { describe, expect, it } from "vitest";
import { grantLine } from "./grant-summary.js";
import { NARROW_SCOPE, WIDE_SCOPE } from "./useMission.js";

/**
 * The over-reach run is the reason this is counted rather than written out: the
 * operator is shown a wide scope, the Yard finds a gap in it, and it is
 * narrowed before anything is granted. Whichever one they grant, the log has to
 * say what they actually did.
 */
describe("the grant line describes the scope that was granted", () => {
  it("counts the narrowed scope when that is what was granted", () => {
    const allowed = NARROW_SCOPE.offices.filter((o) => o.disposition === "allowed").length;
    const gated = NARROW_SCOPE.offices.filter((o) => o.disposition === "gated").length;

    expect(grantLine(NARROW_SCOPE)).toBe(
      `Scope granted. ${allowed} offices allowed, ${gated} gated, everything else absent.`,
    );
  });

  it("says something different for the wider one", () => {
    // The whole point. A constant sentence read correctly for the narrow scope
    // and lied for the wide one, which is the one worth being accurate about.
    expect(grantLine(WIDE_SCOPE)).not.toBe(grantLine(NARROW_SCOPE));
  });

  it("says the wide scope allows more than the narrowed one", () => {
    // The gap the Yard finds is customer.list: allowed in the wide scope,
    // blocked once narrowed. The sentence has to move with it, since it is the
    // operator's record of how much reach they just handed over.
    expect(grantLine(WIDE_SCOPE)).toContain("3 offices allowed");
    expect(grantLine(NARROW_SCOPE)).toContain("2 offices allowed");
  });

  it("does not claim anything for a scope with no offices", () => {
    expect(grantLine({ ...NARROW_SCOPE, offices: [] })).toContain("0 offices allowed, 0 gated");
  });
});
