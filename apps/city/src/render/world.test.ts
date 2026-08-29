import { describe, expect, it } from "vitest";
import {
  DISTRICT_PLOTS,
  ISLAND_H,
  ISLAND_W,
  ROAD_EVERY,
  fountainCells,
  isBlockCentre,
  isFacilityCell,
  isInScope,
  layOutCity,
  perimeterOf,
  plotFor,
  tileKindAt,
  treeCells,
} from "./world.js";

describe("scope geometry", () => {
  it("treats grants as a union instead of a bounding rectangle", () => {
    expect(isInScope(plotFor("records")!.landmark, ["records", "exchequer", "post-house"])).toBe(true);
    expect(isInScope(plotFor("yard")!.landmark, ["records", "exchequer", "post-house"])).toBe(false);
  });

  it("returns a separate four-edge perimeter for every granted plot", () => {
    const edges = perimeterOf(["records", "post-house"]);
    expect(edges).toHaveLength(8);
    expect(edges.every((edge) => edge.from.u === edge.to.u || edge.from.v === edge.to.v)).toBe(true);
  });

  it("treats an empty grant as no authority", () => {
    expect(isInScope(plotFor("records")!.landmark, [])).toBe(false);
    expect(perimeterOf([])).toEqual([]);
  });
});

describe("city fabric", () => {
  const offices = [
    { office: "ticket.get", district: "records" },
    { office: "customer.get", district: "records" },
    { office: "charge.get", district: "exchequer" },
    { office: "refund.create", district: "exchequer" },
    { office: "email.send", district: "post-house" },
    { office: "job.run", district: "yard" },
    { office: "archive.write", district: "archive" },
    { office: "gate.open", district: "gate" },
  ] as const;

  it("leaves a three-by-three buildable interior between roads and kerbs", () => {
    expect(tileKindAt(2, 2)).toBe("grass");
    expect(tileKindAt(3, 3)).toBe("grass");
    expect(tileKindAt(4, 4)).toBe("grass");
    expect(tileKindAt(5, 5)).toBe("pavement");
    expect(tileKindAt(6, 6)).toBe("road");
  });

  it("places each structure once on buildable ground", () => {
    const buildings = layOutCity(offices);
    const occupied = buildings.map(({ cell }) => `${cell.u}:${cell.v}`);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(buildings.every(({ cell }) => tileKindAt(cell.u, cell.v) === "grass")).toBe(true);
    expect(offices.every(({ office }) => buildings.some((building) => building.office === office))).toBe(true);
  });

  it("keeps park features visible and mutually exclusive", () => {
    const buildings = layOutCity(offices);
    const trees = treeCells(buildings);
    const fountains = fountainCells(buildings);
    const treeKeys = new Set(trees.map((cell) => `${cell.u}:${cell.v}`));
    expect(trees.length).toBeGreaterThan(0);
    expect(fountains.length).toBeGreaterThan(0);
    expect(fountains.every((cell) => !treeKeys.has(`${cell.u}:${cell.v}`))).toBe(true);
  });

  it("keeps every civic landmark on a buildable tile", () => {
    expect(DISTRICT_PLOTS.every((plot) => tileKindAt(plot.landmark.u, plot.landmark.v) === "grass")).toBe(true);
  });

  it("keeps the coastal destinations clear of procedural structures", () => {
    const buildings = layOutCity(offices);
    expect(buildings.some(({ cell }) => isFacilityCell(cell.u, cell.v))).toBe(false);
    expect(treeCells(buildings).some((cell) => isFacilityCell(cell.u, cell.v))).toBe(false);
  });

  it("surrounds the island with navigable water", () => {
    expect(tileKindAt(-8, 12)).toBe("water");
    expect(tileKindAt(47, 18)).toBe("water");
  });
});

