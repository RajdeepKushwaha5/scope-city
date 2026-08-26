/**
 * Where the map tooltip goes, given a cursor and a viewport.
 *
 * It used to be `left: x + 14, top: y + 14` with nothing else. The tooltip is
 * `position: fixed` and up to 280px wide, so hovering a building near the right
 * or bottom edge pushed it past the viewport and the operator got a panel they
 * could not read about the building they had just pointed at -- worst at the
 * edges, which is exactly where someone pans to look at the city limits.
 *
 * Flipping to the other side of the cursor rather than clamping to the edge is
 * deliberate. A clamped tooltip sits under the pointer and covers the thing it
 * describes; a flipped one stays beside it. Clamping is the fallback for a
 * viewport too small for either side to fit.
 */

/** Matches `.map-tooltip` in hud.css. Overshooting only flips slightly early. */
export const TOOLTIP_MAX_WIDTH = 280;
export const TOOLTIP_ESTIMATED_HEIGHT = 92;

/** How far from the cursor the tooltip sits, on whichever side it lands. */
const OFFSET = 14;

/** Keeps the tooltip off the very edge when even the flip does not fit. */
const MARGIN = 8;

export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
  /** True when the tooltip sits left of or above the cursor. */
  readonly flippedX: boolean;
  readonly flippedY: boolean;
}

export function placeTooltip(
  cursor: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  box: { readonly width: number; readonly height: number } = {
    width: TOOLTIP_MAX_WIDTH,
    height: TOOLTIP_ESTIMATED_HEIGHT,
  },
): TooltipPlacement {
  const flippedX = cursor.x + OFFSET + box.width > size.width;
  const flippedY = cursor.y + OFFSET + box.height > size.height;

  const left = flippedX ? cursor.x - OFFSET - box.width : cursor.x + OFFSET;
  const top = flippedY ? cursor.y - OFFSET - box.height : cursor.y + OFFSET;

  // Clamped after flipping, for the viewport where neither side fits. Without
  // this a flip near the left edge moves the tooltip off the *other* side,
  // which is the bug rather than the fix.
  return {
    left: Math.min(Math.max(left, MARGIN), Math.max(size.width - box.width - MARGIN, MARGIN)),
    top: Math.min(Math.max(top, MARGIN), Math.max(size.height - box.height - MARGIN, MARGIN)),
    flippedX,
    flippedY,
  };
}
