import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS } from "@scope-city/harness";
import { EFFORT_LEVELS, effortLabel, effortSpriteUrl } from "./CrewModal.js";

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
