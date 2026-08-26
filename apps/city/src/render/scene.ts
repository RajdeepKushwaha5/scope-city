import { TILE_H, TILE_W, UNIT_H, blockBounds, depth, toScreen } from "../iso/projection.js";
import {
  AGENT,
  COAST,
  CONCRETE,
  FOGGED,
  GROUND,
  HOUSE,
  UI,
  TRAFFIC_COLOURS,
  landmarkStyle,
  type BuildingStyleSet,
} from "./palette.js";
import {
  drawBuilding,
  drawBoat,
  drawBillboard,
  drawCivicDome,
  drawContainerStack,
  drawControlTower,
  drawCrane,
  drawFountain,
  drawHangar,
  drawLamp,
  drawLighthouse,
  drawPerimeter,
  drawPlane,
  drawPier,
  drawRunway,
  drawShadow,
  drawShip,
  drawTree,
  drawVehicle,
} from "./shapes.js";
import { drawBuildingMarker, drawSelection, type BuildingMarker } from "./shapes.js";
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
  OCEAN_MARGIN,
  fountainCells,
  hash,
  isInScope,
  layOutCity,
  perimeterOf,
  plotFor,
  roadConnections,
  tileKindAt,
  treeCells,
  type Building,
} from "./world.js";
import { planActivityRoutes, segmentActivityRoute } from "./activity-routes.js";

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
  /**
   * What this thread was spawned to do, when the harness said.
   *
   * TrueForge titles the child threads it creates, and for this mission those
   * titles come back as "Source investigator" and "Target verifier" -- the two
   * assignments the brief describes. Dropping them left five identical tokens
   * standing in a row, which looks like decoration. Showing them is the
   * difference between claiming the delegation is real and letting someone read
   * it off the map.
   *
   * Absent for the root agent, and for any thread the harness did not name.
   */
  readonly title?: string | null;
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
  /**
   * Per-building state, keyed by office.
   *
   * Passed in rather than derived here: the scene renders, it does not decide
   * what a building means, and a second derivation would drift from the one the
   * inspector reads.
   */
  readonly buildings?: ReadonlyMap<string, { authority: string; activity: string }>;
  /** The office the operator has selected, if any. */
  readonly selected?: string | null;
  /** The office under the pointer. Kept separate from locked selection. */
  readonly hovered?: string | null;
  /** Animation phase, 0..1, for the states that pulse. */
  readonly phase?: number;
  /**
   * The office being considered but not granted, and the districts it would
   * bring inside the limits.
   *
   * Drawn as a hypothetical rather than folded into `granted`, because the
   * whole value of a counterfactual is that it is visibly *not* the scope. An
   * operator who cannot tell the preview from the grant has been shown
   * authority they did not give.
   */
  readonly counterfactual?: {
    readonly office: string;
    readonly districts: readonly string[];
  } | null;
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

/**
 * The laid-out city for a set of offices, memoised.
 *
 * Exported so the interaction layer can pick against the same buildings the
 * renderer drew. Laying out a second copy for hit-testing would work until the
 * two disagreed, and then the operator would be clicking one city and reading
 * about another.
 */
