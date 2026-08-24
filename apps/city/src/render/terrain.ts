import { TILE_H, TILE_W, toScreen } from "../iso/projection.js";
import type { Material } from "./palette.js";

/**
 * Ground, with dithered transitions.
 *
 * A hard line where grass meets sand is the clearest sign a map was generated
 * rather than drawn. Real tile art blends the two with a checkerboard that
 * thins out over a couple of cells, which is a trick from an era when there
 * were sixteen colours and no alpha -- and it still looks better than a
 * gradient, because it keeps every pixel one of the two palette colours.
 *
 * The pattern is deterministic from the cell, so the shoreline is stable
 * between frames rather than crawling.
 */

/** A 4x4 ordered dither. Values 0..15; a cell is filled when threshold > value. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/**
 * Fills a tile diamond with `base`, then speckles `blend` over it at a density
 * set by `amount` (0 = none, 1 = solid). Speckles are drawn as small diamonds
 * on a sub-grid so they read as texture rather than noise.
 */
export function drawDitheredTile(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  base: Material,
  blend: Material | null,
  amount: number,
  variant: number,
): void {
  const c = toScreen(u, v, 0);

  ctx.beginPath();
  ctx.moveTo(c.x, c.y - TILE_H / 2);
  ctx.lineTo(c.x + TILE_W / 2, c.y);
  ctx.lineTo(c.x, c.y + TILE_H / 2);
  ctx.lineTo(c.x - TILE_W / 2, c.y);
  ctx.closePath();

  ctx.fillStyle = variant === 0 ? base.top : variant === 1 ? base.left : base.right;
  ctx.fill();

  if (!blend || amount <= 0) return;

  // Clip to the diamond so speckles never leak into a neighbour.
  ctx.save();
  ctx.clip();

  const threshold = Math.round(amount * 16);
  const step = TILE_W / 8;
  ctx.fillStyle = blend.top;

  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const cellValue = BAYER[(i + Math.abs(u)) % 4]![(j + Math.abs(v)) % 4]!;
      if (cellValue >= threshold) continue;

      const x = c.x - TILE_W / 2 + i * step;
      const y = c.y - TILE_H / 2 + j * (TILE_H / 8);
      ctx.fillRect(x, y, step, TILE_H / 8);
    }
  }

  ctx.restore();
}

/**
 * A tile that sits below the surrounding ground, with a visible kerb.
 *
 * Roads are recessed rather than painted flat: the drop catches a shadow on
 * two sides, and that single detail does more to make a street look like a
 * street than any amount of lane marking.
 */
export function drawRecessed(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  surface: Material,
  kerb: Material,
  drop: number,
): void {
  const rim = toScreen(u, v, 0);
  const floor = toScreen(u, v, -drop);

  // The two inner faces of the recess that face the viewer.
  ctx.beginPath();
  ctx.moveTo(rim.x - TILE_W / 2, rim.y);
  ctx.lineTo(rim.x, rim.y - TILE_H / 2);
  ctx.lineTo(floor.x, floor.y - TILE_H / 2);
  ctx.lineTo(floor.x - TILE_W / 2, floor.y);
  ctx.closePath();
  ctx.fillStyle = kerb.right;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(rim.x, rim.y - TILE_H / 2);
  ctx.lineTo(rim.x + TILE_W / 2, rim.y);
  ctx.lineTo(floor.x + TILE_W / 2, floor.y);
  ctx.lineTo(floor.x, floor.y - TILE_H / 2);
  ctx.closePath();
  ctx.fillStyle = kerb.left;
  ctx.fill();

  // The road surface itself.
  ctx.beginPath();
  ctx.moveTo(floor.x, floor.y - TILE_H / 2);
  ctx.lineTo(floor.x + TILE_W / 2, floor.y);
  ctx.lineTo(floor.x, floor.y + TILE_H / 2);
  ctx.lineTo(floor.x - TILE_W / 2, floor.y);
  ctx.closePath();
  ctx.fillStyle = surface.top;
  ctx.fill();
}

/**
 * Lane markings and crossings on a road surface.
 *
 * `connections` is a 4-bit mask, north-east / south-east / south-west /
 * north-west. A centre line is drawn only along an axis that continues, and a
 * crossing is painted where a road meets a junction, so markings never run into
 * a kerb.
 */
export function drawRoadMarkings(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  connections: number,
  drop: number,
): void {
  const c = toScreen(u, v, -drop);

  const ne = (connections & 0b0001) !== 0;
  const se = (connections & 0b0010) !== 0;
  const sw = (connections & 0b0100) !== 0;
  const nw = (connections & 0b1000) !== 0;

  const uAxis = ne && sw;
  const vAxis = se && nw;
  const junction = uAxis && vAxis;

  ctx.save();

  if (junction) {
    // Zebra crossings on all four approaches instead of a centre line.
    ctx.fillStyle = "rgba(238, 242, 247, 0.72)";
    for (let i = 1; i <= 3; i += 1) {
      const t = i / 4;
      // Along the u axis, near the north-east and south-west edges.
      stripe(ctx, c.x + (TILE_W / 2) * t, c.y - (TILE_H / 2) * (1 - t), 1);
      stripe(ctx, c.x - (TILE_W / 2) * t, c.y + (TILE_H / 2) * (1 - t), 1);
      stripe(ctx, c.x + (TILE_W / 2) * (1 - t), c.y + (TILE_H / 2) * t, -1);
      stripe(ctx, c.x - (TILE_W / 2) * (1 - t), c.y - (TILE_H / 2) * t, -1);
    }
  } else {
    ctx.strokeStyle = "rgba(238, 242, 247, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);

    if (uAxis) {
      ctx.beginPath();
      ctx.moveTo(c.x - TILE_W / 2, c.y);
      ctx.lineTo(c.x + TILE_W / 2, c.y);
      ctx.stroke();
    }
    if (vAxis) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - TILE_H / 2);
      ctx.lineTo(c.x, c.y + TILE_H / 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** One zebra stripe, sheared to lie flat on the ground plane. */
function stripe(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1): void {
  const w = TILE_W / 10;
  const h = TILE_H / 10;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * dir, y + h);
  ctx.lineTo(x + w * dir - w * 0.4 * dir, y + h + h * 0.4);
  ctx.lineTo(x - w * 0.4 * dir, y + h * 0.4);
  ctx.closePath();
  ctx.fill();
}

/**
 * How strongly a cell should blend toward a neighbouring terrain.
 *
 * Returns 0 well inside a region and rises toward the border, so the dither
 * thickens as it approaches the edge rather than switching on abruptly.
 */
export function blendAmount(
  u: number,
  v: number,
  isSelf: (u: number, v: number) => boolean,
  isOther: (u: number, v: number) => boolean,
): number {
  if (!isSelf(u, v)) return 0;

  let touching = 0;
  const neighbours: readonly [number, number][] = [
    [u + 1, v],
    [u - 1, v],
    [u, v + 1],
    [u, v - 1],
  ];

  for (const [nu, nv] of neighbours) {
    if (isOther(nu, nv)) touching += 1;
  }

  if (touching === 0) return 0;
  // Two or more touching neighbours means a corner, which should read heavier.
  return Math.min(1, 0.35 + touching * 0.22);
}
