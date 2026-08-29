import type { Cell } from "../iso/projection.js";

/**
 * The city's layout.
 *
 * Hand-composed rather than generated, because there are six districts and not
 * two hundred. Six distinct silhouettes are legible at a glance and on video
 * where a field of identical towers is not.
 *
 * The island is a street grid: avenues every ROAD_EVERY cells in both axes,
 * with blocks between them. A district owns a rectangle of blocks; its
 * landmark takes the middle, and the offices it exposes fill the rest. Filler
 * buildings occupy whatever is left so the city looks inhabited rather than
 * like six objects on a lawn.
 */

export const ISLAND_W = 40;
export const ISLAND_H = 34;
/** Water rendered beyond the beach, large enough to pan without finding an edge. */
export const OCEAN_MARGIN = 10;

/**
 * Six-cell blocks leave a three-by-three buildable interior between pavement
 * rings. Four-cell blocks only left one cell and made the city look like a
 * sparse diagram no matter how many fillers the generator requested.
 */
export const ROAD_EVERY = 6;

export type TileKind = "grass" | "road" | "pavement" | "sand" | "water";

export interface DistrictPlot {
  readonly id: string;
  readonly title: string;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly landmark: Cell;
  readonly landmarkHeight: number;
}

export interface Building {
  readonly cell: Cell;
  readonly height: number;
  readonly seed: number;
  readonly kind: "office" | "filler" | "house";
  readonly district: string | null;
  readonly office: string | null;
}

export const DISTRICT_PLOTS: readonly DistrictPlot[] = [
  { id: "records", title: "Records", u0: 2, v0: 2, u1: 12, v1: 14, landmark: { u: 8, v: 8 }, landmarkHeight: 2.6 },
  { id: "exchequer", title: "The Exchequer", u0: 13, v0: 2, u1: 24, v1: 14, landmark: { u: 20, v: 8 }, landmarkHeight: 3.6 },
  { id: "archive", title: "The Archive", u0: 25, v0: 2, u1: 38, v1: 14, landmark: { u: 32, v: 8 }, landmarkHeight: 2.4 },
  { id: "post-house", title: "Post House", u0: 2, v0: 15, u1: 12, v1: 32, landmark: { u: 8, v: 20 }, landmarkHeight: 2.1 },
  { id: "yard", title: "The Yard", u0: 13, v0: 15, u1: 24, v1: 32, landmark: { u: 20, v: 20 }, landmarkHeight: 1.7 },
  { id: "gate", title: "The Gate", u0: 25, v0: 15, u1: 38, v1: 32, landmark: { u: 32, v: 20 }, landmarkHeight: 3.0 },
];

export function plotFor(district: string): DistrictPlot | undefined {
  return DISTRICT_PLOTS.find((p) => p.id === district);
}

/** Streets run along every ROAD_EVERY-th row and column. */
export function isRoad(u: number, v: number): boolean {
  return u % ROAD_EVERY === 0 || v % ROAD_EVERY === 0;
}

/** A cell touching a street becomes pavement, which gives blocks a kerb. */
export function isPavement(u: number, v: number): boolean {
  if (isRoad(u, v)) return false;
  return isRoad(u + 1, v) || isRoad(u - 1, v) || isRoad(u, v + 1) || isRoad(u, v - 1);
}

export function tileKindAt(u: number, v: number): TileKind {
  if (u < 0 || v < 0 || u > ISLAND_W || v > ISLAND_H) return "water";
  if (u < 2 || v < 2 || u > ISLAND_W - 2 || v > ISLAND_H - 2) return "sand";
  if (isRoad(u, v)) return "road";
  if (isPavement(u, v)) return "pavement";
  return "grass";
}

/**
 * Which of a road tile's four neighbours are also road.
 *
 * Bit order is north-east, south-east, south-west, north-west. Markings are
 * painted only along axes that continue, so a junction does not end up with a
 * centre line running into a kerb.
 */
export function roadConnections(u: number, v: number): number {
  let mask = 0;
  if (tileKindAt(u + 1, v) === "road") mask |= 0b0001;
  if (tileKindAt(u, v + 1) === "road") mask |= 0b0010;
  if (tileKindAt(u - 1, v) === "road") mask |= 0b0100;
  if (tileKindAt(u, v - 1) === "road") mask |= 0b1000;
  return mask;
}

