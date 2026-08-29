import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toScreen } from "../iso/projection.js";
import { fitCamera } from "./scene.js";
import {
  HOARDINGS,
  fountainCells,
  isHoardingCell,
  layOutCity,
  treeCells,
} from "./world.js";
import { OFFICES } from "../useMission.js";

/**
 * The boards along the waterfront, and the two things that make one real: it
 * has ground of its own, and somebody can see it.
 */

const city = layOutCity(OFFICES);

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("the ground a hoarding stands on", () => {
  it("is not shared with a building", () => {
    // The two boards that existed were drawn without reserving anything: the
    // renderer knew where they stood and the layout did not. Nothing had gone
    // wrong yet, which is the whole problem -- it would have gone wrong the
    // next time a district gained an office and shifted the filler.
    for (const board of HOARDINGS) {
      const clash = city.find(
        (b) => b.cell.u === board.cell.u && b.cell.v === board.cell.v,
      );
      expect(clash, `${board.title} shares its cell with a building`).toBeUndefined();
    }
  });

  it("is not shared with a tree or a fountain", () => {
    // A street tree grows to about the height of the face. This is the version
    // of the bug that would actually have shown up in the video.
    const taken = [...treeCells(city), ...fountainCells(city)];
    for (const board of HOARDINGS) {
      const clash = taken.find((c) => c.u === board.cell.u && c.v === board.cell.v);
      expect(clash, `${board.title} shares its cell with vegetation`).toBeUndefined();
    }
  });

  it("reports its own cells as reserved", () => {
    for (const board of HOARDINGS) {
      expect(isHoardingCell(board.cell.u, board.cell.v)).toBe(true);
    }
    expect(isHoardingCell(20, 17)).toBe(false);
  });
});

describe("a hoarding nobody can see", () => {
  /*
   * A reference screen, and the HUD's own rectangles on it -- measured in the
   * browser rather than derived from the stylesheet, because a panel's height
   * is whatever its contents came to.
   *
   * Desktop only, and deliberately. The review pointed out that at 700px the
   * boards are all behind the HUD, which is true and is not something a
   * placement can fix: the narrow layout gives the scan column 322px and the
   * console 294px, so 616 of 700 pixels are panel and every board in every
   * position is covered. So is most of the city. What that finding describes is
   * the HUD's behaviour on a phone, not the boards'; pretending otherwise by
   * moving them would only make them invisible on a desktop as well.
   */
  const viewport = { width: 1382, height: 748 };
  const PANELS: readonly Rect[] = [
    { left: 14, top: 14, right: 324, bottom: 449 }, // the scan stack
    { left: 14, top: 449, right: 574, bottom: 734 }, // the mission order
    { left: 1028, top: 14, right: 1368, bottom: 734 }, // the console
  ];

  const camera = fitCamera(viewport);
  const z = camera.zoom;

  /** Where a world point lands on that screen. */
  const at = (u: number, v: number, h = 0) => {
    const p = toScreen(u, v, h);
    return {
      x: viewport.width / 2 + camera.x + p.x * z,
      y: viewport.height / 2 + camera.y + p.y * z,
    };
  };

  /** The face and posts, from the rectangles `drawBillboard` fills. */
  const faceOf = (board: (typeof HOARDINGS)[number]): Rect => {
    const c = at(board.cell.u, board.cell.v);
    return { left: c.x - 42 * z, top: c.y - 48 * z, right: c.x + 42 * z, bottom: c.y + 33 * z };
  };

  it("is behind a panel", () => {
    // `Qodo` at (37,5) landed at x=1096, entirely behind the console; the
    // original `Scope City` board was half behind the left stack.
    for (const board of HOARDINGS) {
      const face = faceOf(board);
      expect(face.left, `${board.title} is off the left`).toBeGreaterThan(0);
      expect(face.right, `${board.title} is off the right`).toBeLessThan(viewport.width);
      expect(face.top, `${board.title} is off the top`).toBeGreaterThan(0);
      expect(face.bottom, `${board.title} is off the bottom`).toBeLessThan(viewport.height);

      for (const panel of PANELS) {
        expect(overlaps(face, panel), `${board.title} is behind a HUD panel`).toBe(false);
      }
    }
  });

  it("is behind a building", () => {
    // The second way, and the one the operator reported: a hoarding is 48px of
    // face and the tower on the next diagonal is 300, drawn later because it is
    // nearer. So a board can be swallowed whole by a building standing behind
    // it in the world and in front of it on the screen -- which looks exactly
    // like a board nobody added, and is not a rendering fault. Every one of
    // these draws perfectly.
    //
    // Checked against the real layout, because that is what decides it: a
    // district gaining an office shifts the filler, and a placement that was
    // clear yesterday is behind a tower today.
    for (const board of HOARDINGS) {
      const face = faceOf(board);
      const boardDepth = (board.cell.u + board.cell.v) * 1000 + 3;

      const blocker = city.find((b) => {
        // Only what is painted afterwards can cover it.
        if ((b.cell.u + b.cell.v) * 1000 + b.height <= boardDepth) return false;
        const anchor = at(b.cell.u, b.cell.v);
        return overlaps(face, {
          left: anchor.x - 48 * z,
          top: anchor.y - (b.height * 32 + 46) * z,
          right: anchor.x + 48 * z,
          bottom: anchor.y + 30 * z,
        });
      });

      expect(
        blocker,
        `${board.title} is hidden by the building at ${blocker?.cell.u},${blocker?.cell.v}`,
      ).toBeUndefined();
    }
  });
});

describe("telling one board from another", () => {
  it("is the four boards this exists to put up", () => {
    // Every other assertion in this file derives its expectation from whatever
    // `HOARDINGS` currently contains, so deleting a board -- or all four --
    // left them all green with fewer entries to check. The identities are the
    // feature; they have to be named somewhere that does not read them back
    // out of the thing under test.
    expect(HOARDINGS.map((board) => board.title).sort()).toEqual([
      "Qodo",
      "Scope City",
      "TrueFoundry",
      "WeMakeDevs",
    ]);
  });

  it("puts no two of them on the same cell", () => {
    const cells = HOARDINGS.map((board) => `${board.cell.u}:${board.cell.v}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("dims a board whose ground is outside the scope", () => {
    // Like the trees and the fountains. A lit, readable board over fogged
    // terrain is a piece of the map claiming to be reachable when it is not.
    const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");
    const hoardings = scene.slice(
      scene.indexOf("...hoardingItems("),
      scene.indexOf("function facilityItems"),
    );
    expect(hoardings).toContain("...hoardingItems(framed)");
    expect(hoardings).toContain("isInScope(board.cell, state.granted)");
  });

  it("gives each its own colour", () => {
    // Four identical dark rectangles read as street furniture, not as four
    // different names -- and at map zoom the colour is all that survives.
    const accents = new Set(HOARDINGS.map((board) => board.accent));
    expect(accents.size).toBe(HOARDINGS.length);
  });

  it("names each one once", () => {
    const titles = HOARDINGS.map((board) => board.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("draws them from the table that reserves their ground", () => {
    // The point of the table. Two literals in two functions is what let the
    // drawing and the layout disagree in the first place.
    const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");
    expect(scene).toMatch(/HOARDINGS\.map/);
    expect(
      scene.match(/drawBillboard\(/g)?.length,
      "every board must come from HOARDINGS, not from a call site",
    ).toBe(1);
  });
});
