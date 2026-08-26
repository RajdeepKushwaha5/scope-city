import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural checks on the HUD stylesheet.
 *
 * Both of these have already shipped once. `.hud` was defined twice, the second
 * block silently overriding the first's padding and gap, and the pointer-events
 * overlay rule was applied at one level and then undone at the next. Neither is
 * visible in review and neither breaks a build, so they are asserted here.
 */

const css = readFileSync(fileURLToPath(new URL("./hud.css", import.meta.url)), "utf8");

/** Top-level selectors only: anything indented is inside a media query. */
function topLevelSelectors(): string[] {
  return [...css.matchAll(/^(\S[^{@\n]*)\{/gm)].map((m) => m[1]!.trim()).filter(Boolean);
}

describe("the HUD stylesheet", () => {
  it("defines each layout container exactly once", () => {
    // A second block wins silently over the first. `.hud` was defined twice and
    // the later block quietly replaced its padding and gap, which is the
    // hardest kind of CSS bug to see in a diff.
    //
    // Scoped to the three containers that decide where everything sits and
    // whether the map can be clicked. The rest of the file has its own
    // duplication to answer for, but a duplicated `.btn` makes a button look
    // wrong; a duplicated `.hud__main` makes the city unusable.
    for (const selector of [".hud", ".hud__main", ".hud__scan-stack"]) {
      const count = topLevelSelectors().filter((s) => s === selector).length;
      expect(count, `${selector} is defined ${count} times`).toBe(1);
    }
  });

  it("keeps every full-viewport container transparent to the pointer", () => {
    // `.hud`, `.hud__main` and `.hud__scan-stack` all span areas of the map that
    // hold nothing. Any of them left with `pointer-events: auto` becomes a lid
    // over the canvas, and the operator's drag never reaches the city.
    for (const selector of [".hud", ".hud__main", ".hud__scan-stack"]) {
      const block = css.slice(css.indexOf(`\n${selector} {`));
      const body = block.slice(0, block.indexOf("}"));
      expect(body, `${selector} must not capture pointer events`).toContain(
        "pointer-events: none",
      );
    }
  });

  it("gives the panels inside those containers their clicks back", () => {
    // The other half. Making a container transparent without restoring its
    // children makes the panels unusable instead of the map.
    for (const selector of [".hud > *", ".hud__main > *", ".hud__scan-stack > *"]) {
      expect(css, `${selector} must restore pointer events`).toContain(`${selector} {`);
    }
  });

  it("only styles a scrollbar on something that can scroll", () => {
    // The scan stack had a styled scrollbar and no `overflow` for a release.
    const block = css.slice(css.indexOf("\n.hud__scan-stack {"));
    expect(block.slice(0, block.indexOf("}"))).toContain("overflow-y: auto");
  });
});
