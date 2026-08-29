import { TILE_H, TILE_W, UNIT_H, toScreen, type Point } from "../iso/projection.js";
import type { Material } from "./palette.js";
import { COAST, UI } from "./palette.js";
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
  muted = false,
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

  ctx.fillStyle = muted ? UI.treeFogShade : UI.treeShade;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 18 * scale, 11 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = muted ? UI.treeFogLight : UI.treeLight;
  ctx.beginPath();
  ctx.ellipse(c.x - 3 * scale, c.y - 22 * scale, 8 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A small civic fountain placed in open park cells. */
export function drawFountain(ctx: CanvasRenderingContext2D, u: number, v: number, muted = false): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  drawDiamond(ctx, u, v, 0.02, muted ? UI.fountainFogStone : UI.fountainStone, 0.68);
  drawDiamond(ctx, u, v, 0.04, muted ? UI.fountainFogWater : UI.fountainWater, 0.48);
  ctx.fillStyle = muted ? UI.fountainFogShade : UI.fountainShade;
  ctx.fillRect(c.x - 2, c.y - 13, 4, 13);
  ctx.fillStyle = muted ? UI.fountainFogJet : UI.fountainWater;
  ctx.fillRect(c.x - 1, c.y - 18, 2, 8);
  ctx.fillRect(c.x - 5, c.y - 14, 3, 2);
  ctx.fillRect(c.x + 2, c.y - 14, 3, 2);
  ctx.restore();
}

/**
 * A compact moving road vehicle. The body is rotated into the projected road
 * axis, while wheels and glass stay deliberately chunky at city-map scale.
 */
export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  axis: "u" | "v",
  colour: string,
  muted = false,
): void {
  const c = toScreen(u, v, -0.07);
  const angle = axis === "u" ? Math.atan2(TILE_H / 2, TILE_W / 2) : Math.atan2(TILE_H / 2, -TILE_W / 2);

  ctx.save();
  ctx.translate(c.x, c.y - 3);
  ctx.rotate(angle);

  ctx.fillStyle = UI.vehicleShadow;
  ctx.fillRect(-11, -2, 22, 7);
  ctx.fillStyle = UI.vehicleWheel;
  ctx.fillRect(-8, -6, 4, 3);
  ctx.fillRect(5, -6, 4, 3);
  ctx.fillStyle = muted ? UI.vehicleFogBody : colour;
  ctx.fillRect(-11, -8, 22, 8);
  ctx.fillStyle = muted ? UI.vehicleFogGlass : UI.vehicleGlass;
  ctx.fillRect(-4, -11, 10, 5);
  ctx.fillStyle = muted ? UI.vehicleFogLight : UI.vehicleHeadlight;
  ctx.fillRect(9, -6, 3, 3);
  ctx.strokeStyle = UI.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(-11.5, -8.5, 23, 9);
  ctx.restore();
}

/** A dome makes the Exchequer read as a civic centre rather than another tower. */
export function drawCivicDome(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  base: number,
  muted = false,
): void {
  const p = toScreen(u, v, base);
  ctx.save();
  ctx.fillStyle = muted ? UI.civicDomeFogBase : UI.civicDomeBase;
  ctx.fillRect(p.x - 10, p.y - 7, 20, 9);
  ctx.fillStyle = muted ? UI.civicDomeFog : UI.civicDome;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 8, 13, 10, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = muted ? UI.civicDomeFogMast : UI.civicDomeMast;
  ctx.fillRect(p.x - 2, p.y - 24, 4, 7);
  ctx.fillRect(p.x - 1, p.y - 29, 2, 5);
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

/* ------------------------------------------------------ coastal facilities */

/** A painted runway segment that follows one projected grid axis. */
export function drawRunway(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  axis: "u" | "v",
  end = false,
): void {
  drawDiamond(ctx, u, v, 0.035, COAST.runway, 0.94);
  const c = toScreen(u, v, 0.04);
  const angle = axis === "u" ? Math.atan2(TILE_H / 2, TILE_W / 2) : Math.atan2(TILE_H / 2, -TILE_W / 2);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(angle);
  ctx.fillStyle = COAST.runwayMark;
  if (end) {
    for (let x = -18; x <= 12; x += 6) ctx.fillRect(x, -5, 3, 10);
  } else {
    ctx.fillRect(-10, -1, 20, 2);
  }
  ctx.restore();
}

/** Terminal or dock warehouse, deliberately broader than a normal office. */
export function drawHangar(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  colour: string = COAST.hangarRoof,
): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.shadow;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 5, 31, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COAST.hangarWall;
  ctx.fillRect(c.x - 28, c.y - 24, 56, 28);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 23, 28, 14, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(c.x - 28, c.y - 23, 56, 25);
  ctx.fillStyle = COAST.hangarDoor;
  ctx.fillRect(c.x - 22, c.y - 17, 44, 19);
  ctx.fillStyle = COAST.safety;
  ctx.fillRect(c.x - 27, c.y - 6, 54, 3);
  ctx.restore();
}

