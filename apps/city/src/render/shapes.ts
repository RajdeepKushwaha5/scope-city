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
  ctx.ellipse(c.x, c.y + 5, 34, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Corrugated hangar walls
  ctx.fillStyle = colour === COAST.hangarRoofAirport ? "#68889b" : "#324333";
  ctx.fillRect(c.x - 30, c.y - 26, 60, 28);

  // Arched curved roof
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 25, 30, 16, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(c.x - 30, c.y - 25, 60, 26);

  // Corrugation rib lines
  ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
  ctx.lineWidth = 1;
  for (let i = -24; i <= 24; i += 8) {
    ctx.beginPath();
    ctx.moveTo(c.x + i, c.y - 25);
    ctx.lineTo(c.x + i, c.y);
    ctx.stroke();
  }

  // Hangar entrance opening
  ctx.fillStyle = "#1b2830";
  ctx.fillRect(c.x - 22, c.y - 18, 44, 20);

  // Yellow hazard stripe over threshold
  ctx.fillStyle = COAST.safety;
  ctx.fillRect(c.x - 28, c.y - 5, 56, 3);

  // Military identifier N47 if naval hangar
  if (colour !== COAST.hangarRoofAirport) {
    ctx.fillStyle = "#f6bd60";
    ctx.font = "bold 7px monospace";
    ctx.fillText("N47", c.x - 7, c.y - 26);
  }

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
  const c = toScreen(u, v, 0.05);
  ctx.save();
  ctx.translate(c.x, c.y);

  const forwardX = 0.89;
  const forwardY = 0.46;
  const sideX = -0.46;
  const sideY = 0.89;

  const pt = (f: number, s: number, lift = 0): Point => ({
    x: f * forwardX + s * sideX,
    y: f * forwardY + s * sideY - lift,
  });

  const poly = (color: string, points: [number, number][], alpha = 1, lift = 0) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    const p0 = pt(first[0], first[1], lift);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = pt(points[i]![0], points[i]![1], lift);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // 1. Ground Contact Shadow
  poly(
    "rgba(7, 17, 22, 0.3)",
    [[38, 0], [27, -8], [-27, -10], [-38, -4], [-38, 4], [-27, 10], [27, 8]],
  );

  // 2. High Wing and Tailplane (z lift = 12)
  poly("#c3d6da", [[10, -6], [-5, -10], [-18, -42], [-26, -43], [-16, -7], [-16, 7], [-26, 43], [-18, 42], [-5, 10], [10, 6]], 1, 12);
  poly("#8faeb7", [[-4, -10], [-18, -42], [-26, -43], [-19, -28], [0, -7], [0, 7], [-19, 28], [-26, 43], [-18, 42], [-4, 10]], 1, 12);
  poly("#b8cdd2", [[-28, -5], [-38, -22], [-44, -21], [-40, -4], [-40, 4], [-44, 21], [-38, 22], [-28, 5]], 1, 14);

  // 3. Fuselage Main Body (z lift = 10)
  poly("#f5f7f2", [[46, 0], [39, -6], [15, -7], [-34, -7], [-43, -3], [-43, 3], [-34, 7], [15, 7], [39, 6]], 1, 10);
  poly("#d4e3e3", [[39, -6], [15, -7], [-34, -7], [-43, -3], [-34, 0], [15, 0]], 1, 10);

  // 4. Navy Belly, Gold Cheatline and Tail Livery
  poly("#163b52", [[29, -7], [8, -8], [-31, -7], [-38, -4], [-31, -2], [8, -3], [29, -2]], 1, 10);
  poly("#f6bd60", [[18, -8], [8, -8], [-28, -7], [-33, -5], [-28, -4], [8, -5], [18, -5]], 1, 10);
  poly("#173e56", [[-29, -5], [-40, -4], [-44, 0], [-40, 4], [-29, 5], [-23, 0]], 1, 14);

  // 5. Cockpit & Passenger Windows
  const cp = pt(38, 0, 11);
  ctx.fillStyle = "#68c9df";
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
  ctx.fill();

  for (let f = 20; f >= -17; f -= 10) {
    const win = pt(f, -6.8, 11);
    ctx.fillStyle = "#b7f1f7";
    ctx.beginPath();
    ctx.arc(win.x, win.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Engine Nacelles & Spinning Propeller Discs
  for (const s of [-23, 23]) {
    const eng = pt(-2, s, 12);
    ctx.fillStyle = "#10232e";
    ctx.beginPath();
    ctx.arc(eng.x, eng.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const pr = pt(5, s, 12);
    ctx.fillStyle = "rgba(183, 241, 247, 0.4)";
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(245, 247, 242, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pr.x - 7, pr.y);
    ctx.lineTo(pr.x + 7, pr.y);
    ctx.moveTo(pr.x, pr.y - 7);
    ctx.lineTo(pr.x, pr.y + 7);
    ctx.stroke();
  }

  // 7. Wingtip Navigation Lights: Red (Port / Left) & Green (Starboard / Right)
  const port = pt(-19, -43, 14);
  const stbd = pt(-19, 43, 14);
  ctx.fillStyle = "#f05d68";
  ctx.beginPath();
  ctx.arc(port.x, port.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6ee7b7";
  ctx.beginPath();
  ctx.arc(stbd.x, stbd.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * A roadside hoarding.
 *
 * `accent` colours the title and a hairline under it. It is how one board is
 * told from another at a glance -- four identical dark rectangles read as
 * street furniture rather than as four different names -- and it is doing the
 * work a logo would, because a logo cannot do it at this size: the face is
 * eighty-four pixels wide, so a scaled mark is a smudge and the wordmark is the
 * only part anyone can read.
 *
 * The title is fitted rather than assumed. `TRUEFOUNDRY` at the size the two
 * original boards used overran the face by both margins, and text that runs off
 * a billboard looks like a bug in the renderer rather than a long name.
 */
export function drawBillboard(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  title: string,
  subtitle: string,
  accent: string = COAST.safety,
): void {
  const c = toScreen(u, v, 0);
  const width = 84;
  ctx.save();
  ctx.fillStyle = COAST.billboardPost;
  ctx.fillRect(c.x - 27, c.y - 2, 4, 33);
  ctx.fillRect(c.x + 23, c.y - 2, 4, 33);
  ctx.fillStyle = COAST.billboardFace;
  ctx.fillRect(c.x - 42, c.y - 48, width, 48);
  ctx.strokeStyle = COAST.bollard;
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x - 42, c.y - 48, width, 48);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const upper = title.toUpperCase();
  ctx.font = "700 " + fittedSize(ctx, upper, width - 10, 9, 6) + "px monospace";
  ctx.fillStyle = accent;
  ctx.fillText(upper, c.x, c.y - 30);

  // A hairline in the same colour, so the board is identifiable even where the
  // title is too small to read -- which is most of the time, at map zoom.
  ctx.fillRect(c.x - 26, c.y - 22, 52, 1);

  const sub = subtitle.toUpperCase();
  ctx.font = fittedSize(ctx, sub, width - 8, 7, 5) + "px monospace";
  ctx.fillStyle = COAST.billboardText;
  ctx.fillText(sub, c.x, c.y - 14);
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

/** Which of a tile's four faces a marking is painted along. */
export type TileFace = "-u" | "+u" | "-v" | "+v";

/**
 * The painted line along the outer edge of an apron.
 *
 * Only the faces that actually front onto something else, which is the whole
 * point. The first version drew a diamond inset inside every edge tile, and a
 * run of those is not a boundary line -- it is a chain of yellow lozenges, and
 * on a five-cell quay it read as decoration rather than as the edge of
 * anything. Painting one face means consecutive tiles join into a single
 * continuous run.
 *
 * The faces map onto the projection: +u runs to the lower right and +v to the
 * lower left, so the +u face is the tile's east-south edge, -u is west-north,
 * -v is north-east and +v is south-west.
 */
/**
 * The two screen points of one face of a tile.
 *
 * Shared, because three things now have to agree about where a tile's boundary
 * is -- the painted line, the fence and the bollards -- and each of them
 * working it out again is how they end up in three different places. The fence
 * did: it was drawn symmetrically about the tile *centre*, which put the naval
 * yard's perimeter half a tile inside its own apron, with a strip of hard
 * standing outside the wire.
 */
export function faceOf(u: number, v: number, face: TileFace): readonly [Point, Point] {
  const c = toScreen(u, v, 0);
  const north = { x: c.x, y: c.y - TILE_H / 2 };
  const east = { x: c.x + TILE_W / 2, y: c.y };
  const south = { x: c.x, y: c.y + TILE_H / 2 };
  const west = { x: c.x - TILE_W / 2, y: c.y };

  switch (face) {
    case "+u":
      return [east, south];
    case "-u":
      return [west, north];
    case "-v":
      return [north, east];
    case "+v":
      return [south, west];
  }
}

export function drawApronMarking(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  faces: readonly TileFace[],
  muted = false,
): void {
  if (faces.length === 0) return;
  const c = toScreen(u, v, 0);

  ctx.save();
  // Fogged ground gets a fogged line. It was always the bright yellow, so an
  // apron outside the granted scope kept a live-looking boundary painted round
  // it while the tiles inside had gone grey -- the one marking on the map that
  // said "reachable" about somewhere that was not.
  ctx.strokeStyle = muted ? COAST.apronLineFogged : COAST.apronLine;
  ctx.lineWidth = 2;
  ctx.globalAlpha = muted ? 0.5 : 0.8;

  for (const face of faces) {
    const [from, to] = faceOf(u, v, face);
    // Pulled in toward the centre, so the line sits on the apron rather than
    // straddling the join with whatever is outside it.
    const inset = 0.12;
    ctx.beginPath();
    ctx.moveTo(from.x + (c.x - from.x) * inset, from.y + (c.y - from.y) * inset);
    ctx.lineTo(to.x + (c.x - to.x) * inset, to.y + (c.y - to.y) * inset);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A run of security fence along one tile edge.
 *
 * `axis` is which way the panel runs; a naval yard's landward side gets a line
 * of these and its quay does not, which is the difference between a base and a
 * car park with a warship next to it.
 */
export function drawFence(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  face: TileFace,
  muted = false,
): void {
  // On the face, not through the middle. This was drawn symmetrically about the
  // tile centre and spanning between neighbouring centres, which put the whole
  // perimeter half a tile inside the yard: a strip of apron outside the wire,
  // and the fence cutting through the very cells it was meant to enclose.
  const [from, to] = faceOf(u, v, face);

  ctx.save();
  ctx.strokeStyle = muted ? COAST.fenceFogged : COAST.fence;
  ctx.lineWidth = 1;
  ctx.globalAlpha = muted ? 0.5 : 0.85;

  // Mesh: verticals along the run, and two rails. Drawn as strokes rather than
  // a texture so it stays legible when the camera is zoomed out and the whole
  // panel is four pixels tall.
  for (let t = 0; t <= 1; t += 0.125) {
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 13);
    ctx.stroke();
  }

  for (const lift of [4, 12]) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - lift);
    ctx.lineTo(to.x, to.y - lift);
    ctx.stroke();
  }

  ctx.globalAlpha = muted ? 0.6 : 1;
  ctx.strokeStyle = muted ? COAST.fenceFogged : COAST.fencePost;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(from.x, from.y - 15);
  ctx.stroke();
  ctx.restore();
}

/**
 * Mooring bollards along the seaward edge of a quay tile.
 *
 * Two of them, set on the tile's water-facing face rather than at its centre,
 * so a run of tiles gives an evenly spaced line down the quay instead of pairs
 * clustered in the middle of each.
 */
export function drawBollards(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  face: TileFace,
): void {
  const [from, to] = faceOf(u, v, face);
  ctx.save();
  // A quarter and three quarters along the edge, so the gap between the last
  // bollard on one tile and the first on the next matches the gap within a
  // pair. They were at 37.5% and 62.5%, which makes the intra-tile gap a third
  // of the inter-tile one -- so the run still read as separated pairs, which
  // was the exact defect replacing the pier decks was meant to remove.
  for (const t of [0.25, 0.75]) {
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    ctx.fillStyle = COAST.shadow;
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 1, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COAST.bollard;
    ctx.fillRect(x - 2, y - 5, 4, 5);
    ctx.fillRect(x - 3, y - 7, 6, 2);
  }
  ctx.restore();
}

/**
 * Sets a shape's own transparency without discarding the caller's.
 *
 * `ctx.globalAlpha = 0.12` replaces whatever the caller had set, which matters
 * because the scene dims an out-of-scope facility prop by wrapping its draw
 * call in `globalAlpha = 0.4`. Any shape that then assigned its own alpha
 * punched a fully lit hole through the fog: the lighthouse body went grey and
 * its beam stayed bright, which is worse than not dimming it at all.
 *
 * Multiplying composes instead. A shape saying "I am a twelfth as opaque as
 * whatever is going on" is true in both contexts; a shape saying "I am 0.12"
 * is only true in one.
 */
export function fadeBy(ctx: CanvasRenderingContext2D, factor: number): void {
  ctx.globalAlpha = ctx.globalAlpha * factor;
}

/** Characters that fit across a facility nameplate at its fixed size. */
export const SIGN_MAX = 9;

/**
 * A named board over the entrance to a facility.
 *
 * Smaller than a hoarding and doing a different job: a hoarding is advertising
 * and this is a nameplate. It is what lets someone looking at the map for the
 * first time know that the row of cranes is a port rather than a building site.
 */
export function drawFacilitySign(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  text: string,
): void {
  const c = toScreen(u, v, 0);
  const label = text.toUpperCase();
  ctx.save();

  ctx.fillStyle = COAST.signPost;
  ctx.fillRect(c.x - 20, c.y - 14, 3, 16);
  ctx.fillRect(c.x + 17, c.y - 14, 3, 16);

  ctx.fillStyle = COAST.signFace;
  ctx.fillRect(c.x - 26, c.y - 30, 52, 17);
  ctx.strokeStyle = COAST.apronLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(c.x - 26, c.y - 30, 52, 17);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Fixed size and a hard limit on the name instead of fitting the text to the
  // board. A nameplate with nine characters of room should have a name that
  // fits in nine, and the alternative -- shrinking the type until it does --
  // ends with a sign nobody can read. `SIGN_MAX` is asserted in the tests, so a
  // longer name fails the build rather than running off both ends of the board.
  ctx.font = "700 8px monospace";
  ctx.fillStyle = COAST.apronLine;
  ctx.fillText(label.slice(0, SIGN_MAX), c.x, c.y - 21);
  ctx.restore();
}

/**
 * A windsock on a pole, leaning downwind.
 *
 * The one thing on an airfield that says which way the wind is, and the detail
 * that separates a runway from a black rectangle with stripes on it.
 */
export function drawWindsock(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.floodMast;
  ctx.fillRect(c.x - 1, c.y - 30, 2, 30);
  ctx.strokeStyle = COAST.floodMast;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - 30);
  ctx.lineTo(c.x + 6, c.y - 27);
  ctx.stroke();

  // Alternating bands, wide end at the pole. Tapered, because a sock that does
  // not taper is a flag.
  const bands: readonly [number, number, string][] = [
    [6, 9, COAST.sockRed],
    [15, 7, COAST.sockWhite],
    [22, 5, COAST.sockRed],
    [28, 4, COAST.sockWhite],
  ];
  for (const [dx, h, colour] of bands) {
    ctx.fillStyle = colour;
    ctx.fillRect(c.x + dx, c.y - 28 - h / 2, 8, h);
  }
  ctx.restore();
}

/**
 * The terminal: a barrel-vaulted glass shed with a landside canopy.
 *
 * The airfield had a hangar, a tower and an aeroplane, which is a maintenance
 * base rather than an airport -- there was nowhere for anybody to get on. The
 * curved roof is doing the recognising here: at map scale nothing else on this
 * island is a cylinder lying on its side.
 */
export function drawRunway(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  axis: "u" | "v",
  end = false,
): void {
  drawDiamond(ctx, u, v, 0.04, "#1b2830", 0.96);
  const c = toScreen(u, v, 0.04);
  const angle = axis === "u" ? Math.atan2(TILE_H / 2, TILE_W / 2) : Math.atan2(TILE_H / 2, -TILE_W / 2);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(angle);

  // White edge boundary lines along both sides of the runway
  ctx.strokeStyle = "rgba(245, 247, 242, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(18, -12);
  ctx.moveTo(-18, 12);
  ctx.lineTo(18, 12);
  ctx.stroke();

  // Edge runway lights (blue/cyan)
  ctx.fillStyle = "#8de7f7";
  ctx.fillRect(-12, -13, 2, 2);
  ctx.fillRect(12, -13, 2, 2);
  ctx.fillRect(-12, 11, 2, 2);
  ctx.fillRect(12, 11, 2, 2);

  if (end) {
    // Piano-key threshold bars at runway end
    ctx.fillStyle = "#f5f7f2";
    for (let x = -14; x <= 14; x += 5) {
      ctx.fillRect(x, -8, 2.5, 16);
    }
    // Green/Red threshold end lamps
    ctx.fillStyle = u <= 3 ? "#6ee7b7" : "#f05d68";
    ctx.fillRect(-16, -11, 3, 3);
    ctx.fillRect(-16, 8, 3, 3);
  } else {
    // Center dashed line
    ctx.fillStyle = "#f5f7f2";
    ctx.fillRect(-11, -1.2, 22, 2.4);
    // Subtle wear mark
    ctx.fillStyle = "rgba(51, 67, 75, 0.4)";
    ctx.fillRect(-6, -4, 12, 8);
  }
  ctx.restore();
}

/**
 * The terminal: two stone piers flanking a glazed hall under a gold-ribbed
 * barrel vault, exactly matching the 3D isometric geometry of Claude City CCX.
 */
export function drawTerminal(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  ctx.save();

  // Helper for isometric 3D projected vertices relative to terminal center (u, v)
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  const line = (color: string, p1: Point, p2: Point, width = 1, alpha = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  // 1. Contact Ground Shadow
  poly(
    "rgba(7, 17, 22, 0.28)",
    [
      pt(-1.8, -0.85, 0),
      pt(2.2, -0.85, 0),
      pt(2.2, 1.25, 0),
      pt(-1.8, 1.25, 0),
    ],
  );

  // 2. Concrete Base Plinth (z: 0 -> 0.2)
  poly("#9ba9ad", [pt(-1.5, 0.75, 0.2), pt(1.5, 0.75, 0.2), pt(1.5, 0.75, 0), pt(-1.5, 0.75, 0)]);
  poly("#67777d", [pt(1.5, 0.75, 0.2), pt(1.5, -0.75, 0.2), pt(1.5, -0.75, 0), pt(1.5, 0.75, 0)]);

  // 3. Left Stone Pier (u: -1.7 -> -1.2, v: -0.75 -> 0.75, z: 0 -> 1.0)
  poly("#9ba9ad", [pt(-1.7, 0.75, 1.0), pt(-1.2, 0.75, 1.0), pt(-1.2, 0.75, 0), pt(-1.7, 0.75, 0)]);
  poly("#67777d", [pt(-1.2, 0.75, 1.0), pt(-1.2, -0.75, 1.0), pt(-1.2, -0.75, 0), pt(-1.2, 0.75, 0)]);
  poly("#c2ccce", [pt(-1.7, -0.75, 1.0), pt(-1.2, -0.75, 1.0), pt(-1.2, 0.75, 1.0), pt(-1.7, 0.75, 1.0)]);

  // 4. Right Side Annex with Flat Concrete Roof & HVAC (u: 1.2 -> 1.9, v: -0.75 -> 0.75, z: 0 -> 1.0)
  poly("#9ba9ad", [pt(1.2, 0.75, 1.0), pt(1.9, 0.75, 1.0), pt(1.9, 0.75, 0), pt(1.2, 0.75, 0)]);
  poly("#67777d", [pt(1.9, 0.75, 1.0), pt(1.9, -0.75, 1.0), pt(1.9, -0.75, 0), pt(1.9, 0.75, 0)]);
  poly("#c2ccce", [pt(1.2, -0.75, 1.0), pt(1.9, -0.75, 1.0), pt(1.9, 0.75, 1.0), pt(1.2, 0.75, 1.0)]);
  // HVAC Box on Annex Roof (z: 1.0 -> 1.25)
  poly("#67777d", [pt(1.4, 0.4, 1.25), pt(1.75, 0.4, 1.25), pt(1.75, 0.4, 1.0), pt(1.4, 0.4, 1.0)]);
  poly("#3a474d", [pt(1.75, 0.4, 1.25), pt(1.75, -0.2, 1.25), pt(1.75, -0.2, 1.0), pt(1.75, 0.4, 1.0)]);
  poly("#8c9ba5", [pt(1.4, -0.2, 1.25), pt(1.75, -0.2, 1.25), pt(1.75, 0.4, 1.25), pt(1.4, 0.4, 1.25)]);

  // 5. Front Curtain Wall Glazing (+v wall, u: -1.2 -> 1.2, z: 0.2 -> 1.4)
  poly("#143f52", [pt(-1.2, 0.75, 1.4), pt(1.2, 0.75, 1.4), pt(1.2, 0.75, 0.2), pt(-1.2, 0.75, 0.2)]);
  poly("#68c9df", [pt(-1.2, 0.75, 1.4), pt(1.2, 0.75, 1.4), pt(1.2, 0.75, 0.2), pt(-1.2, 0.75, 0.2)], 0.75);
  // Vertical glass mullions
  for (let du = -1.0; du <= 1.0; du += 0.25) {
    line("rgba(183, 241, 247, 0.8)", pt(du, 0.76, 1.4), pt(du, 0.76, 0.2), 1);
  }

  // 6. Barrel-Vaulted Curved Glass Roof (Vault spans along u: -1.2 -> 1.2, arches across v: -0.75 -> 0.75, z: 1.4 -> 2.4)
  const segments = 10;
  const vaultV = (i: number) => 0.75 * Math.cos((i / segments) * Math.PI);
  const vaultZ = (i: number) => 1.4 + 1.0 * Math.sin((i / segments) * Math.PI);

  // Shaded Rear Gable (+u return)
  const rearGable: Point[] = [pt(1.2, 0.75, 1.4)];
  for (let i = 0; i <= segments; i += 1) {
    rearGable.push(pt(1.2, vaultV(i), vaultZ(i)));
  }
  rearGable.push(pt(1.2, -0.75, 1.4));
  poly("#26748d", rearGable);

  // Barrel vault longitudinal glass strips
  for (let i = 0; i < segments; i += 1) {
    const v0 = vaultV(i);
    const v1 = vaultV(i + 1);
    const z0 = vaultZ(i);
    const z1 = vaultZ(i + 1);

    const quad: Point[] = [
      pt(-1.2, v0, z0),
      pt(1.2, v0, z0),
      pt(1.2, v1, z1),
      pt(-1.2, v1, z1),
    ];

    // Color gradient based on segment angle: lit top -> cyan body -> deep blue
    const tone = i < 3 ? "#26748d" : i < 7 ? "#b7f1f7" : "#68c9df";
    const alpha = i < 3 ? 0.95 : i < 7 ? 0.9 : 0.85;
    poly(tone, quad, alpha);
  }

  // Gold Arch Ribs along the vault
  for (const du of [-1.2, -0.6, 0, 0.6, 1.2]) {
    ctx.strokeStyle = "#f6bd60";
    ctx.lineWidth = du === -1.2 || du === 1.2 ? 2.5 : 1.5;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    const pStart = pt(du, vaultV(0), vaultZ(0));
    ctx.moveTo(pStart.x, pStart.y);
    for (let i = 1; i <= segments; i += 1) {
      const p = pt(du, vaultV(i), vaultZ(i));
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Gold Fascia Long Beams (+v and -v eaves, and crown)
  line("#f6bd60", pt(-1.2, 0.75, 1.4), pt(1.2, 0.75, 1.4), 2.5);
  line("#f6bd60", pt(-1.2, 0, 2.4), pt(1.2, 0, 2.4), 1.5, 0.8);

  // 7. Front Entrance Canopy with Gold Columns (u: -0.6 -> 0.6, v: 0.75 -> 1.25, z: 0 -> 0.9)
  // Two Gold Support Columns
  for (const du of [-0.5, 0.5]) {
    poly("#b9782f", [pt(du - 0.05, 1.2, 0.9), pt(du + 0.05, 1.2, 0.9), pt(du + 0.05, 1.2, 0), pt(du - 0.05, 1.2, 0)]);
  }
  // Gold Cantilevered Canopy Roof Deck
  poly("#f6bd60", [pt(-0.6, 1.25, 0.9), pt(0.6, 1.25, 0.9), pt(0.6, 1.25, 0.82), pt(-0.6, 1.25, 0.82)]);
  poly("#b9782f", [pt(0.6, 1.25, 0.9), pt(0.6, 0.75, 0.9), pt(0.6, 0.75, 0.82), pt(0.6, 1.25, 0.82)]);
  poly("#ffe0a3", [pt(-0.6, 0.75, 0.9), pt(0.6, 0.75, 0.9), pt(0.6, 1.25, 0.9), pt(-0.6, 1.25, 0.9)]);

  // 8. Dark Fascia Sign Plate with Bold Gold "CCX" Label
  const signCenter = pt(0, 0.76, 1.15);
  ctx.fillStyle = "#10232e";
  ctx.globalAlpha = 0.95;
  ctx.fillRect(signCenter.x - 18, signCenter.y - 7, 36, 14);
  ctx.strokeStyle = "#f6bd60";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(signCenter.x - 18, signCenter.y - 7, 36, 14);

  // Bold "CCX" Letters
  ctx.fillStyle = "#f6bd60";
  ctx.globalAlpha = 1;
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CCX", signCenter.x, signCenter.y);

  ctx.restore();
}

/** Hexagonal tapered concrete control tower with observation cab and beacon. */
export function drawControlTower(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  ctx.save();
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // Base Contact Shadow
  poly("rgba(7, 17, 22, 0.26)", [pt(-0.4, -0.4, 0), pt(0.4, -0.4, 0), pt(0.4, 0.4, 0), pt(-0.4, 0.4, 0)]);

  // Tapered Concrete Shaft (z: 0 -> 2.8, width: 0.38 -> 0.26)
  poly("#9ba9ad", [pt(-0.22, 0.22, 2.8), pt(0.22, 0.22, 2.8), pt(0.32, 0.32, 0), pt(-0.32, 0.32, 0)]);
  poly("#67777d", [pt(0.22, 0.22, 2.8), pt(0.22, -0.22, 2.8), pt(0.32, -0.32, 0), pt(0.32, 0.32, 0)]);

  // Gold String Courses up the shaft
  for (const z of [0.9, 1.9]) {
    const w = 0.32 - (0.1 * z) / 2.8;
    ctx.strokeStyle = "#f6bd60";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    const p1 = pt(-w, w, z);
    const p2 = pt(w, w, z);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Gold Collar under observation cab (z: 2.8 -> 2.95)
  poly("#f6bd60", [pt(-0.38, 0.38, 2.95), pt(0.38, 0.38, 2.95), pt(0.38, 0.38, 2.8), pt(-0.38, 0.38, 2.8)]);
  poly("#b9782f", [pt(0.38, 0.38, 2.95), pt(0.38, -0.38, 2.95), pt(0.38, -0.38, 2.8), pt(0.38, 0.38, 2.8)]);

  // Glass Observation Cab (z: 2.95 -> 3.65)
  poly("#b7f1f7", [pt(-0.46, 0.46, 3.65), pt(0.46, 0.46, 3.65), pt(0.38, 0.38, 2.95), pt(-0.38, 0.38, 2.95)], 0.95);
  poly("#26748d", [pt(0.46, 0.46, 3.65), pt(0.46, -0.46, 3.65), pt(0.38, -0.38, 2.95), pt(0.38, 0.38, 2.95)], 0.95);

  // Flat Dark Roof Cap (z: 3.65 -> 3.75)
  poly("#10232e", [pt(-0.5, -0.5, 3.75), pt(0.5, -0.5, 3.75), pt(0.5, 0.5, 3.75), pt(-0.5, 0.5, 3.75)]);
  ctx.strokeStyle = "#f6bd60";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Antenna Mast & Blinking Red Obstruction Beacon
  const mastBase = pt(0, 0, 3.75);
  ctx.strokeStyle = "#c2ccce";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mastBase.x, mastBase.y);
  ctx.lineTo(mastBase.x, mastBase.y - 16);
  ctx.stroke();

  // Blinking Red Obstruction Beacon
  ctx.fillStyle = "#f05d68";
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(mastBase.x, mastBase.y - 18, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A cylindrical fuel tank with a banded top and a walkway rail. */
export function drawFuelTank(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();

  ctx.fillStyle = COAST.shadow;
  ctx.beginPath();
  ctx.ellipse(c.x + 3, c.y + 3, 21, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body, then the near half in shadow: a cylinder is the one solid on this map
  // that cannot be three flat faces, so it is two.
  ctx.fillStyle = COAST.tank;
  ctx.fillRect(c.x - 19, c.y - 24, 38, 24);
  ctx.fillStyle = COAST.tankShade;
  ctx.fillRect(c.x + 4, c.y - 24, 15, 24);

  ctx.fillStyle = COAST.tank;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 19, 7, 0, 0, Math.PI);
  ctx.fill();

  ctx.fillStyle = COAST.tankTop;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 24, 19, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = COAST.tankBand;
  ctx.lineWidth = 1;
  for (const lift of [8, 16]) {
    ctx.beginPath();
    ctx.moveTo(c.x - 19, c.y - lift);
    ctx.lineTo(c.x + 19, c.y - lift);
    ctx.stroke();
  }

  // Handrail round the top, which is what makes it read as a tank rather than
  // as a drum.
  ctx.strokeStyle = COAST.fence;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 30, 19, 7, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (const at of [-19, -9, 1, 11, 19]) {
    ctx.beginPath();
    ctx.moveTo(c.x + at, c.y - 24);
    ctx.lineTo(c.x + at, c.y - 30);
    ctx.stroke();
  }
  ctx.restore();
}

/** A floodlight mast: a pole and a head of lamps, lit. */
export function drawFloodlight(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.floodMast;
  ctx.fillRect(c.x - 2, c.y - 42, 4, 42);
  ctx.fillRect(c.x - 11, c.y - 46, 22, 5);
  ctx.fillStyle = COAST.floodLamp;
  for (const at of [-8, -1, 6]) ctx.fillRect(c.x + at, c.y - 45, 5, 3);

  // A pool of light on the apron under it. Low alpha, because this is a lamp
  // on a bright map and not a lamp at night -- and multiplied rather than
  // assigned, so a floodlight on fogged ground fades with the rest of it.
  fadeBy(ctx, 0.12);
  ctx.fillStyle = COAST.floodLamp;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 2, 28, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A flag on a pole, with the cloth held out as if there is a breeze. */
export function drawFlag(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  const c = toScreen(u, v, 0);
  ctx.save();
  ctx.fillStyle = COAST.flagPole;
  ctx.fillRect(c.x - 1, c.y - 34, 2, 34);
  ctx.fillStyle = COAST.flagCloth;
  ctx.beginPath();
  ctx.moveTo(c.x + 1, c.y - 34);
  ctx.lineTo(c.x + 16, c.y - 30);
  ctx.lineTo(c.x + 1, c.y - 25);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A small quayside hut: office, guardroom, stores, and port master warehouse. */
export function drawQuayHut(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  ctx.save();
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // 1. Ground Shadow
  poly("rgba(7, 17, 22, 0.3)", [
    pt(-0.9, -0.7, 0),
    pt(0.9, -0.7, 0),
    pt(0.9, 0.8, 0),
    pt(-0.9, 0.8, 0),
  ]);

  // 2. Cream/Beige Warehouse Walls (u: -0.75..0.75, v: -0.5..0.5, z: 0 -> 0.8)
  poly("#efe8d3", [
    pt(-0.75, 0.5, 0.8),
    pt(0.75, 0.5, 0.8),
    pt(0.75, 0.5, 0),
    pt(-0.75, 0.5, 0),
  ]);
  poly("#d4caa8", [
    pt(0.75, 0.5, 0.8),
    pt(0.75, -0.5, 0.8),
    pt(0.75, -0.5, 0),
    pt(0.75, 0.5, 0),
  ]);

  // 3. Dark Gabled Roof (Gable along u, ridge at z = 1.35)
  // Gable Triangular End on +u side
  poly("#263339", [
    pt(0.75, 0.5, 0.8),
    pt(0.75, 0, 1.35),
    pt(0.75, -0.5, 0.8),
  ]);
  // Front Pitched Roof Face
  poly("#33444c", [
    pt(-0.85, 0.55, 0.8),
    pt(0.85, 0.55, 0.8),
    pt(0.85, 0, 1.35),
    pt(-0.85, 0, 1.35),
  ]);
  // Rear Pitched Roof Face
  poly("#1e292e", [
    pt(-0.85, 0, 1.35),
    pt(0.85, 0, 1.35),
    pt(0.85, -0.55, 0.8),
    pt(-0.85, -0.55, 0.8),
  ]);

  // 4. Warehouse Windows and Large Open Bay Door
  // Bay Door
  poly("#16232c", [
    pt(-0.2, 0.51, 0.65),
    pt(0.3, 0.51, 0.65),
    pt(0.3, 0.51, 0),
    pt(-0.2, 0.51, 0),
  ]);
  // Windows with gold frames
  poly("#68c9df", [
    pt(-0.6, 0.51, 0.6),
    pt(-0.35, 0.51, 0.6),
    pt(-0.35, 0.51, 0.3),
    pt(-0.6, 0.51, 0.3),
  ]);
  poly("#68c9df", [
    pt(0.45, 0.51, 0.6),
    pt(0.65, 0.51, 0.6),
    pt(0.65, 0.51, 0.3),
    pt(0.45, 0.51, 0.3),
  ]);

  ctx.restore();
}

/** The largest of the offered sizes whose text fits, down to `min`. */
function fittedSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number,
  from: number,
  min: number,
): number {
  for (let size = from; size > min; size -= 1) {
    ctx.font = (from >= 9 ? "700 " : "") + size + "px monospace";
    if (ctx.measureText(text).width <= max) return size;
  }
  return min;
}

/** Timber Jetty / Pier extending out over the water with wooden planks, support pilings, and green navigation buoy. */
export function drawPier(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  ctx.save();
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // 1. Water Reflection Shadow
  poly("rgba(7, 17, 22, 0.35)", [
    pt(-0.6, -0.6, 0),
    pt(0.6, -0.6, 0),
    pt(0.6, 0.7, 0),
    pt(-0.6, 0.7, 0),
  ]);

  // 2. Dark Wooden Pilings in water (z: -0.2 -> 0.15)
  for (const [du, dv] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ] as const) {
    const p0 = pt(du, dv, -0.2);
    const p1 = pt(du, dv, 0.15);
    ctx.strokeStyle = "#4a3319";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // 3. Wooden Pier Deck Planks (z = 0.15)
  poly("#8d5b2d", [
    pt(-0.6, 0.6, 0.15),
    pt(0.6, 0.6, 0.15),
    pt(0.6, 0.6, 0.05),
    pt(-0.6, 0.6, 0.05),
  ]);
  poly("#5c3a1b", [
    pt(0.6, 0.6, 0.15),
    pt(0.6, -0.6, 0.15),
    pt(0.6, -0.6, 0.05),
    pt(0.6, 0.6, 0.05),
  ]);
  poly("#b6804d", [
    pt(-0.6, -0.6, 0.15),
    pt(0.6, -0.6, 0.15),
    pt(0.6, 0.6, 0.15),
    pt(-0.6, 0.6, 0.15),
  ]);

  // Individual Plank Lines
  ctx.strokeStyle = "rgba(74, 51, 25, 0.5)";
  ctx.lineWidth = 1;
  for (let du = -0.45; du <= 0.45; du += 0.22) {
    const p1 = pt(du, -0.55, 0.15);
    const p2 = pt(du, 0.55, 0.15);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // 4. Green Navigation Buoy / Cone on Corner Post
  const post0 = pt(0.45, 0.45, 0.15);
  const post1 = pt(0.45, 0.45, 0.55);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(post0.x, post0.y);
  ctx.lineTo(post1.x, post1.y);
  ctx.stroke();

  // Green Conical Topmark
  ctx.fillStyle = "#2ecc71";
  ctx.beginPath();
  ctx.moveTo(post1.x, post1.y - 7);
  ctx.lineTo(post1.x - 4, post1.y);
  ctx.lineTo(post1.x + 4, post1.y);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** 3D isometric ISO container stacks with corrugated sides and vibrant color palette. */
export function drawContainerStack(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  seed: number,
): void {
  ctx.save();
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  const palette = [
    { front: "#e74c3c", side: "#c0392b", top: "#f1948a" }, // Red
    { front: "#2980b9", side: "#1f618d", top: "#7fb3d5" }, // Blue
    { front: "#1abc9c", side: "#148f77", top: "#76d7c4" }, // Teal
    { front: "#f39c12", side: "#b9770e", top: "#f8c471" }, // Orange/Gold
    { front: "#7f8c8d", side: "#566573", top: "#bdc3c7" }, // Grey
    { front: "#2c3e50", side: "#1a252f", top: "#566573" }, // Navy
    { front: "#f5f7f2", side: "#d4e3e3", top: "#ffffff" }, // White
  ];

  // Draw 2 levels of 3D isometric ISO containers
  for (let lvl = 0; lvl < 2; lvl += 1) {
    const col = palette[(seed + lvl * 3) % palette.length]!;
    const z0 = lvl * 0.42;
    const z1 = z0 + 0.38;

    // ISO container dimensions: u: -0.45..0.45, v: -0.22..0.22
    poly(col.front, [
      pt(-0.45, 0.22, z1),
      pt(0.45, 0.22, z1),
      pt(0.45, 0.22, z0),
      pt(-0.45, 0.22, z0),
    ]);
    poly(col.side, [
      pt(0.45, 0.22, z1),
      pt(0.45, -0.22, z1),
      pt(0.45, -0.22, z0),
      pt(0.45, 0.22, z0),
    ]);
    poly(col.top, [
      pt(-0.45, -0.22, z1),
      pt(0.45, -0.22, z1),
      pt(0.45, 0.22, z1),
      pt(-0.45, 0.22, z1),
    ]);

    // Corrugation vertical lines on front face
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = 1;
    for (let du = -0.35; du <= 0.35; du += 0.15) {
      const pTop = pt(du, 0.23, z1);
      const pBot = pt(du, 0.23, z0);
      ctx.beginPath();
      ctx.moveTo(pTop.x, pTop.y);
      ctx.lineTo(pBot.x, pBot.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Rail-mounted portal container crane with 4-leg yellow lattice gantry, white machinery house, cyan glass cab, black rear counterweight, and boom. */
export function drawCrane(ctx: CanvasRenderingContext2D, u: number, v: number): void {
  ctx.save();

  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  const line = (color: string, p1: Point, p2: Point, width = 1.5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  // 1. Ground Shadow
  poly("rgba(7, 17, 22, 0.3)", [
    pt(-0.6, -0.6, 0),
    pt(0.6, -0.6, 0),
    pt(0.6, 1.4, 0),
    pt(-0.6, 1.4, 0),
  ]);

  // 2. 4 Yellow Portal Truss Legs (u: -0.45..0.45, v: -0.45..0.45, z: 0 -> 1.5)
  const yellowTruss = "#f6bd60";
  const yellowDark = "#d49a37";

  // Base wheel bogies
  for (const [du, dv] of [
    [-0.45, -0.45],
    [0.45, -0.45],
    [-0.45, 0.45],
    [0.45, 0.45],
  ] as const) {
    ctx.fillStyle = "#10232e";
    const b = pt(du, dv, 0);
    ctx.fillRect(b.x - 3, b.y - 2, 6, 3);
  }

  // Four Main Diagonal Columns
  line(yellowTruss, pt(-0.45, -0.45, 0), pt(-0.35, -0.35, 1.5), 2.5);
  line(yellowTruss, pt(0.45, -0.45, 0), pt(0.35, -0.35, 1.5), 2.5);
  line(yellowTruss, pt(-0.45, 0.45, 0), pt(-0.35, 0.35, 1.5), 2.5);
  line(yellowTruss, pt(0.45, 0.45, 0), pt(0.35, 0.35, 1.5), 2.5);

  // Cross-bracing lattice
  line(yellowDark, pt(-0.45, -0.45, 0.4), pt(-0.35, 0.35, 1.1), 1.2);
  line(yellowDark, pt(-0.45, 0.45, 0.4), pt(-0.35, -0.35, 1.1), 1.2);
  line(yellowDark, pt(0.45, -0.45, 0.4), pt(0.35, 0.35, 1.1), 1.2);
  line(yellowDark, pt(0.45, 0.45, 0.4), pt(0.35, -0.35, 1.1), 1.2);
  line(yellowDark, pt(-0.45, 0.45, 0.4), pt(0.35, 0.45, 1.1), 1.2);
  line(yellowDark, pt(0.45, 0.45, 0.4), pt(-0.35, 0.45, 1.1), 1.2);

  // Gantry Collar / Top Frame
  poly(yellowTruss, [
    pt(-0.38, -0.38, 1.5),
    pt(0.38, -0.38, 1.5),
    pt(0.38, 0.38, 1.5),
    pt(-0.38, 0.38, 1.5),
  ]);

  // 3. White Machinery Housing (z: 1.5 -> 2.0)
  poly("#f5f7f2", [
    pt(-0.35, 0.35, 2.0),
    pt(0.35, 0.35, 2.0),
    pt(0.35, 0.35, 1.5),
    pt(-0.35, 0.35, 1.5),
  ]);
  poly("#d4e3e3", [
    pt(0.35, 0.35, 2.0),
    pt(0.35, -0.35, 2.0),
    pt(0.35, -0.35, 1.5),
    pt(0.35, 0.35, 1.5),
  ]);
  poly("#ffffff", [
    pt(-0.35, -0.35, 2.0),
    pt(0.35, -0.35, 2.0),
    pt(0.35, 0.35, 2.0),
    pt(-0.35, 0.35, 2.0),
  ]);

  // Cyan Glass Cab Window on Machinery Deck
  poly("#68c9df", [
    pt(-0.25, 0.36, 1.9),
    pt(0.1, 0.36, 1.9),
    pt(0.1, 0.36, 1.6),
    pt(-0.25, 0.36, 1.6),
  ]);

  // 4. Black Rear Counterweight Block (u: -0.4..-0.1, v: -0.6..-0.35, z: 1.6 -> 2.1)
  poly("#10232e", [
    pt(-0.4, -0.35, 2.1),
    pt(-0.1, -0.35, 2.1),
    pt(-0.1, -0.35, 1.6),
    pt(-0.4, -0.35, 1.6),
  ]);
  poly("#22333b", [
    pt(-0.4, -0.6, 2.1),
    pt(-0.4, -0.35, 2.1),
    pt(-0.4, -0.35, 1.6),
    pt(-0.4, -0.6, 1.6),
  ]);
  poly("#2c3e50", [
    pt(-0.4, -0.6, 2.1),
    pt(-0.1, -0.6, 2.1),
    pt(-0.1, -0.35, 2.1),
    pt(-0.4, -0.35, 2.1),
  ]);

  // 5. Long Yellow Cantilevered Boom Arm (Extends out along +v over water: v = -0.4 -> 1.5, z: 1.8 -> 2.1)
  line("#f6bd60", pt(0, -0.4, 2.05), pt(0, 1.5, 2.05), 3.5);
  line("#d49a37", pt(0, -0.4, 2.05), pt(0, 1.5, 2.05), 1.5);
  // Diagonal Stay Cables / Guy Wires
  line("rgba(245, 247, 242, 0.8)", pt(0, 0, 2.6), pt(0, 1.4, 2.05), 1);
  line("rgba(245, 247, 242, 0.8)", pt(0, 0, 2.6), pt(0, -0.4, 2.05), 1);

  // Suspended Hoist Cable & Hook Spreader
  line("rgba(16, 35, 46, 0.85)", pt(0, 1.0, 2.05), pt(0, 1.0, 0.8), 1);
  ctx.fillStyle = "#f6bd60";
  const hook = pt(0, 1.0, 0.8);
  ctx.fillRect(hook.x - 4, hook.y - 1, 8, 3);

  // 6. Mast with Flashing Red Warning Beacon
  line("#f5f7f2", pt(0, 0, 2.0), pt(0, 0, 2.6), 1.5);
  ctx.fillStyle = "#f05d68";
  const beacon = pt(0, 0, 2.6);
  ctx.beginPath();
  ctx.arc(beacon.x, beacon.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

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
  fadeBy(ctx, 0.12 + (Math.sin(time / 650) + 1) * 0.06);
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
  ctx.save();
  const pt = (du: number, dv: number, dz = 0) => toScreen(u + du, v + dv, dz);

  const poly = (color: string, points: Point[], alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // 1. Water Displacement Foam / Wake
  poly("rgba(245, 247, 242, 0.35)", [
    pt(-1.8, -0.5, 0),
    pt(1.8, -0.5, 0),
    pt(2.0, 0.5, 0),
    pt(-1.9, 0.5, 0),
  ]);

  if (kind === "cargo") {
    // 2. Red Boot-Topping (keel water line)
    poly("#c0392b", [
      pt(-1.6, 0.35, 0.08),
      pt(1.4, 0.35, 0.08),
      pt(1.7, 0, 0.08),
      pt(1.7, 0, -0.05),
      pt(1.4, 0.35, -0.05),
      pt(-1.6, 0.35, -0.05),
    ]);

    // 3. Navy/Black Cargo Hull
    poly("#14232c", [
      pt(-1.6, 0.35, 0.35),
      pt(1.4, 0.35, 0.35),
      pt(1.75, 0, 0.35),
      pt(1.75, 0, 0.08),
      pt(1.4, 0.35, 0.08),
      pt(-1.6, 0.35, 0.08),
    ]);
    poly("#0d171e", [
      pt(-1.6, 0.35, 0.35),
      pt(-1.6, -0.35, 0.35),
      pt(-1.6, -0.35, 0.08),
      pt(-1.6, 0.35, 0.08),
    ]);

    // 4. Dark Cargo Hold / Hatch Deck
    poly("#2c3e50", [
      pt(-1.5, -0.3, 0.35),
      pt(1.3, -0.3, 0.35),
      pt(1.6, 0, 0.35),
      pt(1.3, 0.3, 0.35),
      pt(-1.5, 0.3, 0.35),
    ]);

    // Cargo Hold Hatch Covers
    poly("#10232e", [
      pt(-0.6, -0.22, 0.42),
      pt(0.9, -0.22, 0.42),
      pt(0.9, 0.22, 0.42),
      pt(-0.6, 0.22, 0.42),
    ]);

    // 5. White Multi-Tier Superstructure / Bridge (at stern u: -1.5..-0.8)
    // Tier 1 (z: 0.35 -> 0.75)
    poly("#f5f7f2", [
      pt(-1.4, 0.28, 0.75),
      pt(-0.8, 0.28, 0.75),
      pt(-0.8, 0.28, 0.35),
      pt(-1.4, 0.28, 0.35),
    ]);
    poly("#d4e3e3", [
      pt(-0.8, 0.28, 0.75),
      pt(-0.8, -0.28, 0.75),
      pt(-0.8, -0.28, 0.35),
      pt(-0.8, 0.28, 0.35),
    ]);
    poly("#ffffff", [
      pt(-1.4, -0.28, 0.75),
      pt(-0.8, -0.28, 0.75),
      pt(-0.8, 0.28, 0.75),
      pt(-1.4, 0.28, 0.75),
    ]);

    // Tier 2 (Bridge Deck, z: 0.75 -> 1.1)
    poly("#f5f7f2", [
      pt(-1.3, 0.24, 1.1),
      pt(-0.9, 0.24, 1.1),
      pt(-0.9, 0.24, 0.75),
      pt(-1.3, 0.24, 0.75),
    ]);
    poly("#d4e3e3", [
      pt(-0.9, 0.24, 1.1),
      pt(-0.9, -0.24, 1.1),
      pt(-0.9, -0.24, 0.75),
      pt(-0.9, 0.24, 0.75),
    ]);
    poly("#ffffff", [
      pt(-1.3, -0.24, 1.1),
      pt(-0.9, -0.24, 1.1),
      pt(-0.9, 0.24, 1.1),
      pt(-1.3, 0.24, 1.1),
    ]);

    // Cyan Bridge Windows
    poly("#68c9df", [
      pt(-1.25, 0.25, 1.02),
      pt(-0.95, 0.25, 1.02),
      pt(-0.95, 0.25, 0.85),
      pt(-1.25, 0.25, 0.85),
    ]);

    // Black Funnel / Smokestack with Gold Band
    poly("#10232e", [
      pt(-1.35, 0.1, 1.35),
      pt(-1.15, 0.1, 1.35),
      pt(-1.15, 0.1, 1.1),
      pt(-1.35, 0.1, 1.1),
    ]);
    poly("#f6bd60", [
      pt(-1.35, 0.11, 1.3),
      pt(-1.15, 0.11, 1.3),
      pt(-1.15, 0.11, 1.22),
      pt(-1.35, 0.11, 1.22),
    ]);

    // 6. Forward Mast on Foredeck
    const mast0 = pt(1.1, 0, 0.35);
    const mast1 = pt(1.1, 0, 0.95);
    ctx.strokeStyle = "#f5f7f2";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mast0.x, mast0.y);
    ctx.lineTo(mast1.x, mast1.y);
    ctx.stroke();

  } else {
    // Warship
    poly("#2c3e50", [
      pt(-1.7, 0.35, 0.35),
      pt(1.5, 0.35, 0.35),
      pt(1.85, 0, 0.35),
      pt(1.85, 0, 0),
      pt(1.5, 0.35, 0),
      pt(-1.7, 0.35, 0),
    ]);
    poly("#1a252f", [
      pt(-1.7, 0.35, 0.35),
      pt(-1.7, -0.35, 0.35),
      pt(-1.7, -0.35, 0),
      pt(-1.7, 0.35, 0),
    ]);
    poly("#34495e", [
      pt(-1.6, -0.3, 0.35),
      pt(1.4, -0.3, 0.35),
      pt(1.7, 0, 0.35),
      pt(1.4, 0.3, 0.35),
      pt(-1.6, 0.3, 0.35),
    ]);

    // Superstructure & Gun Turrets
    poly("#4a6572", [
      pt(-0.8, 0.2, 0.75),
      pt(0.4, 0.2, 0.75),
      pt(0.4, 0.2, 0.35),
      pt(-0.8, 0.2, 0.35),
    ]);
    poly("#34495e", [
      pt(0.4, 0.2, 0.75),
      pt(0.4, -0.2, 0.75),
      pt(0.4, -0.2, 0.35),
      pt(0.4, 0.2, 0.35),
    ]);

    // Forward Gun Turret (u = 0.9)
    const gun = pt(0.9, 0, 0.42);
    ctx.fillStyle = "#10232e";
    ctx.beginPath();
    ctx.arc(gun.x, gun.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#10232e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gun.x, gun.y);
    ctx.lineTo(gun.x + 8, gun.y + 4);
    ctx.stroke();
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
