import { UNIT_H, blockBounds, depth, toScreen } from "../iso/projection.js";
import {
  AGENT,
  CONCRETE,
  FOGGED,
  GROUND,
  HOUSE,
  UI,
  landmarkStyle,
  type BuildingStyleSet,
} from "./palette.js";
import {
  drawBuilding,
  drawCivicDome,
  drawFountain,
  drawLamp,
  drawPerimeter,
  drawShadow,
  drawTree,
  drawVehicle,
} from "./shapes.js";
import { bake, blit } from "./bake.js";
import {
  blendAmount,
  drawDitheredTile,
  drawRecessed,
  drawRoadMarkings,
} from "./terrain.js";
import {
  DISTRICT_PLOTS,
  ISLAND_H,
  ISLAND_W,
  fountainCells,
  hash,
  isInScope,
  layOutCity,
  perimeterOf,
  roadConnections,
  tileKindAt,
  treeCells,
  type Building,
} from "./world.js";

/**
 * Draws one frame.
 *
 * Everything is collected into a single list, sorted by painter's depth, then
 * drawn. Sorting once at the end rather than drawing in nested loops is what
 * lets the agent walk behind a tower with no special case: its depth is just
 * another number in the same list.
 *
 * The city itself does not change between frames, so its layout is computed
 * once and cached against the office list. Only figures, gates and the scope
 * wall are recomputed per frame.
 */

export interface Figure {
  readonly id: string;
  readonly u: number;
  readonly v: number;
  readonly kind: "agent" | "team";
}

export interface SceneState {
  readonly online: readonly string[];
  readonly granted: readonly string[];
  readonly proposed: readonly string[];
  readonly offices: readonly { office: string; district: string }[];
  readonly figures: readonly Figure[];
  readonly gates: readonly string[];
  readonly refusedAt: { u: number; v: number } | null;
  readonly scopeState: "none" | "proposed" | "granted";
}

interface Drawable {
  readonly z: number;
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
}

/** Layout is expensive and static; recompute only when the offices change. */
let cachedKey = "";
let cachedCity: Building[] = [];
let cachedTrees: { u: number; v: number }[] = [];
let cachedFountains: { u: number; v: number }[] = [];

