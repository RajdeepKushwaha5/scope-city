import { describe, expect, it } from "vitest";
import { TILE_H, TILE_W, toScreen } from "../iso/projection.js";
import { drawDitheredTile } from "./terrain.js";
import { GROUND } from "./palette.js";

/**
 * The lattice.
 *
 * Two diamonds sharing an edge do not meet cleanly on a canvas: each fill is
 * antialiased against what was already there, so the shared edge ends up a
 * blend of tile and background and comes out a shade darker than either. Over a
 * field of them that is a visible grid, and on the open sea -- where every tile
 * is nearly the same colour and there is nothing else to look at -- the grid was
 * the most legible thing on the water. It is most of why the ocean read as a
 * swimming pool rather than a sea.
 *
 * Checked by watching the path the fill actually traces, because the fix is a
 * half pixel and a screenshot cannot tell a half pixel of overlap from none.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Records the polygon `drawDitheredTile` fills for one cell. */
function pathFor(u: number, v: number): Point[] {
  const points: Point[] = [];
  const ctx = {
    beginPath() {
      points.length = 0;
    },
    moveTo(x: number, y: number) {
      points.push({ x, y });
    },
    lineTo(x: number, y: number) {
      points.push({ x, y });
    },
    closePath() {},
    fill() {},
    save() {},
    restore() {},
    clip() {},
    fillRect() {},
    // The bleed is half a *device* pixel, so it is divided by the transform's
    // own scale. An identity matrix keeps the arithmetic below in world units.
    getTransform: () => ({ a: 1, d: 1 }) as DOMMatrix,
    set fillStyle(_value: string) {},
  };

  drawDitheredTile(ctx as unknown as CanvasRenderingContext2D, u, v, GROUND.water!, null, 0, 0);
  return points;
}

/** The path for one cell, as seen through a given canvas scale. */
function pathAtScale(u: number, v: number, scale: number): Point[] {
  const points: Point[] = [];
  const ctx = {
    beginPath() {
      points.length = 0;
    },
    moveTo(x: number, y: number) {
      points.push({ x, y });
    },
    lineTo(x: number, y: number) {
      points.push({ x, y });
    },
    closePath() {},
    fill() {},
    save() {},
    restore() {},
    clip() {},
    fillRect() {},
    getTransform: () => ({ a: scale, d: scale }) as DOMMatrix,
    set fillStyle(_value: string) {},
  };
  drawDitheredTile(ctx as unknown as CanvasRenderingContext2D, u, v, GROUND.water!, null, 0, 0);
  return points;
}

describe("how far a tile bleeds", () => {
  /** The camera's own limits, from the wheel handler in `App.tsx`. */
  const ZOOMS = [0.35, 1, 3];
  const DPRS = [1, 2];

  it("is half a device pixel at every zoom the camera allows", () => {
    // It was a flat 0.5 in world units, and world units are not what the seam
    // is measured in: the canvas scales by the device pixel ratio and again by
    // the camera. That constant came to under a fifth of a device pixel at the
    // widest zoom -- too little to cover the seam it exists for -- and three
    // pixels at the closest, where a shoreline tile overpaints its neighbour by
    // a visible margin.
    const centre = toScreen(10, 10, 0);

    for (const zoom of ZOOMS) {
      for (const dpr of DPRS) {
        const scale = zoom * dpr;
        const path = pathAtScale(10, 10, scale);
        const worldBleed = Math.max(...path.map((p) => Math.abs(p.x - centre.x))) - TILE_W / 2;

        expect(worldBleed * scale, `zoom ${zoom} at dpr ${dpr}`).toBeCloseTo(0.5, 6);
      }
    }
  });
});

describe("a ground tile", () => {
  const centre = toScreen(10, 10, 0);
  const path = pathFor(10, 10);

  it("is a diamond on its own cell", () => {
    expect(path).toHaveLength(4);
    expect(path.every((p) => Math.abs(p.x - centre.x) < 1 || Math.abs(p.y - centre.y) < 1)).toBe(true);
  });

  it("overlaps its neighbours rather than meeting them", () => {
    // Half a pixel: enough at every zoom this map uses, and small enough that
    // it cannot round up to a whole one at any of them.
    const widest = Math.max(...path.map((p) => Math.abs(p.x - centre.x)));
    const tallest = Math.max(...path.map((p) => Math.abs(p.y - centre.y)));

    expect(widest).toBeGreaterThan(TILE_W / 2);
    expect(widest).toBeLessThanOrEqual(TILE_W / 2 + 1);
    expect(tallest).toBeGreaterThan(TILE_H / 2);
    expect(tallest).toBeLessThanOrEqual(TILE_H / 2 + 1);
  });

  it("leaves no gap along a shared edge", () => {
    // The property that matters, and it has to be asserted on the edge rather
    // than on a vertex. My first version compared the east *corner* against the
    // midpoint between the two cell centres, which is thirty-two pixels versus
    // sixteen -- it passed by a mile and would have gone on passing with the
    // overlap removed entirely.
    //
    // The edge two tiles actually share is the one from this tile's east corner
    // to its south corner. Its midpoint has to fall beyond where the two cells
    // truly divide, or both tiles are antialiasing against the same pixel and
    // the canvas blends it with whatever is underneath.
    const east = path.reduce((a, b) => (a.x > b.x ? a : b));
    const south = path.reduce((a, b) => (a.y > b.y ? a : b));
    const shared = { x: (east.x + south.x) / 2, y: (east.y + south.y) / 2 };

    const border = { x: centre.x + TILE_W / 4, y: centre.y + TILE_H / 4 };
    expect(shared.x, "the tile stops short of its own edge").toBeGreaterThan(border.x);
    expect(shared.y, "the tile stops short of its own edge").toBeGreaterThan(border.y);
  });
});
