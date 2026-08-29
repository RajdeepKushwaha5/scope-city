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
  /**
   * The HUD's own gutters, from `hud.css`: a 310px stack on the left, a 340px
   * console on the right, and 14px of padding either side.
   */
  const LEFT = 310 + 14 * 2;
  const RIGHT = 340 + 14 * 2;
  /** Half the drawn face, so the assertion is about the board and not its centre. */
  const HALF_FACE = 42;

  const viewport = { width: 1382, height: 748 };
  const camera = fitCamera(viewport);

  const centreOf = (u: number, v: number) => ({
    x: viewport.width / 2 + camera.x + toScreen(u, v, 3).x * camera.zoom,
    y: viewport.height / 2 + camera.y + toScreen(u, v, 3).y * camera.zoom,
  });

  it("is worse than no hoarding at all", () => {
    // Measured, after two placements that were not. `Qodo` at (37,5) landed at
    // x=1096, entirely behind the console; the original `Scope City` board at
    // (4,25) was half behind the left stack. Neither is a rendering fault --
    // both draw perfectly, off the edge of what the operator is looking at --
    // so nothing but arithmetic like this would have caught them.
    for (const board of HOARDINGS) {
      const at = centreOf(board.cell.u, board.cell.v);
      const half = HALF_FACE * camera.zoom;

      expect(at.x - half, `${board.title} is behind the left panels`).toBeGreaterThan(LEFT);
      expect(at.x + half, `${board.title} is behind the console`).toBeLessThan(
        viewport.width - RIGHT,
      );
      expect(at.y, `${board.title} is off the top`).toBeGreaterThan(0);
      expect(at.y, `${board.title} is off the bottom`).toBeLessThan(viewport.height);
    }
  });
});

describe("telling one board from another", () => {
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