export function drawControlTower(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.tower;
  ctx.fillRect(c.x - 6, c.y - 48, 12, 48);
  ctx.fillStyle = COAST.towerCab;
  ctx.fillRect(c.x - 13, c.y - 55, 26, 11);
  ctx.fillStyle = COAST.towerGlass;
  ctx.fillRect(c.x - 9, c.y - 52, 18, 5);
  ctx.fillStyle = COAST.towerTrim;
  ctx.fillRect(c.x - 10, c.y - 43, 20, 4);
  ctx.restore();
}

/** One full turn of the radar, in milliseconds. */
export const RADAR_PERIOD = 5200;

/**
 * The air-search radar on the naval quay, turning.
 *
 * Every other moving thing on this map travels: cars, boats, the aircraft, the
 * figures. Nothing rotated, and a naval base whose radar is welded in place
 * reads as a diagram of a naval base. It is also the cheapest possible motion
 * -- one number, no path, no routing -- for a facility that otherwise sits
 * completely still between missions.
 *
 * Rotation in an isometric projection with no 3D is done by foreshortening: a
 * dish turning about a vertical axis keeps its height and loses its width as it
 * comes side-on, so the width is scaled by the cosine of the bearing and the
 * dish is drawn edge-on twice a turn. The sign of that cosine says which face
 * is toward the viewer, which is why the dish has a back as well as a front --
 * without the darker reverse it does not read as turning, it reads as
 * squashing and unsquashing in place.
 *
 * `time` is the frame clock, so the sweep is continuous rather than stepped,
 * and two radars on the same map would turn together, which is what a shore
 * establishment's would do.
 */
export function drawRadar(ctx: CanvasRenderingContext2D, u: number, v: number, time: number): void {
  const c = toScreen(u, v, 0);
  const bearing = ((time % RADAR_PERIOD) / RADAR_PERIOD) * Math.PI * 2;
  const facing = Math.cos(bearing);

  ctx.save();

  // Lattice mast: two legs and three cross-braces, which is enough to read as
  // a tower rather than a post at this size.
  ctx.fillStyle = COAST.radarStrut;
  ctx.fillRect(c.x - 7, c.y - 34, 3, 34);
  ctx.fillRect(c.x + 4, c.y - 34, 3, 34);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(c.x - 7, c.y - 10 - i * 11, 14, 2);
  }

  ctx.fillStyle = COAST.radarMast;
  ctx.fillRect(c.x - 9, c.y - 40, 18, 6);

  // The dish. Height is fixed; width is the cosine, so it narrows to a line
  // twice a turn as it passes through side-on.
  const halfWidth = Math.abs(facing) * 15;
  ctx.fillStyle = facing >= 0 ? COAST.radarDish : COAST.radarDishBack;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 50, Math.max(halfWidth, 0.8), 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // A rib across the dish, foreshortened with it, so the face has some
  // structure when it is broadside and nothing when it is edge-on.
  ctx.fillStyle = facing >= 0 ? COAST.radarDishBack : COAST.radarHub;
  ctx.fillRect(c.x - halfWidth, c.y - 51, halfWidth * 2, 2);

  // The hub sits on the axis and does not change with the bearing, which is
  // what stops the dish reading as sliding from side to side.
  ctx.fillStyle = COAST.radarHub;
  ctx.fillRect(c.x - 2, c.y - 52, 4, 14);

  // Obstruction light, on the mast rather than the dish.
  ctx.fillStyle = COAST.radarLamp;
  ctx.fillRect(c.x - 1, c.y - 43, 2, 2);

  ctx.restore();
}

