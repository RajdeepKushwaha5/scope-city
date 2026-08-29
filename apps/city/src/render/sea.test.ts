import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  distanceOffshore,
  hasWave,
  isOffshore,
  isShallow,
  isShoal,
  waterVariant,
} from "./sea.js";
import { ISLAND_H, ISLAND_W, OCEAN_MARGIN, layOutCity, tileKindAt } from "./world.js";
import { OFFICES } from "../useMission.js";

/** Every cell the renderer visits, water and land alike. */
function everyCell(): { u: number; v: number }[] {
  const cells: { u: number; v: number }[] = [];
  for (let u = -OCEAN_MARGIN; u <= ISLAND_W + OCEAN_MARGIN; u += 1) {
    for (let v = -OCEAN_MARGIN; v <= ISLAND_H + OCEAN_MARGIN; v += 1) cells.push({ u, v });
  }
  return cells;
}

const cells = everyCell();

describe("how far out to sea a cell is", () => {
  it("is nothing at all on the island", () => {
    expect(distanceOffshore(20, 17)).toBe(0);
    expect(distanceOffshore(0, 0)).toBe(0);
    expect(distanceOffshore(ISLAND_W, ISLAND_H)).toBe(0);
  });

  it("counts cells past the edge", () => {
    expect(distanceOffshore(-3, 17)).toBe(3);
    expect(distanceOffshore(ISLAND_W + 2, 17)).toBe(2);
    expect(distanceOffshore(20, -1)).toBe(1);
  });

  it("takes the greater of the two when a cell is past a corner", () => {
    // Diagonally off the corner is as far out as the furthest axis, not the
    // sum: a cell one past the end in both directions is one cell offshore,
    // which is what the shallows around a corner should look like.
    expect(distanceOffshore(-2, -1)).toBe(2);
  });

  it("agrees with what the tile actually is", () => {
    // The one place these two ideas have to line up. If they ever disagreed,
    // shallows would appear on land or sand would appear in the deep.
    for (const { u, v } of cells) {
      expect(isOffshore(u, v), `${u},${v}`).toBe(tileKindAt(u, v) === "water");
    }
  });
});

describe("the shallows", () => {
  it("are a band around the island and nothing else", () => {
    for (const { u, v } of cells) {
      const out = distanceOffshore(u, v);
      expect(isShallow(u, v), `${u},${v}`).toBe(out >= 1 && out <= 3);
    }
  });

  it("are never on land", () => {
    expect(isShallow(20, 17)).toBe(false);
  });
});

describe("sandbanks", () => {
  it("never appear where anything could be built", () => {
    // The invariant this whole file exists to keep. A bank is paint, not
    // terrain: `tileKindAt` still says water, so nothing consults a sandbank
    // when deciding where a building may stand or what a scope covers. Making
    // it a real sand tile would have put a buildable-looking cell three cells
    // out to sea.
    for (const { u, v } of cells) {
      if (!isShoal(u, v)) continue;
      expect(tileKindAt(u, v), `${u},${v} is a bank on non-water`).toBe("water");
    }
  });

  it("thin out with distance rather than stopping", () => {
    // Density is the whole of the fade -- the banks themselves are solid sand.
    // A dither on each one put a fine checkerboard under the coarse one and the
    // two read as static rather than as a shore.
    const density = (out: number) => {
      const band = cells.filter((c) => distanceOffshore(c.u, c.v) === out);
      return band.filter((c) => isShoal(c.u, c.v)).length / band.length;
    };

    const first = density(1);
    const second = density(2);
    const third = density(3);

    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
    // Dense enough at the beach to read as the beach continuing.
    expect(first).toBeGreaterThan(0.3);
    // Sparse enough at the far edge to read as a stray bank, not a second coast.
    expect(third).toBeLessThan(0.2);
  });

  it("stop at the edge of the shallows", () => {
    for (const { u, v } of cells) {
      if (distanceOffshore(u, v) > 3) expect(isShoal(u, v), `${u},${v}`).toBe(false);
    }
  });

  it("stay where they are between frames", () => {
    // Hashed from the cell rather than from anything that moves. A coastline
    // that reshuffles every frame is worse than a straight one.
    const once = cells.map((c) => isShoal(c.u, c.v));
    const twice = cells.map((c) => isShoal(c.u, c.v));
    expect(once).toEqual(twice);
  });

  it("leave the city's own layout untouched", () => {
    // Belt and braces on the same invariant, from the other end: the layout is
    // computed from `tileKindAt`, so if a bank ever became terrain this would
    // start finding buildings at sea.
    for (const b of layOutCity(OFFICES)) {
      expect(distanceOffshore(b.cell.u, b.cell.v), `building at ${b.cell.u},${b.cell.v}`).toBe(0);
    }
  });
});

describe("the water's own texture", () => {
  it("uses all three shades", () => {
    // The point of it. If the hash collapsed to one value the sea would be the
    // flat plane this replaced, and every other test here would still pass.
    const seen = new Set(cells.map((c) => waterVariant(c.u, c.v)));
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it("keeps every cell to one of them", () => {
    for (const { u, v } of cells) {
      expect(waterVariant(u, v)).toBeGreaterThanOrEqual(0);
      expect(waterVariant(u, v)).toBeLessThan(3);
    }
  });

  it("puts wave marks only in open water", () => {
    // In the shallows the banks and the lighter blue already carry the detail;
    // a wave mark there is one texture too many.
    for (const { u, v } of cells) {
      if (hasWave(u, v)) expect(distanceOffshore(u, v)).toBeGreaterThan(3);
    }
  });

  it("puts some there", () => {
    expect(cells.filter((c) => hasWave(c.u, c.v)).length).toBeGreaterThan(20);
  });
});

describe("the clouds", () => {
  const shapes = readFileSync(fileURLToPath(new URL("./shapes.ts", import.meta.url)), "utf8");
  const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");

  const anchors = [...shapes.matchAll(/\{ u: (-?\d+), v: (-?\d+), w: \d+/g)].map((m) => ({
    u: Number(m[1]),
    v: Number(m[2]),
  }));

  it("were found in the table", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(6);
  });

  it("sit on water", () => {
    // They are clipped to outside the island, so an anchor on land is not a
    // cloud over the streets -- it is a cloud nobody will ever see. The first
    // set was written in world pixels and two of them landed on the city.
    for (const cloud of anchors) {
      expect(distanceOffshore(cloud.u, cloud.v), `a cloud at ${cloud.u},${cloud.v}`).toBeGreaterThan(0);
    }
  });

  it("are drawn after the sea rather than under it", () => {
    // The mistake that cost the most time here, and it looked like the drawing
    // being broken. Clouds went in before the ground layer -- the obvious way
    // to keep them off the land -- and water tiles are opaque, so the only ones
    // visible were past the edge of the drawn ocean, in the corners of the
    // screen. They were painted correctly and then covered by the sea.
    const ground = scene.indexOf("for (const item of ground) item.draw(ctx);");
    const clouds = scene.indexOf("drawClouds(ctx");
    expect(ground).toBeGreaterThan(-1);
    expect(clouds, "clouds must be drawn after the ground layer").toBeGreaterThan(ground);
  });

  it("are clipped to outside the island", () => {
    expect(shapes).toMatch(/ctx\.clip\("evenodd"\)/);
  });
});
