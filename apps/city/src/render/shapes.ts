import { TILE_H, TILE_W, UNIT_H, toScreen, type Point } from "../iso/projection.js";
import type { Material } from "./palette.js";
import { UI } from "./palette.js";
import type { PerimeterEdge } from "./world.js";

/**
 * Drawing primitives.
 *
 * A building is not a box. It is a plinth, a banded shaft, a parapet lip and
 * something small on the roof -- that stack is most of the difference between
 * a diagram and a city, and it costs about six draw calls instead of three.
 *
 * Two rules everything here follows:
 *
 *   Outline the silhouette, never the seams. A dark line on every face turns a
 *   solid into a wireframe; a line only where the shape meets the world behind
 *   it is what makes it read as mass.
 *
 *   Light is fixed at the upper left and never moves. Top faces are lit, the
 *   screen-left wall is half shadow, the screen-right wall is darkest.
 */

/* ------------------------------------------------------------------ walls */

/**
 * The two visible walls of a unit-square prism, as parallelograms.
 *
 * Returned rather than drawn so callers can put windows on them without
 * recomputing the geometry and drifting half a pixel.
 */
interface WallFrame {
  /** Corner nearest the viewer's left, at the top of the wall. */
  readonly origin: Point;
  /** Along the wall's width, top edge. */
  readonly across: Point;
  /** Down the wall's height. */
  readonly down: Point;
}

function leftWall(u: number, v: number, top: number, rise: number): WallFrame {
  const t = toScreen(u, v, top);
  return {
    origin: { x: t.x - TILE_W / 2, y: t.y },
    across: { x: TILE_W / 2, y: TILE_H / 2 },
    down: { x: 0, y: rise },
  };
}

function rightWall(u: number, v: number, top: number, rise: number): WallFrame {
  const t = toScreen(u, v, top);
  return {
    origin: { x: t.x, y: t.y + TILE_H / 2 },
    across: { x: TILE_W / 2, y: -TILE_H / 2 },
    down: { x: 0, y: rise },
  };
}

/** A point on a wall, in (across, down) fractions of its extent. */
function onWall(w: WallFrame, s: number, t: number): Point {
  return {
    x: w.origin.x + w.across.x * s + w.down.x * t,
    y: w.origin.y + w.across.y * s + w.down.y * t,
  };
}

function fillWall(
  ctx: CanvasRenderingContext2D,
  w: WallFrame,
  colour: string,
  s0 = 0,
  s1 = 1,
  t0 = 0,
  t1 = 1,
): void {
  const a = onWall(w, s0, t0);
  const b = onWall(w, s1, t0);
  const c = onWall(w, s1, t1);
  const d = onWall(w, s0, t1);

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/* ----------------------------------------------------------------- ground */

/**
 * A ground tile.
 *
 * `variant` shifts the shade slightly so a field of grass has texture without
 * anyone authoring a texture. Flat green over a whole island is the single
 * biggest giveaway that a map was drawn by a program in a hurry.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  material: Material,
  variant = 0,
): void {
  const c = toScreen(u, v, 0);

  ctx.beginPath();
  ctx.moveTo(c.x, c.y - TILE_H / 2);
  ctx.lineTo(c.x + TILE_W / 2, c.y);
  ctx.lineTo(c.x, c.y + TILE_H / 2);
  ctx.lineTo(c.x - TILE_W / 2, c.y);
  ctx.closePath();

  ctx.fillStyle = variant === 0 ? material.top : variant === 1 ? material.left : material.right;
  ctx.fill();
}

/**
 * A road tile with painted markings.
 *
 * `connections` is a 4-bit mask of which neighbours are also road, in the order
 * north-east, south-east, south-west, north-west. Markings are drawn only along
 * axes that continue, so a junction does not end up with a centre line running
 * into a kerb.
 */
export function drawRoad(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  material: Material,
  connections: number,
): void {
  const c = toScreen(u, v, 0);

  ctx.beginPath();
  ctx.moveTo(c.x, c.y - TILE_H / 2);
  ctx.lineTo(c.x + TILE_W / 2, c.y);
  ctx.lineTo(c.x, c.y + TILE_H / 2);
  ctx.lineTo(c.x - TILE_W / 2, c.y);
  ctx.closePath();
  ctx.fillStyle = material.top;
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = UI.roadMarking;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);

  // The two road axes, drawn corner to corner through the tile centre.
  const neAxis = (connections & 0b0001) !== 0 || (connections & 0b0100) !== 0;
  const seAxis = (connections & 0b0010) !== 0 || (connections & 0b1000) !== 0;

  if (neAxis) {
    ctx.beginPath();
    ctx.moveTo(c.x - TILE_W / 2, c.y);
    ctx.lineTo(c.x + TILE_W / 2, c.y);
    ctx.stroke();
  }
  if (seAxis) {
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - TILE_H / 2);
    ctx.lineTo(c.x, c.y + TILE_H / 2);
    ctx.stroke();
  }

  ctx.restore();
}

