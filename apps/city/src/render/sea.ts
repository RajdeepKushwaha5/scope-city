import { ISLAND_H, ISLAND_W, hash } from "./world.js";

/**
 * The water, and where it stops being water.
 *
 * The sea was one flat blue with a wave mark every thirteenth tile. That is
 * fine as a backdrop and wrong as a coastline: an isometric map reads depth
 * from tile edges, and a plane of identical diamonds has none of them, so the
 * ocean looked like the paper the island was printed on rather than something
 * the island sits in.
 *
 * Three things fix it, and all three are decided here rather than drawn here,
 * so the scene keeps one place that paints and this keeps one place that knows.
 *
 * None of it touches `tileKindAt`. What a cell *is* decides where a building
 * may stand and what the scope covers; what a cell *looks like* is this. Making
 * a sandbank a real sand tile would have put the two in the same answer, and
 * then a shoal three cells out to sea would have been somewhere the layout
 * thought it could build.
 */

/**
 * How far a cell is beyond the island's rectangle, in cells. Zero on land.
 *
 * Analytic rather than a flood fill, because the island is a rectangle and a
 * search would be two thousand cells of work per frame to answer a question
 * that is two subtractions.
 */
export function distanceOffshore(u: number, v: number): number {
  const du = u < 0 ? -u : u > ISLAND_W ? u - ISLAND_W : 0;
  const dv = v < 0 ? -v : v > ISLAND_H ? v - ISLAND_H : 0;
  return Math.max(du, dv);
}

/** How far out the water still reads as shallow. */
const SHALLOW_BAND = 3;

/**
 * Water light enough to read as standing over sand rather than over nothing.
 *
 * A band rather than a gradient: the whole look is flat tiles in a small
 * palette, and a smooth falloff would be the one soft edge on the map.
 */
export function isShallow(u: number, v: number): boolean {
  const out = distanceOffshore(u, v);
  return out > 0 && out <= SHALLOW_BAND;
}

/**
 * Whether a water cell shows a sandbank.
 *
 * This is the detail that makes a shoreline look drawn rather than clipped. A
 * beach does not end on a straight line; it breaks up into banks that surface
 * and disappear, and at this scale each one is a whole tile of sand sitting in
 * the water. Density falls with distance -- almost solid against the beach,
 * occasional two cells out, rare at three -- so the eye reads a slope into the
 * sea rather than a fence around the island.
 *
 * Hashed from the cell, so a bank is in the same place every frame. A shoreline
 * that reshuffles is worse than a straight one.
 */
export function isShoal(u: number, v: number): boolean {
  const out = distanceOffshore(u, v);
  if (out < 1 || out > SHALLOW_BAND) return false;

  // A bank is solid sand, and the fade is in how many of them there are rather
  // than in how much water is speckled over each. Dithering them instead put a
  // second checkerboard on top of the beach's own and the two read as static;
  // this reads as a shore, which is what it is.
  //
  // One in `odds` cells at each distance out. The first ring is dense enough to
  // be the beach continuing, the third sparse enough to be a stray bank rather
  // than a second coastline.
  const odds = out === 1 ? 2 : out === 2 ? 4 : 9;
  return hash(`shoal:${u}:${v}`) % odds === 0;
}

/**
 * Which of the three water shades a cell takes.
 *
 * The same trick the lawn already uses. Three blues close enough to read as one
 * sea and far enough apart to give every tile an edge, which is what makes a
 * flat plane of diamonds look like water instead of paper.
 */
export function waterVariant(u: number, v: number): number {
  return hash(`sea:${u}:${v}`) % 3;
}

/**
 * Whether a cell carries a wave mark.
 *
 * Kept away from the shallows, where the sandbanks and the lighter blue are
 * already doing the work, so the marks read as open water.
 */
export function hasWave(u: number, v: number): boolean {
  if (distanceOffshore(u, v) <= SHALLOW_BAND) return false;
  return hash(`wave:${u}:${v}`) % 11 === 0;
}

/** True when a cell is outside the island's rectangle altogether. */
export function isOffshore(u: number, v: number): boolean {
  return distanceOffshore(u, v) > 0;
}

/** Exported for the tests that assert the bands do not drift. */
export const SEA = { SHALLOW_BAND, ISLAND_W, ISLAND_H } as const;
