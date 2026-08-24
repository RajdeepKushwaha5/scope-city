import { describe, expect, it } from "vitest";
import { isInScope, perimeterOf, plotFor } from "./world.js";

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
