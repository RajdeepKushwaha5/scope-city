import { pickCell } from "../iso/projection.js";
import type { Building } from "./world.js";

/**
 * Turning a click into the thing under it.
 *
 * The city was a picture: clicking resolved to a *district*, so the operator
 * could learn "this is the Exchequer" and nothing else. Every building already
 * carried the office it represents -- `Building.office` has been there since
 * the layout was written -- and the interaction layer simply threw it away.
 *
 * That is the difference between a map and an instrument. An operator deciding
 * whether to grant `charge.refund` wants to point at charge.refund, not at the
 * district it happens to sit in.
 *
 * Picking is done in grid space rather than by hit-testing drawn pixels. A
 * building occupies one cell and is drawn tall, so its painted area is not
 * where it stands -- testing the sprite would select the building behind
 * whichever roof the cursor was over. Height is handled by preferring the
 * nearest building to the viewer when two share a cell, which matches the
 * painter's order the renderer draws in.
 */

export interface PickResult {
  readonly building: Building | null;
  readonly cell: { readonly u: number; readonly v: number };
}

/**
 * The building under a screen position, if any.
 *
 * `x` and `y` are canvas coordinates with the camera transform already undone,
 * which is the caller's job because only it knows the pan and zoom.
 */
export function pickBuilding(
  buildings: readonly Building[],
  x: number,
  y: number,
): PickResult {
  const cell = pickCell(x, y);

  // A tall building's roof is drawn well above its cell, so a click on the roof
  // lands on a cell one or two north of where it stands. Rather than invert the
  // projection per height -- which needs the height to know the height -- the
  // candidates are gathered from a small band and the nearest to the viewer
  // wins, which is the same rule the painter uses.
  let best: Building | null = null;
  let bestDepth = -Infinity;

  for (const building of buildings) {
    // Raising a point by one unit of height moves it up the screen by exactly
    // the amount that moving one cell along *both* axes does, so a click on a
    // roof resolves to a cell that is `height` cells north-west of where the
    // building stands. The offset is therefore positive in this direction, and
    // equal on both axes.
    const rise = building.cell.u - cell.u;
    if (rise !== building.cell.v - cell.v) continue;
    if (rise < 0 || rise > Math.ceil(building.height) + 1) continue;

    const depth = building.cell.u + building.cell.v;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = building;
    }
  }

  return { building: best, cell };
}

/**
 * What a picked building is worth saying about.
 *
 * Filler and houses are scenery: they carry no office and mean nothing, so
 * selecting one should clear the selection rather than open an inspector about
 * a building that represents nothing. Pretending every rooftop is a capability
 * would make the metaphor noise.
 */
export function isMeaningful(building: Building | null): building is Building {
  return building !== null && building.kind === "office" && building.office !== null;
}
