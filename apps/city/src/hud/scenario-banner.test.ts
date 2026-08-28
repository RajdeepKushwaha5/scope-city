import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENARIO_BILLING, type Scenario } from "./ScenarioBanner.js";

/**
 * The banner states what a run will show before it shows it. That is a
 * commitment, so the thing worth testing is that the commitment exists for
 * every run and is not quietly boilerplate.
 */

const SCENARIOS: readonly Scenario[] = ["recorded", "clean", "poisoned", "overreach", "noscope"];

describe("scenario billing", () => {
  it("covers every scenario the app can run", () => {
    // `runScenario` in App.tsx accepts exactly this union. A scenario reachable
    // from the nav with no billing would show a viewer an unexplained run.
    const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

    for (const scenario of SCENARIOS) {
      expect(SCENARIO_BILLING[scenario]).toBeDefined();
      expect(app).toContain(`runScenario("${scenario}")`);
    }
    expect(Object.keys(SCENARIO_BILLING).sort()).toEqual([...SCENARIOS].sort());
  });

  it("says something specific about each run", () => {
    for (const scenario of SCENARIOS) {
      const { name, watchFor } = SCENARIO_BILLING[scenario];
      expect(name.length).toBeGreaterThan(0);
      // Long enough to be a claim rather than a label. "Poisoned ticket" as its
      // own explanation tells a first-time viewer nothing.
      expect(watchFor.length).toBeGreaterThan(40);
    }
  });

  it("gives no two runs the same billing", () => {
    // Copy-pasted billing is worse than none: it reads as an explanation while
    // explaining the wrong run.
    const claims = SCENARIOS.map((s) => SCENARIO_BILLING[s].watchFor);
    expect(new Set(claims).size).toBe(SCENARIOS.length);

    const names = SCENARIOS.map((s) => SCENARIO_BILLING[s].name);
    expect(new Set(names).size).toBe(SCENARIOS.length);
  });

  it("promises a refusal only for the run that is refused", () => {
    // The poisoned ticket is the one where stopping is the success condition,
    // and it is the only one where a viewer needs telling that in advance.
    expect(SCENARIO_BILLING.poisoned.watchFor).toMatch(/refus/i);
    expect(SCENARIO_BILLING.clean.watchFor).not.toMatch(/refused at/i);
  });

  it("does not promise an ending the scripted run never reaches", () => {
    // The first version of this table said the clean job "finishes inside its
    // scope". It does not: CLEAN_JOB ends by raising a gate and waiting for a
    // countersign, so the banner was promising an ending the run never gets
    // to -- exactly the failure this component exists to make visible, made by
    // the component itself.
    //
    // Read out of the script rather than asserted from memory, so rewriting a
    // scenario to end differently fails here instead of shipping a banner that
    // quietly lies.
    const source = readFileSync(
      fileURLToPath(new URL("../useMission.ts", import.meta.url)),
      "utf8",
    );

    for (const [scenario, marker] of [
      ["clean", "const CLEAN_JOB"],
      ["poisoned", "const POISONED"],
      // OVER_REACH is deliberately absent: it is the one scripted run that ends
      // at a grant rather than a gate, which the assertions below would read as
      // a broken claim. Its own ending is checked separately.
    ] as const) {
      const start = source.indexOf(marker);
      expect(start, `${marker} not found`).toBeGreaterThan(-1);

      const end = source.indexOf("];", start);
      expect(end, `${marker} has no terminator`).toBeGreaterThan(start);

      const script = source.slice(start, end);

      // Asserted, not branched on. Guarding the real assertion behind
      // `if (script.includes(...))` made this test able to pass by finding
      // nothing -- a rename of the step helper, or a bad slice, would have
      // silently skipped the check instead of failing it. Both of these
      // scripts do end at a gate today, so both must be seen to.
      const gateAt = script.indexOf("a.gate({");
      expect(gateAt, `${marker} no longer raises a gate`).toBeGreaterThan(-1);
      expect(SCENARIO_BILLING[scenario].watchFor).toMatch(/gate/i);

      // "Stops at the Gate" is a claim about the *end* of the run, not about a
      // gate happening somewhere in it. A script that raised a gate and then
      // carried on would make the billing wrong in the same way the recorded
      // run's did, so the gate has to be the last step rather than merely
      // present.
      const afterGate = script.slice(gateAt);
      expect(
        afterGate.indexOf("run: ("),
        `${marker} has steps after its gate, so it does not stop there`,
      ).toBe(-1);
    }
  });

  it("says the recorded run completes, because the record carries its approval", () => {
    // The same mistake, made twice. Correcting "the clean job finishes" to
    // "stops at the Gate" was then applied to the recorded run, which does hold
    // at the gate -- and then carries straight through it, because the record
    // contains the approval that was actually given. Billing it as stopping
    // would leave a viewer waiting to countersign something that never asks.
    const recording = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../public/replays/refund-184.json", import.meta.url)),
        "utf8",
      ),
    ) as { entries: readonly { event?: { type?: string; status?: string } }[] };

    const final = [...recording.entries]
      .reverse()
      .find((entry) => entry.event?.type === "mission.status")?.event?.status;

    expect(final).toBe("completed");
    expect(SCENARIO_BILLING.recorded.watchFor).toMatch(/complete/i);
  });

  it("tells the viewer the no-scope run fails rather than stopping", () => {
    // The only run that does not end at the gate. It ends `failed`, and a
    // viewer told to "watch how far it reaches" has no way to know that the
    // ending is the point.
    expect(SCENARIO_BILLING.noscope.watchFor).toMatch(/fail/i);
  });

  it("bills the over-reach run as ending in a narrowed grant, not a gate", () => {
    // The only scripted run that ends before enforcement rather than at it.
    // Billing it like the others would promise a held gate that never comes.
    const source = readFileSync(
      fileURLToPath(new URL("../useMission.ts", import.meta.url)),
      "utf8",
    );
    const start = source.indexOf("const OVER_REACH");
    const script = source.slice(start, source.indexOf("];", start));

    expect(script).not.toContain("a.gate({");
    expect(script).toContain("a.grantScope()");
    expect(SCENARIO_BILLING.overreach.watchFor).toMatch(/narrow/i);
    expect(SCENARIO_BILLING.overreach.watchFor).not.toMatch(/gate/i);
  });
});

