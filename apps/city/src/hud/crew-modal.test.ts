import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The thinking-effort dialogue, and where its words ended up.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const modal = read("./CrewModal.tsx");
const css = read("./hud.css");

/** The declarations of one top-level rule. */
function rule(selector: string): string {
  const at = css.indexOf("\n" + selector + " {");
  expect(at, selector + " is not defined at the top level").toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("a card in the effort dialogue", () => {
  it("puts one thing in each of its two columns", () => {
    // The card is `grid-template-columns: 100px 1fr` and had three children:
    // image, name, description. A grid places what it is given -- the first two
    // took the row and the description wrapped onto a second row in the *image*
    // column, under the portrait and hard against the card's left edge. It read
    // as a caption that had come adrift, which is what it was.
    const card = modal.slice(
      modal.indexOf('className="crew-modal-v2__card-img"'),
      modal.indexOf("</button>", modal.indexOf('className="crew-modal-v2__card-img"')),
    );

    expect(card).toContain("crew-modal-v2__card-text");
    // The name and the description are inside that one wrapper.
    const text = card.slice(card.indexOf("crew-modal-v2__card-text"));
    expect(text).toContain("crew-modal-v2__card-name");
    expect(text).toContain("crew-modal-v2__card-desc");
  });

  it("stacks its name over its own description", () => {
    expect(rule(".crew-modal-v2__card-text")).toContain("flex-direction: column");
  });

  it("gives its text room away from the frame", () => {
    // The card had `padding: 0`, so the description touched the border it sat in.
    expect(rule(".crew-modal-v2__card")).not.toContain("padding: 0;");
  });
});

describe("the dialogue itself", () => {
  it("pads the part between the header and the footer", () => {
    // The box has `padding: 0` so the header and footer can run their own rules
    // to the border. The subtitle and the options were siblings of those with no
    // padding of their own, so both sat hard against the amber frame.
    expect(rule(".crew-modal-v2__body")).toContain("padding: 14px 20px 16px");
  });

  it("keeps its footer on the screen", () => {
    // Below 640px the options stack, and neither the overlay nor the box had a
    // height limit while `.dialogue-box` clips its overflow -- so on a portrait
    // phone the content ran past the bottom and took Cancel and Confirm with it.
    // Verified at 360x480: the footer's bottom edge lands at 442 of 480.
    const box = rule(".crew-modal-v2");
    expect(box).toContain("max-height:");
    expect(box).toContain("overflow: hidden");
  });

  it("lets the middle scroll rather than the page", () => {
    // The header and the footer stay put; the options move between them. That is
    // the arrangement where the two controls that close a dialogue are always
    // reachable however short the screen is.
    const body = rule(".crew-modal-v2__body");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("min-height: 0");
  });

  it("fits three cards across the box it actually has", () => {
    // The box is 780px at most, less 8px of border and 40 of body padding, which
    // leaves 732 -- and three 240px columns with two 8px gaps need 736. Four
    // pixels short, so the row broke to two-up and left a third of the dialogue
    // empty. The floor has to be arithmetic against the box, not a round number.
    const grid = rule(".crew-modal-v2__thinking-grid");
    const floor = /minmax\((\d+)px/.exec(grid);
    const gap = /gap: (\d+)px/.exec(grid);
    expect(floor, "the grid has no column floor").not.toBeNull();
    expect(gap).not.toBeNull();

    const inner = 780 - 8 - 40;
    const needed = Number(floor![1]) * 3 + Number(gap![1]) * 2;
    expect(needed, `three columns need ${needed}px and there are ${inner}`).toBeLessThanOrEqual(inner);
  });
});
