import type { WorldEvent } from "@scope-city/harness";
import type { ProxyEvent } from "@scope-city/proxy";

/** The wire contract between the server-owned mission and the browser city. */
export type CityFeedEvent =
  | { readonly type: "world"; readonly event: WorldEvent }
  | { readonly type: "proxy"; readonly event: ProxyEvent }
  | {
      readonly type: "mission.status";
      readonly status: "starting" | "running" | "completed" | "failed" | "cancelled";
      readonly detail?: string;
    }
  | { readonly type: "scope.expired"; readonly at: number };
