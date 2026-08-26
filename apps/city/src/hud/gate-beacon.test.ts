import { describe, expect, it } from "vitest";
import { gateLandmark, placeBeacon, targetCell } from "./GateBeacon.js";

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
    expect(away.x).toBe(SIZE.width - 104);
    expect(away.y).toBe(400);
  });

  it("clamps on the near side too", () => {
    const behind = placeBeacon({ x: -5000, y: -5000 }, STILL, SIZE);

    expect(behind).toEqual({ x: 104, y: 56, offscreen: true });
  });

  it("leaves room for the label, not just the ring", () => {
    // "Countersign required" is about 150px wide and centred on the marker, so
    // a 56px horizontal inset put half the text off screen: the beacon pointed
    // correctly and could not be read. The horizontal clamp is wider than the
    // vertical one for exactly this reason.
    const away = placeBeacon({ x: 5000, y: 0 }, STILL, SIZE);

    expect(SIZE.width - away.x).toBeGreaterThanOrEqual(75);
  });

  it("does not call an on-screen building off-screen", () => {
    // A building comfortably inside the horizontal inset is still visible and
    // must not be dimmed and labelled as being somewhere else.
    const edge = placeBeacon({ x: 1200 / 2 - 105, y: 0 }, STILL, SIZE);

    expect(edge.offscreen).toBe(false);
  });

  it("stays inside a viewport narrower than the label inset", () => {
    // Holding a 104px inset on a 120px-wide viewport would push the marker off
    // the very side it was being pulled back from. The inset shrinks to half
    // the axis instead.
    const narrow = { width: 120, height: 400 };
    const placed = placeBeacon({ x: 9000, y: 0 }, STILL, narrow);

    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.x).toBeLessThanOrEqual(narrow.width);
  });

  it("stays inside a viewport narrower than two insets", () => {
    // The clamp bounds cross over when the axis is smaller than two insets.
    //
    // This used to assert x === 104 on an 80px-wide viewport, which is outside
    // the viewport: the guard kept the arithmetic sane but still held an inset
    // the screen could not afford. Both insets now shrink to half their axis,
    // so the marker lands at the centre of a viewport too small to offset it
    // within -- which is the only place left that is actually on screen.
    const tiny = { width: 80, height: 80 };
    const placed = placeBeacon({ x: 900, y: 900 }, STILL, tiny);

    expect(placed.x).toBe(40);
    expect(placed.y).toBe(40);
    expect(placed.x).toBeLessThanOrEqual(tiny.width);
    expect(placed.y).toBeLessThanOrEqual(tiny.height);
  });
});

describe("what the beacon points at", () => {
  it("points at the gated building when there is one", () => {
    const cell = targetCell({ cell: { u: 7, v: 3 }, height: 2.5 });
    expect(cell).toEqual({ u: 7, v: 3, height: 2.5 });
  });

  it("falls back to the Gate landmark when the office names no building", () => {
    // The live event contract allows a null office, and `reduceLiveCity` turns
    // that into the string "unknown tool" while keeping the gate active. The
    // old code returned null here, so the map went silent in exactly the case
    // the beacon exists for.
    const cell = targetCell(undefined);

    expect(cell).not.toBeNull();
    expect(cell).toEqual(gateLandmark());
  });

  it("sits on the landmark's roof rather than 32px below it", () => {
    // The projection subtracts `height * UNIT_H` with UNIT_H of 32, so a
    // hardcoded height of 2 against a landmark rendered at 3.0 put the marker a
    // full unit low -- pointing at the pavement in front of the building.
    expect(gateLandmark()?.height).toBe(3);
  });
});
