import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { depth } from "../iso/projection.js";

/**
 * Flat ground must never be painted over something standing on it.
 *
 * Depth is `(u + v) * 1000 + height`, so height only separates things that
 * share a diagonal. A vehicle is at a *fractional* position between two of
 * them, and its sprite is about a tile wide -- so the tile at the next whole
 * diagonal sorts a thousand higher, was drawn afterwards, and painted over the
 * half of the car that had crossed into it. Cars disappeared from the front as
 * they drove.
 */
const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");

describe("a moving vehicle against the ground it drives on", () => {
  it("sorts below the tile it is driving into", () => {
    // The arithmetic behind the bug, so the reason this layer exists cannot be
    // forgotten and quietly undone.
    const car = depth(14.37, 24.16, 0.5);
    const tileAhead = depth(15, 24, -1);

    expect(car).toBeLessThan(tileAhead);
    expect(tileAhead - car).toBeGreaterThan(400);
  });

  it("cannot be fixed by raising the vehicle instead", () => {
    // The obvious alternative, and it does not work -- which is worth pinning,
    // because it is the change someone reaches for first.
    //
    // The height needed depends on where between the tiles the car happens to
    // be: nearly a thousand at the start of a tile, almost nothing at the end.
    // No constant covers both, and one large enough for the worst case would
    // lift the car over buildings it belongs behind.
    const nearTileStart = depth(15, 24, -1) - depth(14.02, 24.0, 0);
    const nearTileEnd = depth(15, 24, -1) - depth(14.98, 24.0, 0);

    expect(Math.round(nearTileStart)).toBe(979);
    expect(Math.round(nearTileEnd)).toBe(19);

    // Fifty times the spread, from one end of a tile to the other. A constant
    // that covers the start is fifty times more than the end needs, and a
    // vehicle is somewhere new every frame.
    expect(nearTileStart / nearTileEnd).toBeGreaterThan(50);
  });
});

describe("the ground is drawn as its own layer", () => {
  it("paints every tile before anything that stands on one", () => {
    // Read from source because the alternative is a canvas harness for one
    // ordering property. The pass has to exist and has to come first.
    const groundPass = scene.indexOf("const ground = groundItems(framed)");
    const sortedRest = scene.indexOf("items.sort");

    expect(groundPass).toBeGreaterThan(-1);
    expect(sortedRest).toBeGreaterThan(groundPass);
  });

  it("still sorts the tiles among themselves", () => {
    // A recessed road's kerb does overlap its neighbour, so the layer is not
    // simply drawn in loop order.
    expect(scene).toMatch(/ground\.sort\(\(a, b\) => a\.z - b\.z\)/);
  });

  it("no longer feeds ground into the shared list", () => {
    // The bug returns the moment a tile is sorted against a vehicle again.
    const items = scene.slice(scene.indexOf("const items: Drawable[] = ["), sortedRest(scene));
    expect(items).not.toContain("groundItems");
  });
});

function sortedRest(source: string): number {
  return source.indexOf("items.sort");
}
