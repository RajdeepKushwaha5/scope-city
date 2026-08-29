import { TILE_H, TILE_W, UNIT_H, blockBounds, depth, toScreen } from "../iso/projection.js";
import {
  AGENT,
  COAST,
  CONCRETE,
  FOGGED,
  GROUND,
  HOUSE,
  HOVERED,
  SELECTED,
  UI,
  TRAFFIC_COLOURS,
  landmarkStyle,
  type BuildingStyleSet,
} from "./palette.js";
import {
  drawBuilding,
  drawBoat,
  drawApronMarking,
  drawBillboard,
  drawBollards,
  drawFacilitySign,
  drawFence,
  drawFlag,
  drawFloodlight,
  drawFuelTank,
  drawQuayHut,
  drawTerminal,
  drawWindsock,
  drawClouds,
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
  drawRadar,
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
  HOARDINGS,
  hash,
  FACILITIES,
  type FacilityName,
  ROAD_EVERY,
  isApron,
  isHoardingCell,
  apronEdges,
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
import { hasWave, isShallow, isShoal, waterVariant } from "./sea.js";

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
  /**
   * The cell the operator has selected, if any.
   *
   * A cell rather than an office name, because nine of the city's two hundred
   * and forty structures have an office and the other two hundred and thirty
   * were unselectable for want of a key to hold them by. A cell is the one
   * identity every building has.
   */
  readonly selected?: { readonly u: number; readonly v: number } | null;
  /** The cell under the pointer. Kept separate from locked selection. */
  readonly hovered?: { readonly u: number; readonly v: number } | null;
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

  /*
   * The ground is its own layer, drawn before anything that stands on it.
   *
   * It used to be one list. Depth is `(u + v) * 1000 + height`, so height only
   * separates things sharing a diagonal -- and a car is at a fractional
   * position between two of them. A car at (14.37, 24.16) sorts at 38530; the
   * road tile at (15, 24) sorts at 38999 and is therefore painted afterwards,
   * over the half of the car that had crossed into it. Cars vanished from the
   * front as they drove, which is what this looked like.
   *
   * A tile could not have been in front of a car standing on it, so the fix is
   * not a bigger number: flat ground never occludes what is on top of it. The
   * tiles still sort among themselves, because a recessed road's kerb does
   * overlap its neighbour.
   */
  const ground = groundItems(framed);
  ground.sort((a, b) => a.z - b.z);
  for (const item of ground) item.draw(ctx);

  // On the sea, after the sea. Drawing them before the ground -- the obvious
  // way to keep clouds off the land -- put them under opaque water tiles, so
  // the only ones visible were past the edge of the drawn ocean, in the corners
  // of the screen. They are clipped to outside the island's own outline
  // instead, and are inside the camera transform so they pan with the map.
  drawClouds(ctx, time, [
    toScreen(0, 0),
    toScreen(ISLAND_W, 0),
    toScreen(ISLAND_W, ISLAND_H),
    toScreen(0, ISLAND_H),
  ]);

  const items: Drawable[] = [
    ...facilityItems(framed, time),
    ...hoardingItems(framed),
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

      // Grass dithers into sand so that boundary is not a hard line.
      //
      // Sand no longer dithers into water. It used to, and it was the only
      // transition this map had at the shore; the banks offshore do that job
      // now, at whole-tile scale, and leaving both in put a fine checkerboard
      // underneath a coarse one. Two overlapping dithers read as static.
      let blend = null;
      let amount = 0;
      let paint = material;
      let variant = 0;

      // Hardstanding first, because it overrides what the tile would otherwise
      // be. A hangar with grass running up to its doors is a model sitting on a
      // map; the same hangar on asphalt is an airfield, and that one change
      // does more for all three facilities than any prop standing on them.
      const apron = isApron(cu, cv);
      if (apron) {
        paint = state.scopeState === "none" || inScope ? GROUND.apron! : GROUND.fogged!;
        variant = hash(`apron:${cu}:${cv}`) % 3;
      } else if (kind === "grass") {
        amount = blendAmount(cu, cv, isGrass, isSand);
        blend = state.scopeState === "none" || inScope ? GROUND.sand! : GROUND.fogged!;
        variant = hash(`${cu}:${cv}`) % 3;
      } else if (kind === "water") {
        // Three shades per cell, so the sea has tile edges. Without them a
        // plane of identical diamonds reads as the paper the island is printed
        // on rather than as something the island sits in.
        variant = waterVariant(cu, cv);
        paint = isShallow(cu, cv) ? GROUND.waterShallow! : GROUND.water!;

        // A sandbank surfacing. Whole tiles, because at this scale that is what
        // a bank is, and because the whole look is flat tiles in a small
        // palette -- the alternative was a soft falloff, and it would have been
        // the one soft edge on the map.
        if (isShoal(cu, cv)) paint = GROUND.sand!;
      }

      const wave = kind === "water" && !isShoal(cu, cv) && hasWave(cu, cv);
      const faces = apron ? apronEdges(cu, cv) : [];
      // The line follows the ground it is painted on. Bright yellow over fogged
      // apron was the one marking on the map claiming "reachable" about
      // somewhere that was not.
      const apronFogged = apron && state.scopeState !== "none" && !inScope;
      items.push({
        z: depth(cu, cv, -1),
        draw: (ctx) => {
          drawDitheredTile(ctx, cu, cv, paint, blend, amount, variant);
          if (faces.length > 0) drawApronMarking(ctx, cu, cv, faces, apronFogged);
          if (wave) {
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
      // Buildings, trees and fountains all consult this; the lamps did not.
      // `hash("lamp:4:23") % 11` is zero, so a streetlamp stood on the Scope
      // City board's cell -- drawn first, painted over, and reported by
      // nothing. A reservation that three of four generators honour is not a
      // reservation.
      if (isHoardingCell(u, v)) continue;
      if (hash(`lamp:${u}:${v}`) % 11 !== 0) continue;
      const cu = u;
      const cv = v;
      items.push({ z: depth(cu, cv, 1), draw: (ctx) => drawLamp(ctx, cu, cv) });
    }
  }

  return items;
}

/**
 * The hoardings, drawn from the same table that reserves their ground.
 *
 * They were two literals inside the airport and the port, which is why nothing
 * stopped a street tree growing through one: the drawing knew where they stood
 * and the layout did not.
 */
function hoardingItems(state: SceneState): Drawable[] {
  return HOARDINGS.map((board) => {
    // Dimmed with the ground it stands on, like the trees and the fountains.
    // A lit, readable board over fogged terrain is a piece of the map claiming
    // to be reachable when it is not -- which is a small thing here and the
    // whole argument everywhere else in this project.
    const muted =
      state.scopeState !== "none" && !isInScope(board.cell, state.granted);
    return {
      z: depth(board.cell.u, board.cell.v, 3),
      draw: (ctx: CanvasRenderingContext2D) => {
        if (muted) {
          ctx.save();
          ctx.globalAlpha = 0.4;
        }
        drawBillboard(ctx, board.cell.u, board.cell.v, board.title, board.subtitle, board.accent);
        if (muted) ctx.restore();
      },
    };
  });
}

/** Airport, commercial port and naval quay: visible destinations, not decoration. */
/**
 * One thing standing at one of the coastal facilities.
 *
 * A table rather than a run of `items.push` calls, because a test cannot check
 * what it cannot enumerate. The previous version of the "every prop is on its
 * own apron" test matched direct calls with integer coordinates out of the
 * source, which quietly excluded every prop generated in a loop -- the runway
 * segments, the container stacks and the bollards along both quays -- so
 * moving any of those into the water would have left it green.
 *
 * `ground` is the honest part. Most of these stand on hard standing and must;
 * the ships, the lighthouse and the aircraft on the runway threshold do not,
 * and saying which is which here is what lets the test be exhaustive instead of
 * selective.
 */
interface FacilityProp {
  readonly facility: FacilityName;
  readonly u: number;
  readonly v: number;
  readonly h: number;
  /**
   * What it stands on, and the reason this field exists at all.
   *
   * `apron` must be on its facility's own hard standing, and that is what the
   * test enforces. `water` is afloat or offshore on purpose -- the two ships,
   * the lighthouse on the point. `over` is laid across whatever is beneath it:
   * the runway crosses the street grid, which is what a runway does, and
   * asserting it were on apron would make the test wrong rather than the
   * placement.
   */
  readonly ground: "apron" | "water" | "over";
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
}

/** Everything at the three facilities, in one enumerable list. */
export function facilityProps(time: number): FacilityProp[] {
  const props: FacilityProp[] = [];
  const at = (
    facility: FacilityName,
    u: number,
    v: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
    ground: "apron" | "water" | "over" = "apron",
  ) => props.push({ facility, u, v, h, ground, draw });

  // --- the airfield ----------------------------------------------------
  for (let u = 3; u <= 13; u += 1) {
    // Laid across the street grid, which is what a runway is.
    at("airport", u, 31, -0.4, (ctx) => drawRunway(ctx, u, 31, "u", u === 3 || u === 13), "over");
  }
  at("airport", 5, 28, 2, (ctx) => drawHangar(ctx, 5, 28, COAST.hangarRoofAirport));
  at("airport", 10, 28, 3, (ctx) => drawControlTower(ctx, 10, 28));
  // Between two runway cells, so it belongs to neither of them.
  at("airport", 8.5, 31, 2, (ctx) => drawPlane(ctx, 8.5, 31), "over");
  // A hangar, a tower and an aeroplane is a maintenance base: there was nowhere
  // for anybody to get on. The terminal is the building that makes it an
  // airport, and the windsock is what makes the strip a runway rather than a
  // black rectangle with stripes on it.
  at("airport", 7, 28, 3, (ctx) => drawTerminal(ctx, 7, 28));
  at("airport", 13, 29, 4, (ctx) => drawWindsock(ctx, 13, 29));
  at("airport", 4, 29, 3, (ctx) => drawFacilitySign(ctx, 4, 29, "Airfield"));
  at("airport", 11, 31, 4, (ctx) => drawFloodlight(ctx, 11, 31));

  // --- the container port ----------------------------------------------
  // Not on the two cells where a street meets the quay. The row crosses the
  // road grid at u=30 and u=36, and the test caught a bollard standing in the
  // middle of each of them -- the same gate the naval yard's fence leaves.
  for (let u = 28; u <= 37; u += 1) {
    if (u % ROAD_EVERY === 0) continue;
    at("port", u, 32, 0.4, (ctx) => drawBollards(ctx, u, 32, "+v"));
  }
  for (const [u, v, seed] of [
    [29, 29, 1],
    [31, 29, 2],
    [33, 29, 3],
    [35, 29, 4],
    [28, 31, 5],
    [32, 28, 6],
  ] as const) {
    at("port", u, v, 1, (ctx) => drawContainerStack(ctx, u, v, seed));
  }
  at("port", 29, 31, 3, (ctx) => drawCrane(ctx, 29, 31));
  at("port", 34, 31, 3, (ctx) => drawCrane(ctx, 34, 31));
  // On the point at the end of the quay -- which is the port's own ground, so
  // it is checked like everything else standing on it. It was declared `water`
  // and the review pointed out that made it exempt from a check it passes.
  at("port", 37.5, 31, 4, (ctx) => drawLighthouse(ctx, 37.5, 31, time));
  // The things that make a quay a port rather than a building site: somewhere
  // to work from, something to work by, and a name on the gate.
  at("port", 27, 28, 2, (ctx) => drawQuayHut(ctx, 27, 28));
  at("port", 34, 28, 3, (ctx) => drawFacilitySign(ctx, 34, 28, "Port"));
  at("port", 31, 31, 4, (ctx) => drawFloodlight(ctx, 31, 31));
  at("port", 35, 31, 4, (ctx) => drawFloodlight(ctx, 35, 31));
  at("port", 34.5, 34.5, 4, (ctx) => drawShip(ctx, 34.5, 34.5, "u", "cargo"), "water");

  // --- the naval yard ---------------------------------------------------
  const yard = FACILITIES.naval;

  // The fence runs the landward edges only. A base is a fence with a gate in
  // it; fencing the quay as well would wall the ship off from its own jetty,
  // and the gaps on the road grid are where the service road goes through.
  for (let v = yard.v0; v <= yard.v1; v += 1) {
    if (v % ROAD_EVERY === 0) continue;
    at("naval", yard.u0, v, 1, (ctx) => drawFence(ctx, yard.u0, v, "-u"));
  }
  for (let u = yard.u0; u <= yard.u1; u += 1) {
    if (u % ROAD_EVERY === 0) continue;
    at("naval", u, yard.v0, 1, (ctx) => drawFence(ctx, u, yard.v0, "-v"));
  }

  for (let v = 18; v <= 25; v += 1) {
    if (v % ROAD_EVERY === 0) continue;
    at("naval", 39, v, 0.4, (ctx) => drawBollards(ctx, 39, v, "+u"));
  }

  // The yard is crossed by three streets -- u=36, v=18 and v=24 are all on the
  // road grid -- and the first placement put the guardroom and both fuel tanks
  // in the middle of them.
  at("naval", 35, 19, 2, (ctx) => drawQuayHut(ctx, 35, 19));
  at("naval", 35, 22, 3, (ctx) => drawFuelTank(ctx, 35, 22));
  at("naval", 35, 23, 3, (ctx) => drawFuelTank(ctx, 35, 23));
  // Where a shore establishment's air search set would be, and the one thing on
  // this map that rotates.
  at("naval", 37, 20, 4, (ctx) => drawRadar(ctx, 37, 20, time));
  at("naval", 38, 19, 4, (ctx) => drawFloodlight(ctx, 38, 19));
  at("naval", 38, 23, 4, (ctx) => drawFloodlight(ctx, 38, 23));
  at("naval", 35, 17, 4, (ctx) => drawFlag(ctx, 35, 17));
  at("naval", 37, 25, 4, (ctx) => drawFlag(ctx, 37, 25));
  at("naval", 41.5, 22, 4, (ctx) => drawShip(ctx, 41.5, 22, "v", "navy"), "water");

  return props;
}

function facilityItems(state: SceneState, time: number): Drawable[] {
  /*
   * Props dim with the ground they stand on, as the naval yard's do.
   *
   * The review made this point about the yard and it applies here for the same
   * reason: a terminal, a crane or a nameplate that stays lit over fogged apron
   * is a piece of the map claiming reach the scope has not granted.
   */
  const items: Drawable[] = facilityProps(time).map((prop) => ({
    z: depth(prop.u, prop.v, prop.h),
    draw: (ctx: CanvasRenderingContext2D) => {
      const lit =
        state.scopeState === "none" || isInScope({ u: prop.u, v: prop.v }, state.granted);
      if (lit) {
        prop.draw(ctx);
        return;
      }
      ctx.save();
      ctx.globalAlpha = 0.4;
      prop.draw(ctx);
      ctx.restore();
    },
  }));

  return items;
}

/**
 * The naval yard, as an establishment rather than a berth.
 *
 * It was two things: a line of piers and a warship. Everything that says
 * "shore establishment" -- the fence, the fuel farm, the floodlights, the
 * guardroom -- was missing, so the most distinctive corner of the island read
 * as a grey rectangle with a boat parked at it.
 *
 * Laid out along the quay: stores and fuel inboard, the radar and the lights on
 * the apron, the fence closing the landward side. The berth itself stays clear,
 * because that is where the ship is.
 */


/**
 * Boats, and how slowly they go.
 *
 * There were five, on five straight lines at the very edge of the drawn ocean,
 * each crossing the whole map in about nine seconds. Two things were wrong with
 * that. Nine seconds for forty cells is roughly a hundred knots, so they read as
 * skimming rather than sailing -- and because every route hugged the margin,
 * the water between the margin and the island was always empty.
 *
 * Nine now, at four to six times slower, spread across four distances from the
 * shore. A traverse takes between one and two minutes, which is slow enough
 * that a boat looks becalmed in a screenshot and has plainly moved by the time
 * you look again -- and that is the right speed for something whose only job is
 * to keep the sea from looking painted on.
 *
 * `fixed` is the lane's distance out; the spread of them is what stops the
 * boats forming a ring. `offset` is where in its lane a boat starts, so they do
 * not set off in formation on the first frame.
 */
const BOAT_ROUTES = [
  { axis: "u", fixed: -3, min: -8, max: 44, speed: 0.014, offset: 0.15, colour: TRAFFIC_COLOURS.amber, sail: true },
  { axis: "u", fixed: -8, min: -8, max: 44, speed: 0.009, offset: 0.62, colour: TRAFFIC_COLOURS.cream, sail: true },
  { axis: "u", fixed: 38, min: -6, max: 46, speed: 0.011, offset: 0.41, colour: TRAFFIC_COLOURS.ivory, sail: true },
  { axis: "u", fixed: 43, min: -6, max: 46, speed: 0.008, offset: 0.88, colour: TRAFFIC_COLOURS.sky, sail: false },
  { axis: "v", fixed: -4, min: -8, max: 40, speed: 0.013, offset: 0.32, colour: TRAFFIC_COLOURS.red, sail: true },
  { axis: "v", fixed: -9, min: -8, max: 40, speed: 0.010, offset: 0.71, colour: TRAFFIC_COLOURS.gold, sail: true },
  { axis: "v", fixed: 44, min: -6, max: 42, speed: 0.012, offset: 0.05, colour: TRAFFIC_COLOURS.pale, sail: true },
  { axis: "v", fixed: 49, min: -6, max: 42, speed: 0.007, offset: 0.54, colour: TRAFFIC_COLOURS.leaf, sail: false },
  { axis: "u", fixed: 48, min: -6, max: 46, speed: 0.009, offset: 0.24, colour: TRAFFIC_COLOURS.brick, sail: true },
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

/** Cell equality, since the pointer state and the layout hold separate objects. */
function same(
  a: { readonly u: number; readonly v: number },
  b: { readonly u: number; readonly v: number },
): boolean {
  return a.u === b.u && a.v === b.v;
}

function buildingItems(buildings: readonly Building[], state: SceneState): Drawable[] {
  return buildings.map((building) => {
    const { u, v } = building.cell;
    const inScope = isInScope(building.cell, state.granted);

    let style: BuildingStyleSet = building.kind === "house" ? HOUSE : CONCRETE;
    if (state.scopeState !== "none" && !inScope) style = FOGGED;

    // Pointer state paints the body, and it wins over the fog. An operator who
    // clicks a fogged building is asking what it is; answering by leaving it
    // the same grey as its two hundred neighbours answers nothing. The fog is
    // still the truth about it, and the inspector beside it says so in words.
    const picked = state.selected !== null && state.selected !== undefined && same(state.selected, building.cell);
    const under =
      !picked && state.hovered !== null && state.hovered !== undefined && same(state.hovered, building.cell);
    if (picked) style = SELECTED;
    else if (under) style = HOVERED;

    const height = building.height;
    const seed = building.seed % 105;
    const lit = state.scopeState === "none" || inScope || picked || under;
    const styleName = picked
      ? "picked"
      : under
        ? "under"
        : style === FOGGED
          ? "fog"
          : building.kind === "house"
            ? "house"
            : "concrete";

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
        }

        // Outside the office branch, because the outline is about the pointer
        // and the pointer can be anywhere. It was nested under `building.office`
        // and so could never appear on the rest of the city.
        if (picked) drawSelection(ctx, u, v, height);
        else if (under) {
          ctx.save();
          ctx.globalAlpha = 0.62;
          drawSelection(ctx, u, v, height);
          ctx.restore();
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

/**
 * The longest thread title a figure may carry, in characters.
 *
 * The two the harness actually produces are "Source investigator" and "Target
 * verifier", so this fits both without truncating either. It exists for what a
 * harness might send tomorrow, not for what it sends today.
 */
const MAX_LABEL = 22;

/** A thread title cut to something a figure can carry, with the cut shown. */
export function labelFor(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();

  // Counted and cut by code point, not by UTF-16 unit.
  //
  // `slice` on a string containing anything outside the BMP -- an emoji in a
  // thread title, say -- can cut a surrogate pair in half and produce a
  // replacement glyph, which is a worse label than the one being shortened.
  const points = [...clean];
  if (points.length <= MAX_LABEL) return clean;

  // The ellipsis is the point: a silently cut label reads as the harness having
  // sent a shorter name than it did.
  return `${points.slice(0, MAX_LABEL - 1).join("").trimEnd()}…`;
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
          // The harness chooses these strings and nothing bounds their length.
          // "Source investigator" fits; a sentence would paint a bar across the
          // city and bury whatever is behind it, and near the canvas edge it
          // would be clipped mid-word with no indication that it was cut. So
          // the label is truncated to something a figure can carry.
          //
          // Computed before any canvas state is touched. A title of nothing but
          // whitespace is truthy, so the guard above lets it through and the
          // bar was painted around an empty string -- a small blank plaque over
          // the city, attached to nothing. Bailing out after setting textAlign
          // would have left it "center" for every figure drawn after this one,
          // so the check has to come first.
          const text = labelFor(title);
          if (text !== "") {
            ctx.font = "10px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";

            const width = ctx.measureText(text).width;
            ctx.fillStyle = UI.outline;
            ctx.fillRect(p.x - width / 2 - 3, p.y - 36, width + 6, 12);

            ctx.fillStyle = AGENT.team;
            ctx.fillText(text, p.x, p.y - 27);
            ctx.textAlign = "left";
          }
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
