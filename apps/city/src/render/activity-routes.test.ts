import { describe, expect, it } from "vitest";
import { planActivityRoutes } from "./activity-routes.js";
import type { Building } from "./world.js";

const buildings: readonly Building[] = [
  { cell: { u: 3, v: 3 }, height: 2, seed: 1, kind: "office", district: "records", office: "ticket.get" },
  { cell: { u: 15, v: 3 }, height: 2, seed: 2, kind: "office", district: "exchequer", office: "charge.get" },
  { cell: { u: 16, v: 3 }, height: 2, seed: 3, kind: "filler", district: "exchequer", office: null },
];

describe("activity routes", () => {
  it("routes active calls from their district landmark to the exact office", () => {
    const routes = planActivityRoutes(
      buildings,
      new Map([
        ["ticket.get", { activity: "working" }],
        ["charge.get", { activity: "waiting" }],
      ]),
    );

    expect(routes).toEqual([
      { office: "ticket.get", activity: "working", from: { u: 8, v: 8 }, to: { u: 3, v: 3 } },
      { office: "charge.get", activity: "waiting", from: { u: 20, v: 8 }, to: { u: 15, v: 3 } },
    ]);
  });

  it("keeps refusals visible but ignores idle and completed offices", () => {
    expect(planActivityRoutes(buildings, new Map([
      ["ticket.get", { activity: "done" }],
      ["charge.get", { activity: "refused" }],
    ]))).toEqual([
      { office: "charge.get", activity: "refused", from: { u: 20, v: 8 }, to: { u: 15, v: 3 } },
    ]);
  });

  it("draws no invented traffic before runtime state arrives", () => {
    expect(planActivityRoutes(buildings, undefined)).toEqual([]);
  });
});