describe("room to breathe", () => {
  const offices = [
    { office: "ticket.get", district: "records" },
    { office: "charge.refund", district: "exchequer" },
    { office: "mail.send", district: "post-house" },
  ] as const;

  const buildings = layOutCity(offices);
  // Filler only. Offices are placed first and take the cells nearest their
  // landmark whatever those are, which is right -- there are nine of them and
  // they have to stand somewhere. The garden is a rule about what fills the
  // rest, and asserting it over offices too just made the test wrong.
  const built = new Set(
    buildings.filter((b) => b.kind !== "office").map(({ cell }) => `${cell.u}:${cell.v}`),
  );

  /** Every cell a filler building could stand on. */
  const buildable: { u: number; v: number }[] = [];
  for (let u = 2; u <= ISLAND_W - 2; u += 1) {
    for (let v = 2; v <= ISLAND_H - 2; v += 1) {
      if (tileKindAt(u, v) !== "grass") continue;
      if (isFacilityCell(u, v)) continue;
      buildable.push({ u, v });
    }
  }

  it("leaves a garden in the middle of every block", () => {
    // The centre is the cell with no street frontage, so it is the one to give
    // up first: what remains is a block lining the road, which is the shape a
    // block has, rather than a scatter with holes in it.
    const centres = buildable.filter((c) => c.u % ROAD_EVERY === 3 && c.v % ROAD_EVERY === 3);
    expect(centres.length).toBeGreaterThan(10);
    for (const cell of centres) {
      expect(built.has(`${cell.u}:${cell.v}`), `built on the garden at ${cell.u},${cell.v}`).toBe(false);
    }
  });

  it("builds on about half of what is left", () => {
    // One cell in six used to be open, which filled eight of the nine buildable
    // cells in a block and made the island a solid field of towers from one
    // beach to the other. Nine of these structures are offices the agent can
    // actually call, and a wall of identical roofs makes the one thing an
    // operator is looking for the hardest thing to find.
    const density = buildings.length / buildable.length;
    expect(density).toBeGreaterThan(0.3);
    expect(density).toBeLessThan(0.6);
  });

  it("still finds a plot for every office", () => {
    // The thing that must not break when the city thins out. Offices are placed
    // before any filler and take the cells nearest their landmark, so this is
    // safe -- and it is worth a test precisely because it looks like the sort
    // of thing that would quietly stop being true.
    for (const entry of offices) {
      expect(
        buildings.some((b) => b.office === entry.office),
        `${entry.office} has nowhere to stand`,
      ).toBe(true);
    }
  });

  it("plants the space it opened up", () => {
    // Otherwise this is not a city with parks in it, it is a city with gaps.
    expect(treeCells(buildings).length).toBeGreaterThan(buildings.length / 2);
  });

  it("plants every garden, not the even-numbered half of them", () => {
    // The rule that opens a block's centre ignores the seed, and the planter
    // took even-seeded grass -- so an odd-seeded centre was cleared of its
    // building and then skipped, and became bare ground. Half the courtyards
    // were holes rather than gardens, which is the opposite of the change.
    const planted = new Set(
      [...treeCells(buildings), ...fountainCells(buildings)].map((c) => `${c.u}:${c.v}`),
    );

    const centres = buildable.filter((c) => isBlockCentre(c.u, c.v));
    expect(centres.length).toBeGreaterThan(10);

    // Every building here, offices included -- `built` above is filler only,
    // because the garden rule is about what fills a block and an office takes
    // the cell nearest its landmark whatever that cell is.
    const anything = new Set(buildings.map(({ cell }) => `${cell.u}:${cell.v}`));

    for (const cell of centres) {
      const key = `${cell.u}:${cell.v}`;
      expect(
        anything.has(key) || planted.has(key),
        `the centre at ${cell.u},${cell.v} is neither built nor planted`,
      ).toBe(true);
    }
  });

  it("keeps the two rules reading the same predicate", () => {
    // They were the same expression written out twice, in two files' worth of
    // apart, and went out of step the moment one of them changed.
    expect(isBlockCentre(3, 3)).toBe(true);
    expect(isBlockCentre(ROAD_EVERY + 3, ROAD_EVERY + 3)).toBe(true);
    expect(isBlockCentre(2, 3)).toBe(false);
  });
});
