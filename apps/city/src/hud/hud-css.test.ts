import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural checks on the HUD stylesheet.
 *
 * Every one of these has already shipped broken once. `.hud` was defined twice
 * and the second block silently replaced the first's padding and gap; the
 * overlay rule was applied at one level and undone at the next; a scrollbar was
 * styled for an element that could not scroll. None of them breaks a build and
 * none is visible in a diff, so they are asserted here instead.
 */

const css = readFileSync(fileURLToPath(new URL("./hud.css", import.meta.url)), "utf8");
const NL = String.fromCharCode(10);

/**
 * Every top-level selector, including the members of a grouped rule.
 *
 * `.a,` on its own line followed by `.b {` is one rule declaring two selectors,
 * and matching only the line that carries the brace missed the rest. A second
 * definition of `.hud__main` hidden inside a group would then have evaded the
 * uniqueness check entirely, which is the one thing that check exists to catch.
 */
function topLevelSelectors(): string[] {
  const out: string[] = [];
  let pending: string[] = [];

  // Split on either ending. A Windows checkout leaves CRLF in the working tree
  // while CI checks out LF, and a test that quietly matches nothing on one of
  // them is worse than no test at all.
  for (const raw of css.split(/\r?\n/)) {
    const text = raw.trim();

    // Indented lines are inside a media query or a keyframe block.
    if (raw !== text) continue;
    if (text === "" || text.startsWith("*") || text.startsWith("/")) continue;

    if (text.endsWith(",")) {
      pending.push(text.slice(0, -1).trim());
      continue;
    }

    const brace = text.indexOf("{");
    if (brace === -1) {
      pending = [];
      continue;
    }

    const head = text.slice(0, brace).trim();
    if (!head.startsWith("@")) out.push(...pending, ...(head ? [head] : []));
    pending = [];
  }

  return out.filter(Boolean);
}

/**
 * The declarations of one top-level rule.
 *
 * Asserting on these rather than on the selector appearing anywhere in the file
 * is the difference between checking that a rule does the right thing and
 * checking that somebody typed its name.
 */
function propertiesOf(selector: string): string {
  const at = css.indexOf(NL + selector + " {");
  expect(at, selector + " is not defined at the top level").toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("the HUD stylesheet", () => {
  it("finds the selectors it claims to check", () => {
    // The parser above is the thing every other test here leans on. If it ever
    // matches nothing -- a line-ending change did exactly that once -- the
    // uniqueness check silently passes over an empty list.
    const all = topLevelSelectors();
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain(".hud");
    expect(all).toContain(".hud__main");
    expect(all).toContain(".hud__scan-stack");
  });

  it("defines each layout container exactly once", () => {
    // A second block wins silently over the first. `.hud` was defined twice and
    // the later block quietly replaced its padding and gap, which is the
    // hardest kind of CSS bug to see in a diff.
    //
    // Scoped to the containers that decide where everything sits and whether
    // the map can be clicked. The rest of the file has its own duplication to
    // answer for, but a duplicated `.btn` makes a button look wrong; a
    // duplicated `.hud__main` makes the city unusable.
    for (const selector of [".hud", ".hud__main", ".hud__scan-stack"]) {
      const count = topLevelSelectors().filter((s) => s === selector).length;
      expect(count, selector + " is defined " + count + " times").toBe(1);
    }
  });

  it("keeps the full-viewport containers transparent to the pointer", () => {
    // `.hud` and `.hud__main` both span areas of the map that hold nothing.
    // Either one left with `pointer-events: auto` becomes a lid over the
    // canvas, and the operator's drag never reaches the city.
    for (const selector of [".hud", ".hud__main"]) {
      expect(
        propertiesOf(selector),
        selector + " must not capture pointer events",
      ).toContain("pointer-events: none");
    }
  });

  it("gives the panels inside those containers their clicks back", () => {
    // The other half, asserted on the declaration rather than on the selector
    // merely existing: a rule present but setting something else would pass the
    // weaker check while leaving every panel dead.
    for (const selector of [".hud > *", ".hud__main > *"]) {
      expect(
        propertiesOf(selector),
        selector + " must restore pointer events",
      ).toContain("pointer-events: auto");
    }
  });

  it("keeps the scroll container clickable, so its scrollbar works", () => {
    // Guards a revert. Making the scan stack transparent closed the 10px gaps
    // between panels and cost the scrollbar with them: `pointer-events: none`
    // on a scroll container makes the bar undraggable in Firefox and kills
    // hover-triggered overlay scrollbars. A short screen could then see that
    // panels continue below the fold and have no way to reach them.
    expect(propertiesOf(".hud__scan-stack")).not.toContain("pointer-events: none");
  });

  it("only styles a scrollbar on something that can scroll", () => {
    // The scan stack had a styled scrollbar and no `overflow` for a release.
    expect(propertiesOf(".hud__scan-stack")).toContain("overflow-y: auto");
  });
});
