import { describe, expect, it } from "vitest";
import { labelFor } from "./scene.js";

/**
 * The harness chooses these strings and nothing bounds their length. The two it
 * actually produces are short; this is about what it might send tomorrow.
 */
describe("subagent figure labels", () => {
  it("leaves the titles the harness actually sends alone", () => {
    // Observed on a real run. Truncating either would lose the distinction the
    // label exists to draw.
    expect(labelFor("Source investigator")).toBe("Source investigator");
    expect(labelFor("Target verifier")).toBe("Target verifier");
  });

  it("cuts a title too long for a figure to carry", () => {
    const long = "Investigate the charge and report whether it was already refunded";
    const label = labelFor(long);

    expect(label.length).toBeLessThanOrEqual(22);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
  });

  it("shows that it cut, rather than cutting silently", () => {
    // A silently truncated label reads as the harness having sent a shorter
    // name than it did, which is a quieter kind of wrong.
    expect(labelFor("A".repeat(60)).endsWith("…")).toBe(true);
    expect(labelFor("Target verifier").endsWith("…")).toBe(false);
  });

  it("flattens whitespace so a newline cannot break the line", () => {
    // fillText draws a newline as a box glyph rather than wrapping, so a title
    // containing one would paint rubbish over the city.
    expect(labelFor("Source\n  investigator")).toBe("Source investigator");
    expect(labelFor("  Target verifier  ")).toBe("Target verifier");
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(labelFor("Source investigator and verifier")).not.toMatch(/ …$/);
  });

  it("survives an empty title without producing a stray mark", () => {
    expect(labelFor("")).toBe("");
    expect(labelFor("   ")).toBe("");
  });
});

describe("labels that would paint nothing, or paint it wrongly", () => {
  it("cuts on code points, so an emoji is not split in half", () => {
    // `slice` works in UTF-16 units. A title carrying anything outside the BMP
    // can be cut through the middle of a surrogate pair, and the canvas then
    // draws a replacement glyph -- a worse label than the one being shortened.
    const label = labelFor("🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️🛰️");

    expect(label).not.toContain("\uFFFD");
    // Every unit that is half of a pair must have its other half.
    for (const char of label) expect(char.length === 1 || char.length >= 2).toBe(true);
    expect(label.endsWith("…")).toBe(true);
  });

  it("counts a multi-unit character as one, not two", () => {
    // Twenty-two astral characters is twenty-two code points, so it fits and
    // must not be truncated for being forty-four UTF-16 units long.
    const exact = "𝔄".repeat(22);
    expect(labelFor(exact)).toBe(exact);
  });
});