function cityFor(offices: readonly { office: string; district: string }[]): {
  buildings: Building[];
  trees: { u: number; v: number }[];
  fountains: { u: number; v: number }[];
} {
  const key = offices.map((o) => `${o.district}/${o.office}`).join(",");
  if (key !== cachedKey) {
    cachedKey = key;
    cachedCity = layOutCity(offices);
    cachedTrees = treeCells(cachedCity);
    cachedFountains = fountainCells(cachedCity);
  }
  return { buildings: cachedCity, trees: cachedTrees, fountains: cachedFountains };
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: SceneState,
  camera: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  time: number,
): void {
  ctx.save();
  ctx.fillStyle = UI.sky;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.translate(size.width / 2 + camera.x, size.height / 2 + camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.imageSmoothingEnabled = false;

  const { buildings, trees, fountains } = cityFor(state.offices);

  const items: Drawable[] = [
    ...groundItems(state),
    ...fountainItems(fountains, state),
    ...treeItems(trees, state),
    ...buildingItems(buildings, state),
    ...landmarkItems(state),
    ...trafficItems(state, time),
    ...figureItems(state),
  ];

  items.sort((a, b) => a.z - b.z);
  for (const item of items) item.draw(ctx);

  drawScopeWall(ctx, state, time);
  drawRefusal(ctx, state, time);

  ctx.restore();
}

/**
 * The island: water, sand, streets, pavement and grass.
 *
 * Grass picks one of three shades from a cell hash so a lawn has texture
 * without anyone authoring one. Outside a granted scope everything shifts to
 * the fog palette -- unreachable places read as unmapped rather than disabled.
 */
/** The material a ground tile is painted in, given whether it is reachable. */
function groundMaterial(
  kind: ReturnType<typeof tileKindAt>,
  inScope: boolean,
  scopeState: SceneState["scopeState"],
) {
  if (kind === "water") return GROUND.water!;
  if (scopeState !== "none" && !inScope) {
    return kind === "grass" ? GROUND.fogGrass! : GROUND.fogged!;
  }
  if (kind === "sand") return GROUND.sand!;
  if (kind === "pavement") return GROUND.pavement!;
  if (kind === "road") return GROUND.road!;
  return GROUND.grass!;
}

/** How far a road sits below the pavement around it. */
const ROAD_DROP = 0.09;

function groundItems(state: SceneState): Drawable[] {
  const items: Drawable[] = [];
  const scoped = (u: number, v: number) => isInScope({ u, v }, state.granted);

  const isGrass = (u: number, v: number) => tileKindAt(u, v) === "grass";
  const isSand = (u: number, v: number) => tileKindAt(u, v) === "sand";
  const isWater = (u: number, v: number) => tileKindAt(u, v) === "water";

  for (let u = -2; u <= ISLAND_W + 2; u += 1) {
    for (let v = -2; v <= ISLAND_H + 2; v += 1) {
      const kind = tileKindAt(u, v);
      const inScope = scoped(u, v);
      const material = groundMaterial(kind, inScope, state.scopeState);
      const cu = u;
      const cv = v;

      if (kind === "road") {
        const mask = roadConnections(cu, cv);
        const kerb = state.scopeState === "none" || inScope ? GROUND.pavement! : GROUND.fogged!;
        items.push({
          z: depth(cu, cv, -1),
          draw: (ctx) => {
            drawRecessed(ctx, cu, cv, material, kerb, ROAD_DROP);
            drawRoadMarkings(ctx, cu, cv, mask, ROAD_DROP);
          },
        });
        continue;
      }

      // Blend grass into sand, and sand into water, so no boundary is a hard
      // line. Only the landward side of each pair carries the dither.
      let blend = null;
      let amount = 0;
      if (kind === "grass") {
        amount = blendAmount(cu, cv, isGrass, isSand);
        blend = state.scopeState === "none" || inScope ? GROUND.sand! : GROUND.fogged!;
      } else if (kind === "sand") {
        amount = blendAmount(cu, cv, isSand, isWater);
        blend = GROUND.water!;
      }

      const variant = kind === "grass" ? hash(`${cu}:${cv}`) % 3 : 0;
      items.push({
        z: depth(cu, cv, -1),
        draw: (ctx) => drawDitheredTile(ctx, cu, cv, material, blend, amount, variant),
      });
    }
  }

  // Lamps along pavements, spaced out.
  for (let u = 2; u <= ISLAND_W - 2; u += 1) {
    for (let v = 2; v <= ISLAND_H - 2; v += 1) {
      if (tileKindAt(u, v) !== "pavement") continue;
      if (hash(`lamp:${u}:${v}`) % 11 !== 0) continue;
      const cu = u;
      const cv = v;
      items.push({ z: depth(cu, cv, 1), draw: (ctx) => drawLamp(ctx, cu, cv) });
    }
  }

  return items;
}

function treeItems(
  trees: readonly { u: number; v: number }[],
  state: SceneState,
): Drawable[] {
  return trees.map((cell) => {
    const muted = state.scopeState !== "none" && !isInScope(cell, state.granted);
    return {
      z: depth(cell.u, cell.v, 1),
      draw: (ctx: CanvasRenderingContext2D) =>
        drawTree(ctx, cell.u, cell.v, hash(`t:${cell.u}:${cell.v}`), muted),
    };
  });
}

function fountainItems(
  fountains: readonly { u: number; v: number }[],
  state: SceneState,
): Drawable[] {
  return fountains.map((cell) => {
    const muted = state.scopeState !== "none" && !isInScope(cell, state.granted);
    return {
      z: depth(cell.u, cell.v, 0.4),
      draw: (ctx: CanvasRenderingContext2D) => drawFountain(ctx, cell.u, cell.v, muted),
    };
  });
}

function buildingItems(buildings: readonly Building[], state: SceneState): Drawable[] {
  return buildings.map((building) => {
    const { u, v } = building.cell;
    const inScope = isInScope(building.cell, state.granted);

    let style: BuildingStyleSet = building.kind === "house" ? HOUSE : CONCRETE;
    if (state.scopeState !== "none" && !inScope) style = FOGGED;

    const height = building.height;
    const seed = building.seed % 105;
    const lit = state.scopeState === "none" || inScope;
    const styleName = style === FOGGED ? "fog" : building.kind === "house" ? "house" : "concrete";

    return {
      z: depth(u, v, height),
      draw: (ctx: CanvasRenderingContext2D) => {
        const rise = height * UNIT_H;
        const sprite = bake(
          `building:${styleName}:${height.toFixed(2)}:${seed}:${lit ? 1 : 0}`,
          96,
          rise + 76,
          48,
          rise + 46,
          (spriteCtx) => {
            drawShadow(spriteCtx, 0, 0, 0.7);
            drawBuilding(spriteCtx, 0, 0, height, style, seed, lit);
          },
        );
        const anchor = toScreen(u, v, 0);
        blit(ctx, sprite, anchor.x, anchor.y);
      },
    };
  });
}

/** Every district keeps a visible civic landmark, even before MCP connects. */
function landmarkItems(state: SceneState): Drawable[] {
  const items: Drawable[] = [];
  for (const plot of DISTRICT_PLOTS) {
    const { u, v } = plot.landmark;
    const inScope = isInScope(plot.landmark, state.granted);
    const visible = state.scopeState === "none" || inScope;
    const style = visible ? landmarkStyle(plot.id) : FOGGED;
    const height = plot.landmarkHeight;
    const gated = state.gates.includes(plot.id);
    const online = state.online.includes(plot.id);
    const seed = hash(plot.id);

    if (plot.id === "exchequer") {
      for (const [du, dv] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const wingU = u + du;
        const wingV = v + dv;
        items.push({
          z: depth(wingU, wingV, 0.8),
          draw: (ctx) => {
            drawShadow(ctx, wingU, wingV, 0.72);
            drawBuilding(ctx, wingU, wingV, 0.72, style, seed + du * 7 + dv * 11, visible);
          },
        });
      }
    }

    items.push({
      z: depth(u, v, height + 1),
      draw: (ctx) => {
        drawShadow(ctx, u, v, 1.1);
        drawBuilding(ctx, u, v, height, style, seed, visible);

        if (plot.id === "exchequer") drawCivicDome(ctx, u, v, height + 0.02, !visible);

        if (online && !gated) {
          const beacon = toScreen(u, v, height + (plot.id === "exchequer" ? 0.5 : 0.15));
          ctx.fillStyle = UI.good;
          ctx.fillRect(beacon.x - 2, beacon.y - 8, 4, 4);
        }

        if (gated) {
          // A mast on the roof while this district is holding a gate.
          const top = toScreen(u, v, height);
          ctx.fillStyle = UI.mast;
          ctx.fillRect(top.x - 1, top.y - 30, 2, 30);
          ctx.fillStyle = UI.danger;
          ctx.fillRect(top.x - 7, top.y - 32, 14, 9);
        }
      },
    });
  }

  return items;
}

const TRAFFIC = [
  { axis: "u", road: 6, lane: -0.16, speed: 1.2, offset: 0.04, colour: "#d8584d" },
  { axis: "u", road: 12, lane: 0.16, speed: 0.86, offset: 0.43, colour: "#f1b33b" },
  { axis: "u", road: 18, lane: -0.16, speed: 1.05, offset: 0.71, colour: "#377fc1" },
  { axis: "u", road: 24, lane: 0.16, speed: 0.95, offset: 0.21, colour: "#efe9dc" },
  { axis: "u", road: 30, lane: -0.16, speed: 1.15, offset: 0.58, colour: "#5ba36b" },
  { axis: "v", road: 6, lane: 0.16, speed: 0.92, offset: 0.14, colour: "#eee8da" },
  { axis: "v", road: 12, lane: -0.16, speed: 1.08, offset: 0.52, colour: "#cf5f50" },
  { axis: "v", road: 18, lane: 0.16, speed: 0.82, offset: 0.82, colour: "#e4aa38" },
  { axis: "v", road: 24, lane: -0.16, speed: 1.18, offset: 0.32, colour: "#5f91c8" },
  { axis: "v", road: 30, lane: 0.16, speed: 0.98, offset: 0.64, colour: "#72a76a" },
  { axis: "v", road: 36, lane: -0.16, speed: 0.76, offset: 0.08, colour: "#f0e8d8" },
] as const;

function trafficItems(state: SceneState, time: number): Drawable[] {
  return TRAFFIC.map((route) => {
    const min = 2;
    const max = route.axis === "u" ? ISLAND_W - 2 : ISLAND_H - 2;
    const span = max - min;
    const progress = ((time / 1000) * route.speed / span + route.offset) % 1;
    const moving = min + progress * span;
    const u = route.axis === "u" ? moving : route.road + route.lane;
    const v = route.axis === "v" ? moving : route.road + route.lane;
    const muted = state.scopeState !== "none" && !isInScope({ u, v }, state.granted);
    return {
      z: depth(u, v, 0.5),
      draw: (ctx: CanvasRenderingContext2D) => drawVehicle(ctx, u, v, route.axis, route.colour, muted),
    };
  });
}

function figureItems(state: SceneState): Drawable[] {
  return state.figures.map((figure) => {
    const { u, v, kind } = figure;
    return {
      z: depth(u, v, 20),
      draw: (ctx: CanvasRenderingContext2D) => {
        const p = toScreen(u, v, 0);
        drawShadow(ctx, u, v, 0.45);

        const body = kind === "agent" ? AGENT.body : AGENT.team;
        const shade = kind === "agent" ? AGENT.bodyShade : AGENT.teamShade;

        // Deliberately a marker, not a character. A person-shaped sprite
        // invites the eye to read intent into its posture; a token does not.
        ctx.fillStyle = shade;
        ctx.fillRect(p.x - 6, p.y - 22, 12, 22);
        ctx.fillStyle = body;
        ctx.fillRect(p.x - 6, p.y - 22, 8, 22);
        ctx.fillStyle = AGENT.mark;
        ctx.fillRect(p.x - 4, p.y - 18, 5, 5);

        ctx.strokeStyle = UI.outline;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - 6.5, p.y - 22.5, 13, 23);
      },
    };
  });
}

