import { describe, expect, it } from "vitest";
import { placeBeacon } from "./GateBeacon.js";

/**
 * The beacon exists to point at the building that is holding the mission. Every
 * case here is one where it could point at the wrong thing, or at nothing.
 */

const SIZE = { width: 1200, height: 800 };
const STILL = { x: 0, y: 0, zoom: 1 };

describe("placing the gate beacon", () => {
  it("puts a building at the world origin in the centre of the viewport", () => {
    const placed = placeBeacon({ x: 0, y: 0 }, STILL, SIZE);

    expect(placed).toEqual({ x: 600, y: 400, offscreen: false });
  });

  it("follows the camera rather than the world", () => {
    // Panning must move the marker with the building. A beacon fixed in screen
    // space would point confidently at whatever happened to be under it.
    const panned = placeBeacon({ x: 0, y: 0 }, { x: -200, y: 60, zoom: 1 }, SIZE);

    expect(panned.x).toBe(400);
    expect(panned.y).toBe(460);
  });

  it("scales the offset with zoom", () => {
    const near = placeBeacon({ x: 100, y: 0 }, { x: 0, y: 0, zoom: 2 }, SIZE);
    expect(near.x).toBe(800);
  });

  it("clamps to the edge when the building is off screen, and says so", () => {
    // A marker that vanishes exactly when the operator has panned away from the
    // thing needing attention has failed at its only job.
    const away = placeBeacon({ x: 5000, y: 0 }, STILL, SIZE);

    expect(away.offscreen).toBe(true);
    expect(away.x).toBe(SIZE.width - 56);
    expect(away.y).toBe(400);
  });

  it("clamps on the near side too", () => {
    const behind = placeBeacon({ x: -5000, y: -5000 }, STILL, SIZE);

    expect(behind).toEqual({ x: 56, y: 56, offscreen: true });
  });

  it("does not call an on-screen building off-screen", () => {
    // The inset is 56px, so a building 57px from the edge is still visible and
    // must not be dimmed and labelled as being somewhere else.
    const edge = placeBeacon({ x: 1200 / 2 - 57, y: 0 }, STILL, SIZE);

    expect(edge.offscreen).toBe(false);
  });

  it("stays inside a viewport narrower than two insets", () => {
    // The clamp bounds cross over when width < 2 * inset. Without guarding the
    // upper bound, `Math.min` then wins against `Math.max` and pins the marker
    // to the opposite edge from the one it should be on.
    const tiny = { width: 80, height: 80 };
    const placed = placeBeacon({ x: 900, y: 900 }, STILL, tiny);

    expect(placed.x).toBe(56);
    expect(placed.y).toBe(56);
    expect(placed.x).toBeLessThanOrEqual(tiny.width);
  });
});