/* --------------------------------------------------------------- building */

export interface BuildingStyle {
  readonly body: Material;
  /** Roof slab, usually a cooler and darker material than the walls. */
  readonly roof: Material;
  /** Lit window colour. */
  readonly glass: string;
  /** Unlit window colour. */
  readonly glassDark: string;
}

/**
 * A building, drawn as a stack.
 *
 *   plinth   a half-unit base, slightly wider read than the shaft
 *   shaft    the body, banded into floors with a window grid per floor
 *   parapet  a lip around the roof so the top edge has thickness
 *   roof     the surface inside the parapet, plus one small rooftop unit
 *
 * Six pieces rather than one box. It is the parapet and the rooftop unit that
 * do most of the work -- a flat-topped extrusion reads as a bar chart.
 */
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  height: number,
  style: BuildingStyle,
  seed: number,
  lit = true,
): void {
  const floors = Math.max(1, Math.round(height * 1.6));
  const rise = height * UNIT_H;

  const left = leftWall(u, v, height, rise);
  const right = rightWall(u, v, height, rise);

  // Walls.
  fillWall(ctx, left, style.body.left);
  fillWall(ctx, right, style.body.right);

  // Floor bands and windows. Windows are inset from the wall edges so the
  // corner of the building stays solid -- glass running to the corner makes a
  // tower look like a greenhouse.
  const bandH = 1 / floors;
  for (let f = 0; f < floors; f += 1) {
    const t0 = f * bandH + bandH * 0.22;
    const t1 = f * bandH + bandH * 0.72;

    for (let col = 0; col < 2; col += 1) {
      const s0 = 0.16 + col * 0.42;
      const s1 = s0 + 0.26;

      const onLeft = ((seed + f * 7 + col * 13) % 7) !== 0;
      const onRight = ((seed + f * 11 + col * 5) % 7) !== 0;

      fillWall(ctx, left, lit && onLeft ? style.glass : style.glassDark, s0, s1, t0, t1);
      fillWall(ctx, right, lit && onRight ? style.glass : style.glassDark, s0, s1, t0, t1);
    }
  }

  // Parapet: a shallow band at the very top of each wall, in the roof material,
  // giving the roof edge visible thickness.
  fillWall(ctx, left, style.roof.left, 0, 1, 0, 0.045);
  fillWall(ctx, right, style.roof.right, 0, 1, 0, 0.045);

  // Roof surface.
  drawDiamond(ctx, u, v, height, style.roof.top);

  // One rooftop unit, off-centre, so the skyline is not a row of flat lids.
  const unitH = 0.16 + (seed % 3) * 0.06;
  const offset = ((seed % 5) - 2) * 0.12;
  drawRooftopUnit(ctx, u + offset, v - offset, height, unitH, style.roof);

  // Silhouette only.
  outlineExtrusion(ctx, u, v, height, style.body.edge);
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  height: number,
  colour: string,
  scale = 1,
): void {
  const c = toScreen(u, v, height);
  const w = (TILE_W / 2) * scale;
  const h = (TILE_H / 2) * scale;

  ctx.beginPath();
  ctx.moveTo(c.x, c.y - h);
  ctx.lineTo(c.x + w, c.y);
  ctx.lineTo(c.x, c.y + h);
  ctx.lineTo(c.x - w, c.y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** A small box on a roof — stairwell, plant, water tank. */
function drawRooftopUnit(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  base: number,
  height: number,
  material: Material,
): void {
  const rise = height * UNIT_H;
  const scale = 0.42;

  const t = toScreen(u, v, base + height);
  const w = (TILE_W / 2) * scale;
  const h = (TILE_H / 2) * scale;

  ctx.beginPath();
  ctx.moveTo(t.x - w, t.y);
  ctx.lineTo(t.x, t.y + h);
  ctx.lineTo(t.x, t.y + h + rise);
  ctx.lineTo(t.x - w, t.y + rise);
  ctx.closePath();
  ctx.fillStyle = material.left;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(t.x, t.y + h);
  ctx.lineTo(t.x + w, t.y);
  ctx.lineTo(t.x + w, t.y + rise);
  ctx.lineTo(t.x, t.y + h + rise);
  ctx.closePath();
  ctx.fillStyle = material.right;
  ctx.fill();

  drawDiamond(ctx, u, v, base + height, material.top, scale);
}

/**
 * Outlines the silhouette of an extrusion: the ground diamond's near edges, the
 * two vertical corners, and the roof diamond. Deliberately not the seam where
 * the two walls meet, which is interior to the shape.
 */
function outlineExtrusion(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  height: number,
  colour: string,
): void {
  const top = toScreen(u, v, height);
  const rise = height * UNIT_H;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";

  ctx.beginPath();
  // Roof diamond.
  ctx.moveTo(top.x, top.y - TILE_H / 2);
  ctx.lineTo(top.x + TILE_W / 2, top.y);
  ctx.lineTo(top.x, top.y + TILE_H / 2);
  ctx.lineTo(top.x - TILE_W / 2, top.y);
  ctx.closePath();
  // The three vertical corners that appear on the silhouette.
  ctx.moveTo(top.x - TILE_W / 2, top.y);
  ctx.lineTo(top.x - TILE_W / 2, top.y + rise);
  ctx.lineTo(top.x, top.y + TILE_H / 2 + rise);
  ctx.lineTo(top.x + TILE_W / 2, top.y + rise);
  ctx.lineTo(top.x + TILE_W / 2, top.y);
  ctx.moveTo(top.x, top.y + TILE_H / 2);
  ctx.lineTo(top.x, top.y + TILE_H / 2 + rise);
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------------------------------------- vegetation */

/**
 * A tree: trunk plus two offset canopy blobs.
 *
 * Two blobs rather than one circle. A single disc reads as a lollipop; the
 * second, smaller and lighter and set up-left, gives it a lit side and a
 * silhouette that isn't a perfect circle.
 */
export function drawTree(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  seed: number,
): void {
  const c = toScreen(u, v, 0);
  const scale = 0.85 + (seed % 4) * 0.12;

  ctx.save();

  ctx.fillStyle = UI.treeShadow;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 1, 9 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = UI.treeTrunk;
  ctx.fillRect(c.x - 2, c.y - 12 * scale, 4, 12 * scale);

  ctx.fillStyle = UI.treeShade;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 18 * scale, 11 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = UI.treeLight;
  ctx.beginPath();
  ctx.ellipse(c.x - 3 * scale, c.y - 22 * scale, 8 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A streetlight, for road edges. Small, but it breaks up long kerb runs. */
export function drawLamp(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = UI.lamp;
  ctx.fillRect(c.x - 1, c.y - 26, 2, 26);
  ctx.fillStyle = UI.lampLight;
  ctx.fillRect(c.x - 3, c.y - 30, 6, 4);
  ctx.restore();
}

/* --------------------------------------------------------------- overlays */

/**
 * The scope perimeter: a wall of light standing on the ground.
 *
 * The most important line in the interface, so it gets a glow and a solid core
 * rather than a dashed outline that could be mistaken for a selection.
 */
export function drawPerimeter(
  ctx: CanvasRenderingContext2D,
  edges: readonly PerimeterEdge[],
  colour: string,
  glow: string,
  dashed = false,
): void {
  if (edges.length === 0) return;

  const path = new Path2D();
  for (const edge of edges) {
    const from = toScreen(edge.from.u, edge.from.v, 0);
    const to = toScreen(edge.to.u, edge.to.v, 0);
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }

  ctx.save();

  // A short vertical curtain hanging off the line, so the boundary reads as a
  // wall standing on the ground rather than paint applied to it.
  ctx.strokeStyle = glow;
  ctx.lineWidth = 18;
  ctx.setLineDash([]);
  ctx.stroke(path);

  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.stroke(path);

  ctx.restore();
}

export function drawShadow(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  radius = 0.35,
): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = UI.shadow;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, (TILE_W / 2) * radius, (TILE_H / 2) * radius, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
