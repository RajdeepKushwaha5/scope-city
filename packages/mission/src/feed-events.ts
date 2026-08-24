import type { WorldEvent } from "@scope-city/harness";
import type { ProxyEvent } from "@scope-city/proxy";
import type { BacktestReport } from "@scope-city/yard";

/** The wire contract between the server-owned mission and the browser city. */
export type CityFeedEvent =
  | { readonly type: "world"; readonly event: WorldEvent }
  | { readonly type: "proxy"; readonly event: ProxyEvent }
  | {
      readonly type: "mission.status";
      readonly status: "starting" | "running" | "completed" | "failed" | "cancelled";
      readonly detail?: string;
    }
  | { readonly type: "scope.expired"; readonly at: number }
  /**
   * The Yard's verdict on the scope, emitted once before the mission starts.
   *
   * Carried on the same feed as everything else rather than fetched separately
   * so that a reconnecting browser replays it in order with the rest of the
   * mission: the findings appear before the first call, which is the only
   * sequence in which they mean anything.
   */
  | { readonly type: "yard.report"; readonly report: BacktestReport };
