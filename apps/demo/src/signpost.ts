/**
 * What the control plane says when someone opens its root.
 *
 * Split out of the request handler so it can be tested as a value rather than
 * asserted against the source of the file that builds it. The first version of
 * these tests grepped `live-server.ts` for strings, which would have passed
 * just as happily against a route that was never registered.
 */

export interface Signpost {
  readonly service: string;
  readonly note: string;
  readonly city: string;
  readonly routes: readonly string[];
}

/** Every route the control plane actually serves, for the signpost to list. */
export const CONTROL_PLANE_ROUTES: readonly string[] = [
  "GET  /api/health",
  "POST /api/missions",
  "POST /api/missions/:id/grant",
  "POST /api/missions/:id/deny",
  "POST /api/missions/:id/decisions",
  "POST /api/missions/:id/cancel",
  "POST /api/missions/:id/expire",
  "POST /api/missions/:id/counterfactual",
  "GET  /api/missions/:id/events",
  "GET  /api/missions/:id/record",
];

export function controlPlaneSignpost(cityPort: number): Signpost {
  return {
    service: "Scope City control plane",
    note: "This is the API. The city itself runs on the Vite dev server, not this port.",
    city: `http://127.0.0.1:${cityPort}`,
    routes: CONTROL_PLANE_ROUTES,
  };
}
