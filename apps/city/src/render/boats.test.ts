import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tileKindAt } from "./world.js";

/**
 * The boats, read out of the scene's own table.
 *
 * Parsed from the source rather than exported, because the table is a detail of
 * the renderer and exporting it only so a test can see it would make it part of
 * the module's surface. What is being checked is arithmetic in a literal, and
 * the literal is right here.
 */
const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");

interface Route {
  axis: "u" | "v";
  fixed: number;
  min: number;
  max: number;
  speed: number;
  sail: boolean;
}

function routes(): Route[] {
  const table = scene.slice(scene.indexOf("const BOAT_ROUTES = ["), scene.indexOf("] as const;", scene.indexOf("const BOAT_ROUTES = [")));
  const out: Route[] = [];
  for (const line of table.split("\n")) {
    const m = /axis: "(u|v)", fixed: (-?\d+), min: (-?\d+), max: (-?\d+), speed: ([\d.]+).*sail: (true|false)/.exec(line);
    if (!m) continue;
    out.push({
      axis: m[1] as "u" | "v",
      fixed: Number(m[2]),
      min: Number(m[3]),
      max: Number(m[4]),
      speed: Number(m[5]),
      sail: m[6] === "true",
    });
  }
  return out;
}

const BOATS = routes();

describe("the boats", () => {
  it("were found in the table", () => {
    // The parser is what every test below leans on. If the table were reformatted
    // and this matched nothing, all of them would pass over an empty list.
    expect(BOATS.length).toBeGreaterThanOrEqual(8);
  });

  it("sail rather than skim", () => {
    // They used to cross the whole map in about nine seconds, which for forty
    // cells is roughly a hundred knots. A traverse takes `1 / speed` seconds,
    // and it should be long enough that a boat looks becalmed in a screenshot
    // and has plainly moved by the time you look again.
    for (const boat of BOATS) {
      const seconds = 1 / boat.speed;
      expect(seconds, `a lane crossing in ${Math.round(seconds)}s`).toBeGreaterThan(45);
      expect(seconds, `a lane crossing in ${Math.round(seconds)}s`).toBeLessThan(180);
    }
  });

  it("are spread across the water rather than ringing the island", () => {
    // Every route used to hug the edge of the drawn ocean, so the water between
    // the margin and the beach was always empty however many boats there were.
    const lanes = new Set(BOATS.map((b) => `${b.axis}:${b.fixed}`));
    expect(lanes.size, "two boats share a lane").toBe(BOATS.length);

    const offsets = BOATS.map((b) => Math.abs(b.fixed));
    expect(Math.min(...offsets), "nothing sails near the shore").toBeLessThan(6);
    expect(Math.max(...offsets), "nothing sails far out").toBeGreaterThan(40);
  });

  it("never sail over the island", () => {
    // A lane is a straight line the whole width of the map, so it is easy to
    // pick a `fixed` that is water at one end and a street at the other.
    for (const boat of BOATS) {
      for (let n = boat.min; n <= boat.max; n += 1) {
        const u = boat.axis === "u" ? n : boat.fixed;
        const v = boat.axis === "v" ? n : boat.fixed;
        expect(tileKindAt(u, v), `a boat at ${u},${v}`).toBe("water");
      }
    }
  });

  it("are mostly under sail", () => {
    // The silhouette that says "boat" at map scale is a triangle over a hull.
    expect(BOATS.filter((b) => b.sail).length).toBeGreaterThan(BOATS.length / 2);
  });
});

describe("the way a boat is drawn", () => {
  const shapes = readFileSync(fileURLToPath(new URL("./shapes.ts", import.meta.url)), "utf8");
  const drawBoat = shapes.slice(shapes.indexOf("export function drawBoat("), shapes.indexOf("export function drawShip("));

  it("turns the hull and leaves the rig standing", () => {
    // The bug that made the old craft unrecognisable: hull, mast and sail were
    // all rotated onto the water's axis together. A mast is vertical whichever
    // way a boat points, so the sail lay over at thirty degrees and the boat
    // read as capsizing.
    const rotate = drawBoat.indexOf("ctx.rotate(angle)");
    const restore = drawBoat.indexOf("ctx.restore()", rotate);
    // The mast, not `if (sail)` -- the hull's own colour block is also written
    // `if (sail)`, and matching that one had the test passing on the position
    // of something inside the rotated frame.
    const mast = drawBoat.indexOf("COAST.mast");

    expect(rotate).toBeGreaterThan(-1);
    expect(restore, "the rotated frame must be closed").toBeGreaterThan(rotate);
    expect(mast, "the mast must be drawn outside the rotated frame").toBeGreaterThan(restore);
  });

  it("does not hide the one colour that tells boats apart", () => {
    // The cabin carried the route's colour and sat directly under the sail,
    // which is the largest thing on the boat. On a sailing boat the colour goes
    // on the sheer strake instead, where it can be seen.
    expect(drawBoat).toMatch(/if \(sail\) \{[\s\S]{0,400}ctx\.fill\(\);[\s\S]{0,80}\} else \{[\s\S]{0,120}fillRect/);
  });
});
