import { blockBounds, depth, toScreen } from "../iso/projection.js";
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
  drawLamp,
  drawPerimeter,
  drawShadow,
  drawTree,
} from "./shapes.js";
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

function cityFor(offices: readonly { office: string; district: string }[]): {
  buildings: Building[];
  trees: { u: number; v: number }[];
} {
  const key = offices.map((o) => `${o.district}/${o.office}`).join(",");
  if (key !== cachedKey) {
    cachedKey = key;
    cachedCity = layOutCity(offices);
    cachedTrees = treeCells(cachedCity);
  }
  return { buildings: cachedCity, trees: cachedTrees };
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: SceneState,
  camera: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
  time: number,
): void {
  ctx.save();
  ctx.fillStyle = "#22597f";
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.translate(size.width / 2 + camera.x, size.height / 2 + camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.imageSmoothingEnabled = false;

  const { buildings, trees } = cityFor(state.offices);

  const items: Drawable[] = [
    ...groundItems(state),
    ...treeItems(trees, state),
    ...buildingItems(buildings, state),
    ...landmarkItems(state),
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
function groundMaterial(kind: ReturnType<typeof tileKindAt>, inScope: boolean) {
  if (kind === "water") return GROUND.water!;
  if (!inScope) return kind === "grass" ? GROUND.fogGrass! : GROUND.fogged!;
  if (kind === "sand") return GROUND.sand!;
  if (kind === "pavement") return GROUND.pavement!;
  if (kind === "road") return GROUND.road!;
  return GROUND.grass!;
}

/** How far a road sits below the pavement around it. */
const ROAD_DROP = 0.09;

function groundItems(state: SceneState): Drawable[] {
  const items: Drawable[] = [];
  const granted = state.granted.length > 0;
  const scoped = (u: number, v: number) => !granted || isInScope({ u, v }, state.granted);

  const isGrass = (u: number, v: number) => tileKindAt(u, v) === "grass";
  const isSand = (u: number, v: number) => tileKindAt(u, v) === "sand";
  const isWater = (u: number, v: number) => tileKindAt(u, v) === "water";

  for (let u = -2; u <= ISLAND_W + 2; u += 1) {
    for (let v = -2; v <= ISLAND_H + 2; v += 1) {
      const kind = tileKindAt(u, v);
      const inScope = scoped(u, v);
      const material = groundMaterial(kind, inScope);
      const cu = u;
      const cv = v;

      if (kind === "road") {
        const mask = roadConnections(cu, cv);
        const kerb = inScope ? GROUND.pavement! : GROUND.fogged!;
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
        blend = inScope ? GROUND.sand! : GROUND.fogged!;
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
  const granted = state.granted.length > 0;

  return trees
    .filter((cell) => !granted || isInScope(cell, state.granted))
    .map((cell) => ({
      z: depth(cell.u, cell.v, 1),
      draw: (ctx: CanvasRenderingContext2D) =>
        drawTree(ctx, cell.u, cell.v, hash(`t:${cell.u}:${cell.v}`)),
    }));
}

function buildingItems(buildings: readonly Building[], state: SceneState): Drawable[] {
  const granted = state.granted.length > 0;

  return buildings.map((building) => {
    const { u, v } = building.cell;
    const inScope = !granted || isInScope(building.cell, state.granted);

    let style: BuildingStyleSet = building.kind === "house" ? HOUSE : CONCRETE;
    if (!inScope) style = FOGGED;

    const height = building.height;
    const seed = building.seed;

    return {
      z: depth(u, v, height),
      draw: (ctx: CanvasRenderingContext2D) => {
        drawShadow(ctx, u, v, 0.7);
        drawBuilding(ctx, u, v, height, style, seed, inScope);
      },
    };
  });
}

/** Each connected district's landmark: taller, its own colour, a plinth. */
function landmarkItems(state: SceneState): Drawable[] {
  const items: Drawable[] = [];
  const granted = state.granted.length > 0;

  for (const plot of DISTRICT_PLOTS) {
    if (!state.online.includes(plot.id)) continue;

    const { u, v } = plot.landmark;
    const inScope = !granted || isInScope(plot.landmark, state.granted);
    const style = inScope ? landmarkStyle(plot.id) : FOGGED;
    const height = plot.landmarkHeight;
    const gated = state.gates.includes(plot.id);
    const seed = hash(plot.id);

    items.push({
      z: depth(u, v, height + 1),
      draw: (ctx) => {
        drawShadow(ctx, u, v, 1.1);
        drawBuilding(ctx, u, v, height, style, seed, inScope);

        if (gated) {
          // A mast on the roof while this district is holding a gate.
          const top = toScreen(u, v, height);
          ctx.fillStyle = "#3a424c";
          ctx.fillRect(top.x - 1, top.y - 30, 2, 30);
          ctx.fillStyle = UI.danger;
          ctx.fillRect(top.x - 7, top.y - 32, 14, 9);
        }
      },
    });
  }

  return items;
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

        ctx.strokeStyle = "rgba(12,18,26,0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - 6.5, p.y - 22.5, 13, 23);
      },
    };
  });
}

function drawScopeWall(ctx: CanvasRenderingContext2D, state: SceneState, time: number): void {
  if (state.scopeState === "none" || state.granted.length === 0) return;

  // A slow breath on the glow only, so the boundary feels live without the
  // line itself moving.
  const pulse = 0.16 + Math.sin(time / 700) * 0.06;

  drawPerimeter(
    ctx,
    perimeterOf(state.granted),
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
