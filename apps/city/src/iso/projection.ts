/**
 * Isometric projection.
 *
 * The whole 2:1 look comes from one pair of equations. A tile is TILE_W wide
 * and TILE_H tall on screen, with TILE_H exactly half TILE_W, which is what
 * makes the diamond read as a square seen from above at an angle.
 *
 * Grid axes, as seen on screen:
 *   +u runs to the lower RIGHT
 *   +v runs to the lower LEFT
 *
 * Keep every drawing routine in grid space and convert once, here. The moment
 * two places do their own projection they drift, and a building ends up half a
 * pixel off its own plot.
 */

export const TILE_W = 64;
export const TILE_H = 32;

/** Vertical pixels per unit of height. A cube looks right at half a tile width. */
export const UNIT_H = 32;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly u: number;
  readonly v: number;
}

/** Grid cell (and optional height) to the screen position of its tile centre. */
export function toScreen(u: number, v: number, height = 0): Point {
  return {
    x: (u - v) * (TILE_W / 2),
    y: (u + v) * (TILE_H / 2) - height * UNIT_H,
  };
}

/**
 * Screen position back to the grid cell under it.
 *
 * The inverse of the above, which is what makes clicking a building possible.
 * Height is deliberately not accounted for: a click selects the ground cell,
 * and callers that care about tall objects hit-test their own bounds.
 */
export function toCell(x: number, y: number): Cell {
  const u = (y / (TILE_H / 2) + x / (TILE_W / 2)) / 2;
  const v = (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2;
  return { u, v };
}

/** Rounded to the cell a point sits in, for picking. */
export function pickCell(x: number, y: number): Cell {
  const { u, v } = toCell(x, y);
  return { u: Math.floor(u), v: Math.floor(v) };
}

/**
 * Painter's-algorithm depth.
 *
 * Anything further along both axes is nearer the viewer and must be drawn
 * later. Height breaks ties so a tall thing on the same cell covers a short
 * one rather than flickering between frames.
 */
export function depth(u: number, v: number, height = 0): number {
  return (u + v) * 1000 + height;
}

/** The four screen corners of a tile's diamond, clockwise from the top. */
export function tileDiamond(u: number, v: number, height = 0): readonly Point[] {
  const c = toScreen(u, v, height);
  return [
    { x: c.x, y: c.y - TILE_H / 2 },
    { x: c.x + TILE_W / 2, y: c.y },
    { x: c.x, y: c.y + TILE_H / 2 },
    { x: c.x - TILE_W / 2, y: c.y },
  ];
}

/**
 * Screen bounds of a rectangular block of cells.
 *
 * Used to frame the camera on a district without guessing: project all four
 * corners, because a rectangle in grid space is a diamond on screen and its
 * extremes are not its corner cells.
 */
export function blockBounds(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  height = 0,
): { min: Point; max: Point } {
  const corners = [
    toScreen(u0, v0, height),
    toScreen(u1, v0, height),
    toScreen(u0, v1, height),
    toScreen(u1, v1, height),
  ];

  return {
    min: {
      x: Math.min(...corners.map((c) => c.x)) - TILE_W / 2,
      y: Math.min(...corners.map((c) => c.y)) - TILE_H / 2,
    },
    max: {
      x: Math.max(...corners.map((c) => c.x)) + TILE_W / 2,
      y: Math.max(...corners.map((c) => c.y)) + TILE_H / 2,
    },
  };
}
