import { useMemo } from "react";
import { toScreen } from "../iso/projection.js";
import { isMeaningful } from "../render/pick.js";
import { cityFor } from "../render/scene.js";
import { plotFor } from "../render/world.js";
import type { GateRequest } from "../useMission.js";

/**
 * Points at the building that is waiting.
 *
 * The countersign prompt lives in the console, bottom right. The operator is
 * looking at the map, which is where everything else in this interface happens,
 * so the one moment that actually needs a human was the one moment nothing on
 * the map changed to say so. In a live demo that reads as the run stalling.
 *
 * This is a pointer, not a second prompt. The call itself, the arguments it
 * would run with, and the two buttons stay in `GatePanel`, because a countersign
 * shown in two places is a countersign the operator can approve without having
 * read the arguments -- and the whole claim of the gate is that what is printed
 * is precisely what may execute. Duplicating that text would be the one piece of
 * UI in this project allowed to lie.
 *
 * When the building is off-screen the beacon clamps to the edge of the viewport
 * rather than vanishing. A marker that disappears exactly when the operator has
 * panned away from the thing needing attention has failed at its only job.
 */

/** How far inside the viewport a clamped beacon sits, in px. */
const EDGE_INSET = 56;

/**
 * Wider than the vertical inset, because the label is wider than the ring.
 *
 * "Countersign required" is about 150px at this size, so a marker clamped 56px
 * from the edge had half its label off screen -- the beacon pointed correctly
 * and could not be read. The horizontal clamp keeps the text on screen, not
 * just the ring.
 */
const EDGE_INSET_X = 104;

export interface BeaconPlacement {
  readonly x: number;
  readonly y: number;
  /** The building is outside the viewport and this marker has been clamped. */
  readonly offscreen: boolean;
}

/**
 * Where the marker goes, given a building and a camera.
 *
 * Split out from the component because it is the only part that can be wrong in
 * an interesting way, and a pure function can be tested without a browser.
 */
export function placeBeacon(
  world: { readonly x: number; readonly y: number },
  camera: { readonly x: number; readonly y: number; readonly zoom: number },
  size: { readonly width: number; readonly height: number },
): BeaconPlacement {
  const x = world.x * camera.zoom + size.width / 2 + camera.x;
  const y = world.y * camera.zoom + size.height / 2 + camera.y;

  // `Math.max(.. , EDGE_INSET)` on the upper bound keeps the clamp sane on a
  // viewport narrower than two insets, where the bounds would otherwise cross
  // and the marker would be pinned to the wrong edge.
  const clampedX = Math.min(
    Math.max(x, EDGE_INSET_X),
    Math.max(size.width - EDGE_INSET_X, EDGE_INSET_X),
  );
  const clampedY = Math.min(Math.max(y, EDGE_INSET), Math.max(size.height - EDGE_INSET, EDGE_INSET));

  return { x: clampedX, y: clampedY, offscreen: clampedX !== x || clampedY !== y };
}

/** The Gate district's own landmark, for a gate that names no building. */
function gateLandmark(): { u: number; v: number; height: number } | null {
  const plot = plotFor("gate");
  if (!plot) return null;
  return { u: plot.landmark.u, v: plot.landmark.v, height: 2 };
}

export function GateBeacon(props: {
  gate: GateRequest | null;
  offices: Parameters<typeof cityFor>[0];
  camera: { x: number; y: number; zoom: number };
  size: { width: number; height: number };
}): React.JSX.Element | null {
  const { gate, camera, size } = props;

  const placed = useMemo(() => {
    if (!gate) return null;

    const building = cityFor(props.offices).buildings.find(
      (candidate) => isMeaningful(candidate) && candidate.office === gate.office,
    );

    // A gate whose office does not name a building still holds the mission.
    //
    // The live event contract allows a null office, and `reduceLiveCity` turns
    // that into the literal string "unknown tool" while keeping the gate
    // active. An exact-match lookup finds no building for it, and returning
    // null here meant the beacon vanished in precisely the case it exists for:
    // a countersign is being waited on and the map says nothing.
    //
    // The Gate district is the honest fallback. It cannot say which office,
    // because nothing knows, but it can say that something is being held and
    // where the operator should look.
    const cell = building
      ? { u: building.cell.u, v: building.cell.v, height: building.height }
      : gateLandmark();
    if (!cell) return null;

    // The inverse of App's `toWorld`: world space through the camera.
    return placeBeacon(toScreen(cell.u, cell.v, cell.height), camera, size);
  }, [gate, props.offices, camera, size]);

  if (!gate || !placed) return null;

  return (
    <div
      className={`gate-beacon${placed.offscreen ? " gate-beacon--offscreen" : ""}`}
      style={{ left: placed.x, top: placed.y }}
      /* Announced once, by the panel that owns the decision. This is scenery
         pointing at it, so it stays out of the accessibility tree entirely
         rather than reading a second, competing alert. */
      aria-hidden="true"
    >
      <div className="gate-beacon__ring" />
      <div className="gate-beacon__label">
        Countersign required
        {placed.offscreen ? <span className="gate-beacon__away"> · off screen</span> : null}
      </div>
    </div>
  );
}