export function cityFor(offices: readonly { office: string; district: string }[]): {
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
  // The pulse phase is derived from the frame clock rather than passed in, so a
  // caller cannot forget it and leave every beacon frozen. Roughly a
  // second-and-a-half cycle: slow enough to read as breathing rather than
  // blinking, which matters because the only pulsing state is the one asking a
  // person for a decision.
  const framed: SceneState = { ...state, phase: (time % 1500) / 1500 };

  ctx.save();
  ctx.fillStyle = UI.sky;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.translate(size.width / 2 + camera.x, size.height / 2 + camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.imageSmoothingEnabled = false;

  const { buildings, trees, fountains } = cityFor(framed.offices);

  const items: Drawable[] = [
    ...groundItems(framed),
    ...facilityItems(time),
    ...fountainItems(fountains, state),
    ...treeItems(trees, state),
    ...activityRouteItems(buildings, state, time),
    ...buildingItems(buildings, state),
    ...landmarkItems(framed),
    ...trafficItems(framed, time),
    ...maritimeItems(time),
    ...figureItems(framed),
  ];

  items.sort((a, b) => a.z - b.z);
  for (const item of items) item.draw(ctx);

  drawScopeWall(ctx, framed, time);
  // After the real boundary, so a hypothetical annexation reads as something
  // laid over the scope rather than part of it.
  drawCounterfactual(ctx, framed, time);
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

  for (let u = -OCEAN_MARGIN; u <= ISLAND_W + OCEAN_MARGIN; u += 1) {
    for (let v = -OCEAN_MARGIN; v <= ISLAND_H + OCEAN_MARGIN; v += 1) {
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
        draw: (ctx) => {
          drawDitheredTile(ctx, cu, cv, material, blend, amount, variant);
          if (kind === "water" && hash(`wave:${cu}:${cv}`) % 13 === 0) {
            const p = toScreen(cu, cv, 0.01);
            ctx.fillStyle = COAST.wave;
            ctx.fillRect(p.x - 7, p.y, 12, 1);
          }
        },
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

/** Airport, commercial port and naval quay: visible destinations, not decoration. */
function facilityItems(time: number): Drawable[] {
  const items: Drawable[] = [];

  for (let u = 3; u <= 13; u += 1) {
    const cu = u;
    items.push({
      z: depth(cu, 31, -0.4),
      draw: (ctx) => drawRunway(ctx, cu, 31, "u", cu === 3 || cu === 13),
    });
  }
  items.push(
    { z: depth(5, 28, 2), draw: (ctx) => drawHangar(ctx, 5, 28, COAST.hangarRoofAirport) },
    { z: depth(10, 28, 3), draw: (ctx) => drawControlTower(ctx, 10, 28) },
    { z: depth(8.5, 31, 2), draw: (ctx) => drawPlane(ctx, 8.5, 31) },
    { z: depth(4, 25, 3), draw: (ctx) => drawBillboard(ctx, 4, 25, "Scope City", "Authority has borders") },
  );

  for (let u = 28; u <= 37; u += 1) {
    const cu = u;
    items.push({ z: depth(cu, 32, -0.2), draw: (ctx) => drawPier(ctx, cu, 32) });
  }
  for (const [u, v, seed] of [[29, 29, 1], [31, 29, 2], [33, 29, 3], [35, 29, 4]] as const) {
    items.push({ z: depth(u, v, 1), draw: (ctx) => drawContainerStack(ctx, u, v, seed) });
  }
  items.push(
    { z: depth(29, 31, 3), draw: (ctx) => drawCrane(ctx, 29, 31) },
    { z: depth(34, 31, 3), draw: (ctx) => drawCrane(ctx, 34, 31) },
    { z: depth(37.5, 31, 4), draw: (ctx) => drawLighthouse(ctx, 37.5, 31, time) },
    { z: depth(35, 27, 3), draw: (ctx) => drawBillboard(ctx, 35, 27, "TrueForge", "Mission control") },
  );

  for (let v = 18; v <= 25; v += 1) {
    const cv = v;
    items.push({ z: depth(39, cv, -0.2), draw: (ctx) => drawPier(ctx, 39, cv) });
  }
  items.push(
    { z: depth(34.5, 34.5, 4), draw: (ctx) => drawShip(ctx, 34.5, 34.5, "u", "cargo") },
    { z: depth(41.5, 22, 4), draw: (ctx) => drawShip(ctx, 41.5, 22, "v", "navy") },
  );
  return items;
}

const BOAT_ROUTES = [
  { axis: "u", fixed: -5, min: -7, max: 35, speed: 0.11, offset: 0.15, colour: TRAFFIC_COLOURS.amber, sail: true },
  { axis: "v", fixed: 45, min: -4, max: 39, speed: 0.08, offset: 0.62, colour: TRAFFIC_COLOURS.red, sail: true },
  { axis: "u", fixed: 40, min: 4, max: 47, speed: 0.13, offset: 0.41, colour: TRAFFIC_COLOURS.ivory, sail: false },
  { axis: "v", fixed: -6, min: 0, max: 34, speed: 0.09, offset: 0.82, colour: TRAFFIC_COLOURS.gold, sail: true },
  { axis: "u", fixed: 44, min: 8, max: 45, speed: 0.07, offset: 0.05, colour: TRAFFIC_COLOURS.sky, sail: false },
] as const;

function maritimeItems(time: number): Drawable[] {
  return BOAT_ROUTES.map((route) => {
    const span = route.max - route.min;
    const moving = route.min + (((time / 1000) * route.speed + route.offset) % 1) * span;
    const u = route.axis === "u" ? moving : route.fixed;
    const v = route.axis === "v" ? moving : route.fixed;
    return {
      z: depth(u, v, 2),
      draw: (ctx: CanvasRenderingContext2D) => drawBoat(ctx, u, v, route.axis, route.colour, route.sail),
    };
  });
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

/**
 * Which marker a building's state earns.
 *
 * Activity wins over authority when something is happening, because an operator
 * scanning the city is looking for what needs them now -- a gated office that
 * is actually waiting should not read the same as one merely capable of
 * waiting. When nothing is happening, authority shows instead, so the map still
 * says which offices would stop for a countersign.
 */
function markerFor(runtime: { authority: string; activity: string }): BuildingMarker {
  if (runtime.activity === "waiting") return "waiting";
  if (runtime.activity === "refused") return "refused";
  if (runtime.activity === "working") return "working";
  if (runtime.activity === "done") return "done";
  if (runtime.authority === "gated") return "gated";
  if (runtime.authority === "proposed") return "proposed";
  return "none";
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

        // Markers are drawn after the sprite and never baked into it. They
        // pulse, and the sprite cache is keyed by appearance, so baking a phase
        // would mean a cache entry per frame.
        if (building.office) {
          const runtime = state.buildings?.get(building.office);
          if (runtime) {
            drawBuildingMarker(ctx, u, v, height, markerFor(runtime), state.phase ?? 0);
          }
          if (state.selected === building.office) drawSelection(ctx, u, v, height);
          else if (state.hovered === building.office) {
            ctx.save();
            ctx.globalAlpha = 0.62;
            drawSelection(ctx, u, v, height);
            ctx.restore();
          }
        }
      },
    };
  });
}

/**
 * A live tool call is traffic with a destination, not background decoration.
 * The route joins the district landmark to the exact office building whose
 * state says it is working or waiting; recorded and live missions therefore
 * animate through the same path without timers authored for a demo.
 */
function activityRouteItems(
  buildings: readonly Building[],
  state: SceneState,
  time: number,
): Drawable[] {
  const items: Drawable[] = [];
  for (const route of planActivityRoutes(buildings, state.buildings)) {
    const { activity, from, to } = route;
    const progress = activity === "refused" ? 0.48 : (time / 1350) % 1;
    const u = from.u + (to.u - from.u) * progress;
    const v = from.v + (to.v - from.v) * progress;
    const colour =
      activity === "waiting"
        ? TRAFFIC_COLOURS.amber
        : activity === "refused"
          ? TRAFFIC_COLOURS.red
          : TRAFFIC_COLOURS.sky;

    for (const segment of segmentActivityRoute(route)) {
      const midpoint = {
        u: (segment.from.u + segment.to.u) / 2,
        v: (segment.from.v + segment.to.v) / 2,
      };
      items.push({
        z: depth(midpoint.u, midpoint.v, 0.02),
        draw: (ctx) => {
          const a = toScreen(segment.from.u, segment.from.v, 0.02);
          const b = toScreen(segment.to.u, segment.to.v, 0.02);
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = colour;
          ctx.globalAlpha = 0.52;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        },
      });
    }
    items.push({
      z: depth(u, v, 0.5),
      draw: (ctx) =>
        drawVehicle(
          ctx,
          u,
          v,
          Math.abs(to.u - from.u) >= Math.abs(to.v - from.v) ? "u" : "v",
          colour,
          false,
        ),
    });
  }
  return items;
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
  { axis: "u", road: 6, lane: -0.16, speed: 1.2, offset: 0.04, colour: TRAFFIC_COLOURS.red },
  { axis: "u", road: 12, lane: 0.16, speed: 0.86, offset: 0.43, colour: TRAFFIC_COLOURS.amber },
  { axis: "u", road: 18, lane: -0.16, speed: 1.05, offset: 0.71, colour: TRAFFIC_COLOURS.blue },
  { axis: "u", road: 24, lane: 0.16, speed: 0.95, offset: 0.21, colour: TRAFFIC_COLOURS.ivory },
  { axis: "u", road: 30, lane: -0.16, speed: 1.15, offset: 0.58, colour: TRAFFIC_COLOURS.green },
  { axis: "v", road: 6, lane: 0.16, speed: 0.92, offset: 0.14, colour: TRAFFIC_COLOURS.pale },
  { axis: "v", road: 12, lane: -0.16, speed: 1.08, offset: 0.52, colour: TRAFFIC_COLOURS.brick },
  { axis: "v", road: 18, lane: 0.16, speed: 0.82, offset: 0.82, colour: TRAFFIC_COLOURS.gold },
  { axis: "v", road: 24, lane: -0.16, speed: 1.18, offset: 0.32, colour: TRAFFIC_COLOURS.sky },
  { axis: "v", road: 30, lane: 0.16, speed: 0.98, offset: 0.64, colour: TRAFFIC_COLOURS.leaf },
  { axis: "v", road: 36, lane: -0.16, speed: 0.76, offset: 0.08, colour: TRAFFIC_COLOURS.cream },
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
    const { u, v, kind, title } = figure;
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

        // Only named threads carry a label. Writing "agent" over the root
        // figure would add a word without adding a fact.
        if (kind === "team" && title) {
          ctx.font = "10px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";

          const width = ctx.measureText(title).width;
          ctx.fillStyle = UI.outline;
          ctx.fillRect(p.x - width / 2 - 3, p.y - 36, width + 6, 12);

          ctx.fillStyle = AGENT.team;
          ctx.fillText(title, p.x, p.y - 27);
          ctx.textAlign = "left";
        }
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

/**
 * The city as it would be, drawn over the city as it is.
 *
 * Permissions have always been a JSON diff nobody reads. Drawing the annexation
 * is the one interaction that turns the map from a picture of a decision into
 * the instrument for making it: granting `customer.list` visibly takes in a
 * district, and the operator sees the cost before agreeing to it rather than
 * reading a number that says so.
 *
 * Deliberately distinguishable from the real boundary at a glance. The granted
 * limits are a solid amber line; this is a dashed red one over a translucent
 * wash, so no still frame of the demo can be mistaken for authority that was
 * actually handed over.
 */
function drawCounterfactual(
  ctx: CanvasRenderingContext2D,
  state: SceneState,
  time: number,
): void {
  const preview = state.counterfactual;
  if (!preview) return;

  // Only the districts the addition would newly reach. Redrawing the whole
  // proposed boundary would say "all of this is hypothetical" when most of it
  // is exactly what the operator is already being asked to grant.
  const granted = new Set(state.scopeState === "proposed" ? state.proposed : state.granted);
  const annexed = preview.districts.filter((d) => !granted.has(d));
  if (annexed.length === 0) return;

  const pulse = 0.1 + Math.sin(time / 500) * 0.05;

  ctx.save();
  for (const district of annexed) {
    const plot = plotFor(district);
    if (!plot) continue;

    // A wash over the annexed ground, so the eye lands on the area rather than
    // hunting for a line.
    ctx.fillStyle = `rgba(224, 90, 74, ${pulse.toFixed(3)})`;
    for (let u = plot.u0; u <= plot.u1; u += 1) {
      for (let v = plot.v0; v <= plot.v1; v += 1) {
        const c = toScreen(u, v, 0);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - TILE_H / 2);
        ctx.lineTo(c.x + TILE_W / 2, c.y);
        ctx.lineTo(c.x, c.y + TILE_H / 2);
        ctx.lineTo(c.x - TILE_W / 2, c.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();

  drawPerimeter(
    ctx,
    perimeterOf(annexed),
    "rgba(224, 90, 74, 0.9)",
    `rgba(224, 90, 74, ${(pulse * 1.4).toFixed(3)})`,
    // Dashed, always. The granted boundary is solid, and the difference has to
    // survive a screenshot.
    true,
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
  // Frame the beach plus a useful belt of water; the larger ocean margin is
  // still available when the operator pans.
  const bounds = blockBounds(-5, -5, ISLAND_W + 5, ISLAND_H + 5);
  const worldW = bounds.max.x - bounds.min.x;
  const worldH = bounds.max.y - bounds.min.y;

  const zoom = Math.min(size.width / worldW, size.height / worldH) * 0.95;
  const centre = toScreen(ISLAND_W / 2, ISLAND_H / 2, 0);

  return { x: -centre.x * zoom, y: -centre.y * zoom, zoom };
}
