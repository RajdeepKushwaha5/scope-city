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
});