describe("the over-reach run narrows something real", () => {
  const source = readFileSync(fileURLToPath(new URL("../useMission.ts", import.meta.url)), "utf8");
  const script = source.slice(
    source.indexOf("const OVER_REACH"),
    source.indexOf("];", source.indexOf("const OVER_REACH")),
  );

  it("proposes a wider scope and then a narrower one", () => {
    // Logging "narrowed" while the scope never changes is the gap between
    // stated and actual that this project exists to argue against, committed in
    // the scenario meant to demonstrate it.
    expect(script).toContain("a.proposeScope(WIDE_SCOPE)");
    expect(script).toContain("a.proposeScope(NARROW_SCOPE)");
    expect(script.indexOf("WIDE_SCOPE")).toBeLessThan(script.indexOf("NARROW_SCOPE"));
  });

  it("makes the wide scope genuinely wider", () => {
    // A "wide" scope identical to the narrow one would render an identical map
    // and narrow nothing.
    const wide = source.slice(source.indexOf("const WIDE_SCOPE"), source.indexOf("};", source.indexOf("const WIDE_SCOPE")));
    expect(wide).toContain('office: "customer.list", disposition: "allowed"');

    const narrow = source.slice(source.indexOf("const NARROW_SCOPE"), source.indexOf("};", source.indexOf("const NARROW_SCOPE")));
    expect(narrow).toContain('office: "customer.list", disposition: "blocked"');
  });

  it("probes without recording a call against the office", () => {
    // `settle` increments the call counter, which the inspector renders as
    // "Calls 1" beside a Yard panel saying nothing was called.
    expect(script).toContain("a.probe(");
    expect(script).not.toContain("a.settle(");
  });

  it("reports the finding for each office it probes", () => {
    for (const office of ["charge.get", "customer.list"]) {
      expect(script, `${office} probed but not reported`).toContain(`office: "${office}"`);
    }
  });
});
