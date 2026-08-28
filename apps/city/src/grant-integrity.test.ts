import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Two properties of the operator's Grant button that no pure function holds.
 *
 * Both were reported by review on the over-reach scenario, and both are about
 * the same thing: a scripted scenario is a claim, and an operator acting during
 * one must not leave the city asserting something that is no longer true.
 *
 * Read from the source deliberately. There is no DOM in this suite and no React
 * renderer, so the alternative was not a better test but no test -- and these
 * are exactly the lines someone tidying the handler would undo without noticing.
 */
const source = readFileSync(
  fileURLToPath(new URL("./useMission.ts", import.meta.url)),
  "utf8",
);

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
    expect(source).toMatch(/const grant = useCallback\([\s\S]{0,3000}?\}, \[clearTimers\]\)/);
  });

  it("is the operator's grant, not the scripted one", () => {
    // The scripted step has its own action and must keep running the scenario.
    // Clearing timers there would stop the replay at its first grant.
    const scripted = source.slice(source.indexOf("grantScope: () =>"));
    expect(scripted.slice(0, scripted.indexOf("},"))).not.toContain("clearTimers");
  });
});

describe("granting once records it once", () => {
  it("keeps side effects out of the state updater", () => {
    // React may run an updater more than once and does under the StrictMode
    // this app is wrapped in, so logging the grant inside one wrote it into the
    // operator's audit trail twice and started the expiry clock twice from
    // slightly different instants. An audit line that appears twice for one
    // decision is the wrong kind of wrong in this project.
    expect(grant).not.toMatch(/setScope\(\s*\(current\)/);
    expect(grant).toContain("scopeRef.current ?? NARROW_SCOPE");
  });

  it("still logs what was actually granted", () => {
    // The counts come from the granted scope rather than a constant: the
    // over-reach run lets the operator grant either the wide scope or the
    // narrowed one, and the log has to say which.
    expect(grant).toContain('granted.offices.filter((o) => o.disposition === "allowed")');
    expect(grant).toContain("Date.now() + granted.expiresInMs");
  });

  it("keeps the mirror that makes reading the scope safe", () => {
    // The ref replaces the updater. Without it the handler closes over the
    // scope from first render and grants whatever was proposed then.
    expect(source).toContain("scopeRef.current = scope;");
    expect(source).toMatch(/scopeRef\.current = scope;\s*\}, \[scope\]\)/);
  });
});