export function districtAt(u: number, v: number): string | null {
  const plot = DISTRICT_PLOTS.find(
    (p) => u >= p.u0 && u <= p.u1 && v >= p.v0 && v <= p.v1,
  );
  return plot?.id ?? null;
}

/** Small deterministic hash, so the same cell always yields the same building. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function cellSeed(u: number, v: number): number {
  return hash(`${u}:${v}`);
}

function isLandmarkPlazaCell(u: number, v: number): boolean {
  return DISTRICT_PLOTS.some(
    (plot) => Math.abs(u - plot.landmark.u) + Math.abs(v - plot.landmark.v) <= 1,
  );
}

/** Coastal destinations reserve these cells from procedural buildings and trees. */
export function isFacilityCell(u: number, v: number): boolean {
  const airport = u >= 3 && u <= 13 && v >= 27 && v <= 32;
  const containerPort = u >= 27 && u <= 37 && v >= 28 && v <= 32;
  const navalYard = u >= 35 && u <= 39 && v >= 17 && v <= 25;
  return airport || containerPort || navalYard;
}

/**
 * Everything standing on the island.
 *
 * Offices are placed first, on the block cells nearest their district's
 * landmark, so a server's tools cluster around the building that represents it.
 * Every remaining buildable cell gets filler: a tower downtown, a house near
 * the shore. Heights come from the cell hash, which keeps the skyline varied
 * and stable across frames.
 */
export function layOutCity(
  offices: readonly { office: string; district: string }[],
): Building[] {
  const taken = new Set<string>();
  const buildings: Building[] = [];

  const key = (u: number, v: number) => `${u}:${v}`;

  // Landmarks reserve a small cross. That leaves a plaza around each civic
  // building without cutting a nine-cell hole out of every neighbourhood.
  for (const plot of DISTRICT_PLOTS) {
    for (const [du, dv] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      taken.add(key(plot.landmark.u + du, plot.landmark.v + dv));
    }
  }

  // Offices, nearest their landmark first.
  const byDistrict = new Map<string, string[]>();
  for (const entry of offices) {
    byDistrict.set(entry.district, [...(byDistrict.get(entry.district) ?? []), entry.office]);
  }

  for (const [district, list] of byDistrict) {
    const plot = plotFor(district);
    if (!plot) continue;

    const slots: Cell[] = [];
    for (let u = plot.u0; u <= plot.u1; u += 1) {
      for (let v = plot.v0; v <= plot.v1; v += 1) {
        if (tileKindAt(u, v) !== "grass") continue;
        if (taken.has(key(u, v))) continue;
        if (isFacilityCell(u, v)) continue;
        slots.push({ u, v });
      }
    }

    slots.sort(
      (a, b) =>
        Math.hypot(a.u - plot.landmark.u, a.v - plot.landmark.v) -
        Math.hypot(b.u - plot.landmark.u, b.v - plot.landmark.v),
    );

    for (const [index, office] of list.entries()) {
      const slot = slots[index];
      if (!slot) break;
      taken.add(key(slot.u, slot.v));
      buildings.push({
        cell: slot,
        height: 1.4 + (hash(office) % 5) * 0.35,
        seed: hash(office),
        kind: "office",
        district,
        office,
      });
    }
  }

  // Filler. Towers in the middle of the island, houses toward the shore, so
  // the skyline has a centre rather than being uniformly tall.
  const midU = ISLAND_W / 2;
  const midV = ISLAND_H / 2;
  const maxDist = Math.hypot(midU, midV);

  for (let u = 2; u <= ISLAND_W - 2; u += 1) {
    for (let v = 2; v <= ISLAND_H - 2; v += 1) {
      if (tileKindAt(u, v) !== "grass") continue;
      if (taken.has(key(u, v))) continue;
      if (isFacilityCell(u, v)) continue;

      const seed = cellSeed(u, v);

      // A garden in the middle of every block, and a third of the rest left
      // open.
      //
      // One cell in six used to be open, which filled roughly eight of the nine
      // buildable cells in a block and produced a city that is a solid field of
      // towers from one beach to the other. Two things are wrong with that. It
      // does not look like a city -- blocks have frontage on the street and
      // something behind it, which is why a courtyard reads as urban and a
      // ninth tower reads as a tile map. And it works against the product: nine
      // of these two hundred and forty structures are offices the agent can
      // actually call, and hiding them in a wall of identical roofs makes the
      // one thing an operator is looking for the hardest thing to find.
      //
      // The centre of each block goes first because it is the cell with no
      // street frontage, so the buildings that remain are the ones lining the
      // road -- which is the shape a block has, rather than a random scatter.
      if (u % ROAD_EVERY === 3 && v % ROAD_EVERY === 3) continue;
      if (seed % 2 === 0) continue;

      const distance = Math.hypot(u - midU, v - midV) / maxDist;
      const downtown = distance < 0.45;

      buildings.push({
        cell: { u, v },
        height: downtown ? 1.8 + (seed % 7) * 0.5 : 0.7 + (seed % 3) * 0.3,
        seed,
        kind: downtown ? "filler" : "house",
        district: districtAt(u, v),
        office: null,
      });
    }
  }

  return buildings;
}

