import { describe, expect, it } from "vitest";
import { RADAR_PERIOD, drawRadar } from "./shapes.js";
import { isFacilityCell } from "./world.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The radar is tested by watching it draw.
 *
 * Everything else about the renderer is checked by arithmetic or by reading the
 * source, because a canvas is hard to assert on. This one does not need to be:
 * the whole behaviour is two numbers that come out of `ellipse` and `fillStyle`,
 * so a stub context that records them says exactly whether the dish is turning
 * and which way it is facing.
 */

interface Ellipse {
  readonly x: number;
  readonly halfWidth: number;
  readonly fill: string;
}

/** Just enough of a 2D context for `drawRadar`. */
function record(time: number): Ellipse[] {
  const seen: Ellipse[] = [];
  let fill = "";
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    fillRect() {},
    ellipse(x: number, _y: number, rx: number) {
      seen.push({ x, halfWidth: rx, fill });
    },
    set fillStyle(value: string) {
      fill = value;
    },
    get fillStyle() {
      return fill;
    },
  };
  drawRadar(ctx as unknown as CanvasRenderingContext2D, 37, 20, time);
  return seen;
}

/** The dish is the only ellipse `drawRadar` draws. */
const dishAt = (time: number): Ellipse => {
  const drawn = record(time);
  expect(drawn, "drawRadar drew no dish").toHaveLength(1);
  return drawn[0]!;
};

describe("the radar turns", () => {
  it("is broadside at the start of a sweep", () => {
    expect(dishAt(0).halfWidth).toBeCloseTo(15, 5);
  });

  it("is edge-on a quarter of the way round", () => {
    // Rotation about a vertical axis, in a projection with no third dimension:
    // the dish keeps its height and loses its width, so a quarter turn is a
    // line. Without this it would not read as turning at all.
    expect(dishAt(RADAR_PERIOD / 4).halfWidth).toBeLessThan(1);
  });

  it("is broadside again at the half turn, showing its back", () => {
    const front = dishAt(0);
    const back = dishAt(RADAR_PERIOD / 2);

    expect(back.halfWidth).toBeCloseTo(front.halfWidth, 5);
    // The part that makes it a rotation rather than a squash. With one colour
    // the dish reads as flattening and unflattening in place.
    expect(back.fill).not.toBe(front.fill);
  });

  it("comes back to where it started", () => {
    const first = dishAt(0);
    const later = dishAt(RADAR_PERIOD * 4);
    expect(later.halfWidth).toBeCloseTo(first.halfWidth, 5);
    expect(later.fill).toBe(first.fill);
  });

  it("keeps the dish on the mast", () => {
    // Foreshortening is symmetric about the axis, so the centre must not move.
    // Scaling from one edge instead would have the dish sliding along its own
    // gantry every sweep.
    const xs = [0, 900, 1800, 2700, 3600, 4500].map((t) => dishAt(t).x);
    expect(new Set(xs).size, "the dish wandered off the mast").toBe(1);
  });

  it("sweeps at a believable rate", () => {
    // Fast enough to see without waiting, slow enough not to strobe.
    expect(RADAR_PERIOD).toBeGreaterThan(3000);
    expect(RADAR_PERIOD).toBeLessThan(12000);
  });
});

describe("where the radar stands", () => {
  const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");

  it("is on ground the city has reserved", () => {
    // Facility cells take no buildings and no trees. A radar on an ordinary
    // block would have a tower grow through it the next time the layout moved.
    const call = /drawRadar\(ctx, (\d+), (\d+), time\)/.exec(scene);
    expect(call, "the radar is not placed in the scene").not.toBeNull();
    expect(isFacilityCell(Number(call![1]), Number(call![2]))).toBe(true);
  });

  it("is drawn from the frame clock", () => {
    // Passing a constant would leave it welded in place, which is the state
    // this replaced -- and every test above would still pass.
    expect(scene).toMatch(/drawRadar\(ctx, \d+, \d+, time\)/);
  });
});