function drawScopeWall(ctx: CanvasRenderingContext2D, state: SceneState, time: number): void {
  const districts = state.scopeState === "proposed" ? state.proposed : state.granted;
  if (state.scopeState === "none" || districts.length === 0) return;

  // A slow breath on the glow only, so the boundary feels live without the
  // line itself moving.
  const pulse = 0.16 + Math.sin(time / 700) * 0.06;

  drawPerimeter(
    ctx,
    perimeterOf(districts),
    UI.wall,
    `rgba(255, 194, 71, ${pulse.toFixed(3)})`,
    state.scopeState === "proposed",
  );
}

function drawRefusal(ctx: CanvasRenderingContext2D, state: SceneState, time: number): void {
  if (!state.refusedAt) return;

  const p = toScreen(state.refusedAt.u, state.refusedAt.v, 0.6);
  const flash = 0.45 + Math.sin(time / 80) * 0.45;

  ctx.save();
  ctx.strokeStyle = `rgba(224, 90, 74, ${flash.toFixed(3)})`;
  ctx.lineWidth = 4;
  for (const r of [22, 34]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function fitCamera(size: { width: number; height: number }): {
  x: number;
  y: number;
  zoom: number;
} {
  const bounds = blockBounds(-2, -2, ISLAND_W + 2, ISLAND_H + 2);
  const worldW = bounds.max.x - bounds.min.x;
  const worldH = bounds.max.y - bounds.min.y;

  const zoom = Math.min(size.width / worldW, size.height / worldH) * 0.95;
  const centre = toScreen(ISLAND_W / 2, ISLAND_H / 2, 0);

  return { x: -centre.x * zoom, y: -centre.y * zoom, zoom };
}
