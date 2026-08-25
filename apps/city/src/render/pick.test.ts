import { describe, expect, it } from "vitest";
import { toScreen } from "../iso/projection.js";
import { isMeaningful, pickBuilding } from "./pick.js";
import type { Building } from "./world.js";

/**
 * Picking has to be right or the inspector lies.
 *
 * An operator who clicks `charge.refund` and is shown `charge.get` learns the
 * wrong thing about their own authority, which is worse than a map that cannot
 * be clicked at all.
 */

const building = (u: number, v: number, office: string | null, height = 1.5): Building => ({
  cell: { u, v },
  height,
  seed: 1,
  kind: office ? "office" : "filler",
  district: "exchequer",
  office,
});

describe("pickBuilding", () => {
  it("finds the building standing on the clicked cell", () => {
    const b = building(10, 6, "charge.refund");
    const at = toScreen(10, 6, 0);

    expect(pickBuilding([b], at.x, at.y).building).toBe(b);
  });

  it("finds a tall building when the click lands on its roof", () => {
    // A roof is drawn well above the cell the building stands on, so a naive
    // inverse projection selects whatever is behind it.
    const tall = building(10, 6, "charge.refund", 3);
    const roof = toScreen(10, 6, 3);

    expect(pickBuilding([tall], roof.x, roof.y).building).toBe(tall);
  });

  it("prefers the building nearest the viewer when two overlap", () => {
    // Same rule the painter draws by, so what is picked is what is visible.
    const behind = building(9, 5, "charge.get", 3);
    const front = building(10, 6, "charge.refund", 3);
    const at = toScreen(10, 6, 0);

    expect(pickBuilding([behind, front], at.x, at.y).building).toBe(front);
  });

  it("finds nothing on empty ground", () => {
    const b = building(10, 6, "charge.refund");
    const far = toScreen(30, 30, 0);

    expect(pickBuilding([b], far.x, far.y).building).toBeNull();
  });

  it("does not reach past a building's height", () => {
    // A one-storey building must not be selectable from six cells away just
    // because the diagonal happens to line up.
    const shortOne = building(10, 6, "charge.refund", 1);
    const wayAbove = toScreen(10, 6, 6);

    expect(pickBuilding([shortOne], wayAbove.x, wayAbove.y).building).toBeNull();
  });

  it("reports the cell even when nothing is there", () => {
    const result = pickBuilding([], toScreen(4, 7, 0).x, toScreen(4, 7, 0).y);
    expect(result.cell).toEqual({ u: 4, v: 7 });
  });
});

describe("isMeaningful", () => {
  it("accepts a building that represents an office", () => {
    expect(isMeaningful(building(1, 1, "charge.refund"))).toBe(true);
  });

  it("rejects scenery", () => {
    // Opening an inspector on a filler block would be an inspector about
    // nothing, and pretending every rooftop is a capability makes the metaphor
    // noise rather than information.
    expect(isMeaningful(building(1, 1, null))).toBe(false);
    expect(isMeaningful(null)).toBe(false);
  });
});
