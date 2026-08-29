import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS } from "@scope-city/harness";
import { EFFORT_LEVELS, effortLabel, effortSpriteUrl } from "./CrewModal.js";
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

  it("builds sprite paths from the base url, so judge mode does not 404", () => {
    // Judge mode is served from a repository subpath. A hardcoded "/crew/..."
    // resolves against the domain root and 404s there, which is the same bug
    // the recording URL was written to avoid.
    //
    // Asserted against BASE_URL itself rather than against a literal: under
    // test the base is "/", so checking that the path does not start with
    // "/crew/" would pass for the hardcoded version too and prove nothing.
    const base = import.meta.env.BASE_URL;
    const url = effortSpriteUrl("low");

    expect(url).toBe(`${base}crew/effort-low.png`);
    expect(url.startsWith(base)).toBe(true);
  });

  it("names a sprite that exists for every level offered", () => {
    // A level with no artwork renders a broken image in the dialog.
    for (const level of EFFORT_LEVELS) {
      const file = effortSpriteUrl(level).split("/").pop()!;
      expect(existsSync(fileURLToPath(new URL(`../../public/crew/${file}`, import.meta.url)))).toBe(
        true,
      );
    }
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