/** Open block cells, for trees. */
export function treeCells(buildings: readonly Building[]): Cell[] {
  const built = new Set(buildings.map((b) => `${b.cell.u}:${b.cell.v}`));
  const cells: Cell[] = [];

  for (let u = 2; u <= ISLAND_W - 2; u += 1) {
    for (let v = 2; v <= ISLAND_H - 2; v += 1) {
      const kind = tileKindAt(u, v);
      if (kind !== "grass" && kind !== "pavement") continue;
      if (built.has(`${u}:${v}`)) continue;
      if (isLandmarkPlazaCell(u, v)) continue;
      if (isFacilityCell(u, v)) continue;
      const seed = cellSeed(u, v);
      // Fountains own their park cell; never place a canopy over the feature.
      if (kind === "grass" && seed % 30 === 0) continue;
      if (kind === "grass" ? seed % 2 !== 0 : hash(`street-tree:${u}:${v}`) % 11 !== 0) continue;
      cells.push({ u, v });
    }
  }

  return cells;
}

/** A few open grass cells become fountains, breaking up the larger parks. */
export function fountainCells(buildings: readonly Building[]): Cell[] {
  const built = new Set(buildings.map((b) => `${b.cell.u}:${b.cell.v}`));
  const cells: Cell[] = [];

  for (let u = 2; u <= ISLAND_W - 2; u += 1) {
    for (let v = 2; v <= ISLAND_H - 2; v += 1) {
      if (tileKindAt(u, v) !== "grass" || built.has(`${u}:${v}`)) continue;
      if (isLandmarkPlazaCell(u, v)) continue;
      if (isFacilityCell(u, v)) continue;
      // Filler parks are cells whose base seed is divisible by six. A second
      // divisor of thirty selects a stable subset without relying on a second
      // correlated hash that can accidentally select none of them.
      if (cellSeed(u, v) % 30 !== 0) continue;
      cells.push({ u, v });
    }
  }

  return cells;
}

/**
 * The outline of the granted scope.
 *
 * Traced around whole district plots rather than individual buildings: an
 * operator grants reach into a system, and drawing the boundary at that level
 * matches how the authority was described to them.
 */
export interface PerimeterEdge {
  readonly from: Cell;
  readonly to: Cell;
}

export function perimeterOf(districts: readonly string[]): PerimeterEdge[] {
  const plots = districts.map(plotFor).filter((p): p is DistrictPlot => p !== undefined);
  return plots.flatMap((plot) => {
    const u0 = plot.u0 - 1;
    const v0 = plot.v0 - 1;
    const u1 = plot.u1 + 1;
    const v1 = plot.v1 + 1;
    return [
      { from: { u: u0, v: v0 }, to: { u: u1, v: v0 } },
      { from: { u: u1, v: v0 }, to: { u: u1, v: v1 } },
      { from: { u: u1, v: v1 }, to: { u: u0, v: v1 } },
      { from: { u: u0, v: v1 }, to: { u: u0, v: v0 } },
    ];
  });
}

export function isInScope(cell: Cell, districts: readonly string[]): boolean {
  const plots = districts.map(plotFor).filter((p): p is DistrictPlot => p !== undefined);
  if (plots.length === 0) return false;

  return plots.some(
    (plot) =>
      cell.u >= plot.u0 - 1 &&
      cell.u <= plot.u1 + 1 &&
      cell.v >= plot.v0 - 1 &&
      cell.v <= plot.v1 + 1,
  );
}