export function drawPlane(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  const angle = Math.atan2(TILE_H / 2, TILE_W / 2);
  ctx.save();
  ctx.translate(c.x, c.y - 5);
  ctx.rotate(angle);
  ctx.fillStyle = UI.shadow;
  ctx.fillRect(-18, 4, 36, 4);
  ctx.fillStyle = COAST.plane;
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.lineTo(-20, -4);
  ctx.lineTo(-25, 0);
  ctx.lineTo(-20, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-5, -15, 8, 30);
  ctx.fillStyle = COAST.planeStripe;
  ctx.fillRect(-24, -4, 8, 8);
  ctx.fillRect(-3, -15, 4, 30);
  ctx.restore();
}

export function drawBillboard(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  title: string,
  subtitle: string,
): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.billboardPost;
  ctx.fillRect(c.x - 27, c.y - 2, 4, 33);
  ctx.fillRect(c.x + 23, c.y - 2, 4, 33);
  ctx.fillStyle = COAST.billboardFace;
  ctx.fillRect(c.x - 42, c.y - 48, 84, 48);
  ctx.strokeStyle = COAST.bollard;
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x - 42, c.y - 48, 84, 48);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 9px monospace";
  ctx.fillStyle = COAST.safety;
  ctx.fillText(title.toUpperCase(), c.x, c.y - 26);
  ctx.font = "7px monospace";
  ctx.fillStyle = COAST.billboardText;
  ctx.fillText(subtitle.toUpperCase(), c.x, c.y - 13);
  ctx.restore();
}

/**
 * Cloud shadows drifting over the open water.
 *
 * Drawn in world space immediately after the camera transform, which puts them
 * behind every tile -- so they are only ever seen on the sea, never washing
 * over the streets. Being inside the transform is also what makes them pan and
 * zoom with the map; in screen space they would have hung in front of the
 * canvas like dirt on a lens the moment anyone dragged the city.
 *
 * Very low alpha and very slow. The point is that the sea stops being a flat
 * colour if you look at it for a while, not that there is weather.
 */
/**
 * Where the clouds sit, in the grid's own coordinates rather than in pixels.
 *
 * The first set was written straight into world pixels, and every one of them
 * missed: three were off the top of the screen, three were behind a HUD panel,
 * and two were over the island and so clipped away. Nothing was visible at any
 * opacity, which took a while to work out because the drawing was correct.
 *
 * Cells are checkable. Each of these is water -- outside the island's rectangle
 * on one axis or the other -- and each lands in a part of the sea the HUD
 * leaves alone.
 */
const CLOUD_CELLS = [
  { u: -6, v: -6, w: 300, h: 78, drift: 5.5 },
  { u: -4, v: -9, w: 210, h: 56, drift: 4.0 },
  { u: 4, v: -8, w: 340, h: 86, drift: 6.5 },
  { u: 16, v: -7, w: 240, h: 62, drift: 3.4 },
  { u: -8, v: 8, w: 260, h: 66, drift: 5.0 },
  { u: 44, v: 30, w: 320, h: 80, drift: 4.4 },
  { u: 46, v: 22, w: 200, h: 54, drift: 6.0 },
  { u: 42, v: 44, w: 280, h: 72, drift: 3.8 },
] as const;

const CLOUDS = CLOUD_CELLS.map((cloud) => {
  const at = toScreen(cloud.u, cloud.v, 0);
  return { x: at.x, y: at.y, w: cloud.w, h: cloud.h, drift: cloud.drift };
});

/**
 * How far a cloud wanders from where it was placed before wrapping back.
 *
 * Short, and that is the point: the anchors are chosen to be in open water the
 * HUD does not cover, and a cloud free to drift the width of the ocean would
 * spend most of its time somewhere nobody can see it. At these speeds a lap
 * takes two to four minutes.
 */
const CLOUD_SPAN = 900;

/**
 * The puffs one cloud is made of: offset, scale and relative opacity.
 *
 * Hand-placed rather than hashed, because there are six of them and a cloud is
 * a shape, not a scatter. Wide and faint at the edges, tighter and stronger
 * through the middle, and deliberately not symmetric -- a symmetric cloud reads
 * as a logo.
 */
const PUFFS: readonly (readonly [number, number, number, number, number])[] = [
  [-0.06, 0.0, 1.0, 1.0, 1],
  [0.22, 0.1, 0.72, 0.8, 1.2],
  [-0.28, 0.08, 0.6, 0.66, 1.1],
  [0.05, -0.14, 0.52, 0.62, 1.3],
  [0.34, -0.02, 0.4, 0.5, 1],
  [-0.1, 0.16, 0.66, 0.54, 1.4],
];

