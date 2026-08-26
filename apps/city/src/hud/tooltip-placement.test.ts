import { describe, expect, it } from "vitest";
import {
  TOOLTIP_ESTIMATED_HEIGHT,
  TOOLTIP_MAX_WIDTH,
  placeTooltip,
} from "./tooltip-placement.js";

const SIZE = { width: 1200, height: 800 };
const BOX = { width: TOOLTIP_MAX_WIDTH, height: TOOLTIP_ESTIMATED_HEIGHT };

/**
 * The tooltip was `left: x + 14, top: y + 14` with no bound. It is fixed and up
 * to 280px wide, so a building near the right or bottom edge described itself
 * off the screen -- worst exactly where an operator pans to look at the city
 * limits.
 */
describe("placing the map tooltip", () => {
  it("sits below and right of the cursor when there is room", () => {
    const at = placeTooltip({ x: 400, y: 300 }, SIZE);

    expect(at).toMatchObject({ left: 414, top: 314, flippedX: false, flippedY: false });
  });

  it("flips left rather than running off the right edge", () => {
    const at = placeTooltip({ x: 1150, y: 300 }, SIZE);

    expect(at.flippedX).toBe(true);
    expect(at.left + BOX.width).toBeLessThanOrEqual(SIZE.width);
  });

  it("flips up rather than running off the bottom", () => {
    const at = placeTooltip({ x: 400, y: 780 }, SIZE);

    expect(at.flippedY).toBe(true);
    expect(at.top + BOX.height).toBeLessThanOrEqual(SIZE.height);
  });

  it("flips both in the corner, which is where it was worst", () => {
    const at = placeTooltip({ x: 1195, y: 795 }, SIZE);

    expect(at.flippedX).toBe(true);
    expect(at.flippedY).toBe(true);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });

  it("flips rather than clamping, so it does not cover what it describes", () => {
    // A clamped tooltip sits under the pointer and hides the building. Flipped,
    // it stays beside it: the cursor must be outside the box.
    const at = placeTooltip({ x: 1150, y: 300 }, SIZE);

    expect(at.left + BOX.width).toBeLessThan(1150);
  });

  it("stays on screen when neither side fits", () => {
    // A viewport narrower than the tooltip: flipping left would push it off the
    // other edge, so the clamp has to run after the flip rather than instead
    // of it.
    const tiny = { width: 200, height: 150 };
    const at = placeTooltip({ x: 190, y: 140 }, tiny);

    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.left).toBeLessThanOrEqual(tiny.width);
    expect(at.top).toBeLessThanOrEqual(tiny.height);
  });

  it("never places it off the top or left", () => {
    const at = placeTooltip({ x: 0, y: 0 }, SIZE);

    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });
});
