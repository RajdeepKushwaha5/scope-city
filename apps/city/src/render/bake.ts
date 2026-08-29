/**
 * Sprite baking.
 *
 * Drawing a detailed building costs forty-odd canvas operations. Doing that for
 * four hundred buildings every frame is what caps how much detail the city can
 * afford, so each distinct structure is drawn once into its own offscreen
 * canvas and blitted thereafter. Detail then costs nothing at runtime, which is
 * what lets a roof carry an air-conditioning unit and a stairwell instead of
 * being a flat lid.
 *
 * The cache key has to name everything that changes the pixels. Miss one and
 * two different buildings share a sprite, which shows up as a whole district
 * wearing the same roof.
 */

export interface Baked {
  readonly canvas: HTMLCanvasElement;
  /** Pixel ratio used while this sprite was baked. */
  readonly dpr: number;
  /**
   * Where the sprite's origin sits inside its own canvas. Blitting subtracts
   * this, so callers position by the world anchor and never think in texture
   * coordinates.
   */
  readonly originX: number;
  readonly originY: number;
}

const cache = new Map<string, Baked>();

/**
 * Draws `paint` once into an offscreen canvas of the given size and returns it.
 *
 * `paint` receives a context already translated so that (0, 0) is the sprite's
 * world anchor -- the centre of the tile it stands on. Drawing code is then
 * identical whether it is being baked or drawn straight to the screen.
 */
export function bake(
  key: string,
  width: number,
  height: number,
  originX: number,
  originY: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Baked {
  const existing = cache.get(key);
  if (existing) return existing;

  const canvas = document.createElement("canvas");
  // Bake at device resolution so a zoomed-in sprite is not soft. Capped at 2:
  // beyond that the memory cost outruns the visible gain.
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not create a baking context");

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  ctx.translate(originX, originY);
  paint(ctx);

  const baked: Baked = { canvas, dpr, originX: originX * dpr, originY: originY * dpr };
  cache.set(key, baked);
  return baked;
}

/** Blits a baked sprite so its anchor lands on (x, y). */
export function blit(
  ctx: CanvasRenderingContext2D,
  baked: Baked,
  x: number,
  y: number,
): void {
  const { dpr } = baked;
  ctx.drawImage(
    baked.canvas,
    x - baked.originX / dpr,
    y - baked.originY / dpr,
    baked.canvas.width / dpr,
    baked.canvas.height / dpr,
  );
}
