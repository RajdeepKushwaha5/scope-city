import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS } from "@scope-city/harness";
import { EFFORT_LEVELS, effortBars, effortLabel } from "./CrewModal.js";
import { modelSummary } from "./MissionOrder.js";

/**
 * The levels offered have to be the levels the harness will accept.
 *
 * TrueForge validates `reasoningEffort` against what the registered model
 * declares and refuses the session with a 422 otherwise. Offering a level the
 * slots do not declare produces a dispatch that dies at session creation, after
 * the operator has already pressed the button.
 */
describe("offered effort levels", () => {
  it("offers exactly what the harness contract declares", () => {
    // Asserted against the imported constant rather than by parsing
    // setup-models.ts for a regex match, which is what this used to do. A test
    // that reads source text passes or fails on formatting, and would have gone
    // green against a file that no longer registered anything at all.
    expect([...EFFORT_LEVELS]).toEqual([...REASONING_EFFORTS]);
  });

  it("labels every level it offers", () => {
    for (const level of EFFORT_LEVELS) {
      expect(effortLabel(level).length).toBeGreaterThan(0);
    }
  });

  it("gives every level a different gauge", () => {
    /*
     * These were three PNG portraits, and they were not ours -- byte-identical
     * copies of another project's crew art, renamed. The tests here asserted a
     * URL built from `BASE_URL` and a file behind every level; both questions
     * stopped existing when the files did.
     *
     * What is worth asserting now is that the drawn gauge still distinguishes
     * the levels, because a control where every option looks the same is worse
     * than one with no picture at all.
     */
    const bars = EFFORT_LEVELS.map((level) => effortBars(level));
    expect(new Set(bars).size).toBe(EFFORT_LEVELS.length);
  });

  it("fills more bars for more thinking", () => {
    // The shape carries the meaning: low is one bar, high is three. A portrait
    // never said which way round the setting went.
    expect(effortBars("low")).toBeLessThan(effortBars("high"));
  });

});

describe("naming the models a mission will run on", () => {
  it("does not claim one when there is nobody to ask", () => {
    // The deployed city has no control plane, so it cannot know what a harness
    // would rotate over. It said "gemini-2.5-flash - 4 rotating keys" anyway.
    expect(modelSummary(null)).toBe("model set by the harness this connects to");
    expect(modelSummary(undefined)).toBe("model set by the harness this connects to");
  });

  it("warns when the harness has nothing to rotate onto", () => {
    // A real state, not a missing answer: a machine with only an opt-in model
    // registered discovers no rotation candidates, and a mission there will
    // fail to find one. Better said before Dispatch than after.
    expect(modelSummary([])).toContain("dispatch will fail");
  });

  it("names the one model when there is one", () => {
    expect(modelSummary(["local/qwen"])).toBe("local/qwen \u2022 one model");
  });

  it("counts what is actually registered", () => {
    // The old string said four whatever the count was. Set two Gemini keys and
    // the other two slots are skipped for want of a credential.
    expect(modelSummary(["gemini-a/flash-a", "gemini-b/flash-b"])).toContain("2 models in rotation");
    expect(modelSummary(["a", "b", "c", "d"])).toContain("4 models in rotation");
  });

  it("says which one, not only how many", () => {
    expect(modelSummary(["local/qwen", "gemini-a/flash-a"])).toContain("local/qwen");
  });
});
