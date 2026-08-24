import { describe, expect, it } from "vitest";
import {
  DISTRICT_PLOTS,
  fountainCells,
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

  it("generates a dense skyline with parks, trees, and fountains", () => {
    const buildings = layOutCity(offices);
    expect(buildings.length).toBeGreaterThanOrEqual(220);
    expect(buildings.length).toBeLessThanOrEqual(280);
    expect(treeCells(buildings).length).toBeGreaterThanOrEqual(60);
    expect(fountainCells(buildings).length).toBeGreaterThan(0);
  });

  it("keeps every civic landmark on a buildable tile", () => {
    expect(DISTRICT_PLOTS.every((plot) => tileKindAt(plot.landmark.u, plot.landmark.v) === "grass")).toBe(true);
  });
});