export function drawClouds(
  ctx: CanvasRenderingContext2D,
  time: number,
  island: readonly Point[],
): void {
  ctx.save();

  // Clipped to everything *outside* the island, so a cloud passing the coast is
  // cut off at the beach instead of drifting over the streets.
  //
  // The first attempt drew them under the ground layer instead, which is the
  // obvious way to keep them off the land and does not work: the water tiles
  // are opaque, so the only clouds anyone could see were the ones past the edge
  // of the drawn ocean, in the corners of the screen. They were being painted
  // and then covered by the sea.
  ctx.beginPath();
  ctx.rect(-100000, -100000, 200000, 200000);
  ctx.moveTo(island[0]!.x, island[0]!.y);
  for (const point of island.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.clip("evenodd");

  ctx.fillStyle = "#ffffff";

  for (const cloud of CLOUDS) {
    // Wrapped rather than bounced, so no cloud ever reverses -- which would be
    // the one thing on this map that reads as a mistake rather than as weather.
    const shifted =
      cloud.x + (((time / 1000) * cloud.drift) % CLOUD_SPAN) - CLOUD_SPAN / 2;

    // Built up from several soft ellipses rather than drawn as two hard ones.
    //
    // Two solid ovals at a single alpha is not a cloud; it is a stain, and it
    // was the only shape on this map with a crisp edge and no reason for one.
    // Everything else here is a flat tile or a flat face, so a hard-edged blob
    // sitting on the water read as a smudge on the canvas.
    //
    // Six puffs at decreasing opacity, largest and faintest first, so the
    // overlaps accumulate toward the middle and the outline dissolves. The
    // shape comes from the arrangement rather than from any one ellipse, which
    // is why none of them has to be soft on its own.
    for (const [dx, dy, sx, sy, alpha] of PUFFS) {
      ctx.globalAlpha = 0.05 * alpha;
      ctx.beginPath();
      ctx.ellipse(
        shifted + cloud.w * dx,
        cloud.y + cloud.h * dy,
        (cloud.w / 2) * sx,
        (cloud.h / 2) * sy,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawPier(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  drawDiamond(ctx, u, v, 0.06, COAST.pier, 0.96);
  const c = toScreen(u, v, 0);
  ctx.fillStyle = COAST.bollard;
  ctx.fillRect(c.x - 20, c.y - 2, 5, 6);
  ctx.fillRect(c.x + 15, c.y - 2, 5, 6);
}

export function drawContainerStack(ctx: CanvasRenderingContext2D, u: number, v: number, seed: number): void {
  const c = toScreen(u, v, 0);
  const colours = COAST.containers;
  ctx.save();
  for (let level = 0; level < 2; level += 1) {
    ctx.fillStyle = colours[(seed + level) % colours.length] ?? colours[0];
    ctx.fillRect(c.x - 17 + level * 3, c.y - 10 - level * 8, 34, 8);
    ctx.strokeStyle = COAST.containerEdge;
    ctx.strokeRect(c.x - 17 + level * 3, c.y - 10 - level * 8, 34, 8);
  }
  ctx.restore();
}

export function drawCrane(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.strokeStyle = COAST.crane;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x - 13, c.y);
  ctx.lineTo(c.x - 13, c.y - 45);
  ctx.lineTo(c.x + 25, c.y - 45);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x + 12, c.y - 45);
  ctx.lineTo(c.x + 12, c.y - 18);
  ctx.stroke();
  ctx.restore();
}

export function drawLighthouse(ctx: CanvasRenderingContext2D, u: number, v: number, time: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.lighthouse;
  ctx.fillRect(c.x - 7, c.y - 46, 14, 46);
  ctx.fillStyle = COAST.lighthouseStripe;
  ctx.fillRect(c.x - 7, c.y - 13, 14, 8);
  ctx.fillRect(c.x - 7, c.y - 31, 14, 8);
  ctx.fillStyle = COAST.lighthouseRoof;
  ctx.fillRect(c.x - 10, c.y - 51, 20, 6);
  ctx.fillStyle = COAST.lighthouseLamp;
  ctx.fillRect(c.x - 6, c.y - 58, 12, 8);
  ctx.globalAlpha = 0.12 + (Math.sin(time / 650) + 1) * 0.06;
  ctx.fillStyle = COAST.lighthouseBeam;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - 54);
  ctx.lineTo(c.x + 110, c.y - 72);
  ctx.lineTo(c.x + 110, c.y - 44);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A boat under sail.
 *
 * The old one was a dark wedge with two wake strokes, and the whole thing --
 * hull, mast and sail -- was rotated onto the water's axis. That is right for
 * the hull and wrong for everything above it: a mast is vertical whichever way
 * the boat is pointing, so rotating it laid the sail over at thirty degrees and
 * the boat read as capsizing. It is also the reason the craft never looked like
 * a boat at map scale -- the silhouette that identifies one is an upright
 * triangle over a low hull, and there was no upright anything.
 *
 * So the hull turns and the rig does not. The hull is drawn in the rotated
 * frame, in three wooden tones, because a boat is a solid like everything else
 * on this map and was the one object painted a single flat colour. The mast,
 * the sail and the pennant are drawn afterwards in screen space, standing up.
 *
 * `colour` is the cabin, which is what tells one boat from another at a
 * distance -- the hulls are all the same wood.
 */
export function drawBoat(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  axis: "u" | "v",
  colour: string,
  sail = false,
): void {
  const c = toScreen(u, v, 0);
  const angle = axis === "u" ? Math.atan2(TILE_H / 2, TILE_W / 2) : Math.atan2(TILE_H / 2, -TILE_W / 2);

  ctx.save();
  ctx.translate(c.x, c.y - 3);

  ctx.save();
  ctx.rotate(angle);

  // Two thin streaks, not a wedge. The first attempt filled the whole quarter
  // astern with translucent white, which at this size is a glow around the boat
  // rather than a wake behind it -- and these move slowly enough now that the
  // wake is not what says they are moving.
  ctx.strokeStyle = COAST.wake;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-16, 1);
  ctx.lineTo(-30, -2);
  ctx.moveTo(-16, 4);
  ctx.lineTo(-28, 7);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Hull: a raked bow to starboard, a squared transom aft, and a keel strake
  // below the waterline. Three tones in the same relationship as every other
  // solid here -- the deck is the lit top, the side is the half-shadow.
  ctx.fillStyle = COAST.boatKeel;
  ctx.beginPath();
  ctx.moveTo(-15, 2);
  ctx.lineTo(21, -1);
  ctx.lineTo(15, 9);
  ctx.lineTo(-14, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COAST.boatHull;
  ctx.beginPath();
  ctx.moveTo(-15, -1);
  ctx.lineTo(23, -3);
  ctx.lineTo(19, 4);
  ctx.lineTo(-15, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COAST.boatDeck;
  ctx.beginPath();
  ctx.moveTo(-14, -3);
  ctx.lineTo(22, -4);
  ctx.lineTo(17, 0);
  ctx.lineTo(-14, 1);
  ctx.closePath();
  ctx.fill();

  // The route's colour goes on the sheer strake of a sailing boat and on a
  // cabin of one without. A cabin under a sail is hidden by it, which is where
  // this started -- the only colour that told one boat from another was behind
  // the largest thing on the boat.
  ctx.fillStyle = colour;
  if (sail) {
    ctx.beginPath();
    ctx.moveTo(-15, -1);
    ctx.lineTo(23, -3);
    ctx.lineTo(22, -1);
    ctx.lineTo(-15, 1);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(-9, -10, 14, 8);
  }
  ctx.restore();

  if (sail) {
    // Upright, in screen space. The mast steps a little forward of amidships
    // and the sail hangs aft of it, which is the shape that reads as a sail
    // from far enough away that nothing else about the boat is legible.
    ctx.fillStyle = COAST.mast;
    ctx.fillRect(1, -34, 2, 32);

    ctx.fillStyle = COAST.sail;
    ctx.beginPath();
    ctx.moveTo(1, -33);
    ctx.lineTo(-17, -6);
    ctx.lineTo(1, -4);
    ctx.closePath();
    ctx.fill();

    // A shaded panel along the foot, so the sail is a surface and not a
    // cut-out. One tone, not a gradient -- everything here is flat.
    ctx.fillStyle = COAST.sailShade;
    ctx.beginPath();
    ctx.moveTo(1, -13);
    ctx.lineTo(-17, -6);
    ctx.lineTo(1, -4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COAST.pennant;
    ctx.beginPath();
    ctx.moveTo(3, -34);
    ctx.lineTo(11, -31);
    ctx.lineTo(3, -28);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

export function drawShip(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  axis: "u" | "v",
  kind: "cargo" | "navy",
): void {
  const c = toScreen(u, v, 0);
  const angle = axis === "u" ? Math.atan2(TILE_H / 2, TILE_W / 2) : Math.atan2(TILE_H / 2, -TILE_W / 2);
  ctx.save();
  ctx.translate(c.x, c.y - 8);
  ctx.rotate(angle);
  ctx.fillStyle = COAST.shipWake;
  ctx.fillRect(-73, 10, 54, 3);
  ctx.fillStyle = kind === "cargo" ? COAST.cargoHull : COAST.navyHull;
  ctx.beginPath();
  ctx.moveTo(-62, -13);
  ctx.lineTo(68, -13);
  ctx.lineTo(79, 0);
  ctx.lineTo(62, 13);
  ctx.lineTo(-62, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = kind === "cargo" ? COAST.cargoCab : COAST.navyCab;
  ctx.fillRect(-50, -19, 25, 14);
  if (kind === "cargo") {
    const colours = COAST.cargoContainers;
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = colours[i % colours.length] ?? colours[0];
      ctx.fillRect(-16 + i * 15, -10, 13, 17);
    }
  } else {
    ctx.fillStyle = COAST.navyDeck;
    ctx.fillRect(-4, -25, 35, 17);
    ctx.fillRect(12, -34, 5, 12);
    ctx.fillStyle = COAST.navyMark;
    ctx.fillRect(45, -17, 18, 4);
  }
  ctx.restore();
}

/**
 * A marker on a building's roof saying what state it is in.
 *
 * Drawn live rather than baked into the sprite, because these pulse and the
 * sprite cache is keyed by appearance -- baking a phase would mean a cache
 * entry per frame.
 *
 * Shape carries the meaning as well as colour. A viewer who cannot distinguish
 * amber from green, or a screenshot printed in grey, still separates a ring
 * from a bar from a cross. Colour alone would make the whole city unreadable to
 * some people and unciteable in a written report, and this is the layer that
 * tells an operator what needs them.
 */
export type BuildingMarker =
  | "gated"
  | "waiting"
  | "working"
  | "done"
  | "refused"
  | "proposed"
  | "none";

const MARKER_COLOUR: Record<Exclude<BuildingMarker, "none">, string> = {
  gated: "#f0a020",
  waiting: "#f0a020",
  working: "#3fb0d0",
  done: "#3fb950",
  refused: "#ff4d4f",
  proposed: "#f0a020",
};

export function drawBuildingMarker(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  height: number,
  marker: BuildingMarker,
  /** 0..1, for the states that pulse. */
  phase: number,
): void {
  if (marker === "none") return;

  const top = toScreen(u, v, height + 0.18);
  const colour = MARKER_COLOUR[marker];

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.5;

  switch (marker) {
    case "waiting": {
      // A ring that breathes: the only state that is asking a human for
      // something, so it is the one allowed to move.
      const r = 4 + Math.sin(phase * Math.PI * 2) * 1.6;
      ctx.globalAlpha = 0.55 + Math.sin(phase * Math.PI * 2) * 0.35;
      ctx.beginPath();
      ctx.arc(top.x, top.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "gated": {
      // A static ring. Same shape as waiting, still: this office *would* stop
      // for a countersign, but nothing is pending.
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(top.x, top.y, 3.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "working": {
      const r = 2.6 + Math.sin(phase * Math.PI * 2) * 0.9;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(top.x, top.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "done": {
      // A short bar. Deliberately quiet -- finished work should not compete for
      // attention with work that needs a decision.
      ctx.globalAlpha = 0.8;
      ctx.fillRect(top.x - 3, top.y - 1, 6, 2);
      break;
    }
    case "refused": {
      // A cross, and the only marker that reads as a stop rather than a status.
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(top.x - 3.5, top.y - 3.5);
      ctx.lineTo(top.x + 3.5, top.y + 3.5);
      ctx.moveTo(top.x + 3.5, top.y - 3.5);
      ctx.lineTo(top.x - 3.5, top.y + 3.5);
      ctx.stroke();
      break;
    }
    case "proposed": {
      // Hollow and dashed: authority that has been asked for and not yet given.
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(top.x, top.y, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/** A gold outline around the footprint of the selected building. */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#f5c451";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.9;

  // The roof outline rather than the ground footprint: the ground is hidden
  // behind the building itself from this angle, so an outline there would be
  // drawn and then painted over.
  const c = toScreen(u, v, height);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - TILE_H / 2);
  ctx.lineTo(c.x + TILE_W / 2, c.y);
  ctx.lineTo(c.x, c.y + TILE_H / 2);
  ctx.lineTo(c.x - TILE_W / 2, c.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
