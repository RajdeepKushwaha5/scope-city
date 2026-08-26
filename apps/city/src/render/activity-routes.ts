import type { Cell } from "../iso/projection.js";
import { plotFor, type Building } from "./world.js";

export type RouteActivity = "working" | "waiting" | "refused";

export interface ActivityRoute {
  readonly office: string;
  readonly activity: RouteActivity;
  readonly from: Cell;
  readonly to: Cell;
}

/**
 * Turns authoritative office runtime state into routes the renderer can draw.
 * Idle and completed offices deliberately produce no traffic: every moving
 * crew on the map corresponds to a tool call that is active right now.
 */
export function planActivityRoutes(
  buildings: readonly Building[],
  runtime: ReadonlyMap<string, { readonly activity: string }> | undefined,
): readonly ActivityRoute[] {
  if (!runtime) return [];

  const routes: ActivityRoute[] = [];
  for (const building of buildings) {
    if (!building.office || !building.district) continue;
    const activity = runtime.get(building.office)?.activity;
    if (activity !== "working" && activity !== "waiting" && activity !== "refused") continue;
    const plot = plotFor(building.district);
    if (!plot) continue;
    routes.push({
      office: building.office,
      activity,
      from: plot.landmark,
      to: building.cell,
    });
  }
  return routes;
}
