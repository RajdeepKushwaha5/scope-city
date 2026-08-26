import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENARIO_BILLING, type Scenario } from "./ScenarioBanner.js";

/**
 * The banner states what a run will show before it shows it. That is a
 * commitment, so the thing worth testing is that the commitment exists for
 * every run and is not quietly boilerplate.
 */

const SCENARIOS: readonly Scenario[] = ["recorded", "clean", "poisoned", "noscope"];

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
});
