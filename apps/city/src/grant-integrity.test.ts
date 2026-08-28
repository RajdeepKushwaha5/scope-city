import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Two properties of the operator's Grant button that no pure function holds.
 *
 * Both came from review of the over-reach scenario, and both are the same
 * concern: a scripted scenario is a claim, and an operator acting during one
 * must not leave the city asserting something that is no longer true.
 *
 * What the grant *says* is tested for real in grant-summary.test.ts. What is
 * left here is wiring -- there is no DOM in this suite and no React renderer,
 * so the alternative was not a better test but none, and these are exactly the
 * lines someone tidying the handler would undo without noticing.
 */
const source = readFileSync(fileURLToPath(new URL("./useMission.ts", import.meta.url)), "utf8");

const grant = source.slice(
  source.indexOf("const grant = useCallback"),
  source.indexOf("const denyScope = useCallback"),
);

describe("granting during a scripted run takes the run over", () => {
  it("stops the replay, as deny and revoke do", () => {
    // The over-reach run proposes a wide scope at 900ms and does not report the
    // finding until 2600ms. An operator who granted in that window used to
    // leave the script running: it went on to find the gap, narrow the scope
    // and grant again, while the log still said nothing had been granted --
    // the scenario contradicting its own central claim.
    expect(grant).toContain("clearTimers()");
  });

  it("is the operator's grant, not the scripted one", () => {
    // The scripted step has its own action and must keep running the scenario.
    // Clearing timers there would stop the replay at its first grant.
    const scripted = source.slice(source.indexOf("grantScope: () =>"));
    expect(scripted.slice(0, scripted.indexOf("},"))).not.toContain("clearTimers");
  });
});

describe("granting authorises what is on the screen, once", () => {
  it("reads the scope from rendered state", () => {
    // Two wrong ways were tried first. A state updater gives the fresh scope
    // but may run twice, and does under StrictMode, so the grant went into the
    // operator's audit trail twice for one click. A ref synchronised by an
    // effect is pure but runs after paint, leaving a window where the panel
    // shows the narrowed scope and the ref still holds the wide one -- a grant
    // there authorises something other than what is displayed.
    expect(grant).toContain("const granted = scope ?? NARROW_SCOPE;");
    expect(source).not.toContain("scopeRef");
  });

  it("is rebuilt when the scope changes, which is how it stays current", () => {
    expect(source).toMatch(/const grant = useCallback\([\s\S]{0,2500}?\}, \[clearTimers, scope\]\)/);
  });

  it("keeps every state change out of the updater", () => {
    expect(grant).not.toMatch(/setScope\(\s*\(current\)/);
    expect(grant).toContain("setScope(granted);");
    expect(grant).toContain("Date.now() + granted.expiresInMs");
  });
});
