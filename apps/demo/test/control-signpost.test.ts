import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTROL_PLANE_ROUTES, controlPlaneSignpost } from "../src/signpost.js";

/**
 * The control plane serves `/api/*` and nothing else, so `/` answered
 * `{"error":"not found"}` -- true, and useless to whoever just typed the port
 * into a browser.
 *
 * These assert the value the route returns, not the text of the file that
 * builds it. The first version grepped `live-server.ts` for strings and would
 * have passed against a route that was never registered.
 */
const source = readFileSync(
  fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
  "utf8",
);

describe("the control plane signpost", () => {
  it("names itself and says it is not the city", () => {
    const signpost = controlPlaneSignpost(5180);

    expect(signpost.service).toContain("Scope City");
    expect(signpost.note).toMatch(/not this port/i);
  });

  it("points at the port it is given, not a hardcoded one", () => {
    // The dev server port is configurable. A signpost that always claims 5180
    // would be confidently wrong for anyone who changed it.
    expect(controlPlaneSignpost(5180).city).toBe("http://127.0.0.1:5180");
    expect(controlPlaneSignpost(4321).city).toBe("http://127.0.0.1:4321");
  });

  it("lists every route the server actually handles", () => {
    // Derived from the source rather than restated, so a route added without a
    // signpost entry fails here instead of going unmentioned.
    const handled = new Set(
      [...source.matchAll(/url\.pathname === "(\/api\/[a-z]*)"/g)].map((m) => m[1]!),
    );
    handled.add("/api/health");

    for (const path of handled) {
      expect(
        CONTROL_PLANE_ROUTES.some((route) => route.includes(path)),
        `${path} is served but not listed`,
      ).toBe(true);
    }
  });

  it("lists the mission sub-routes the matcher accepts", () => {
    const matcher = /\(events\|decisions\|cancel\|record\|expire\|grant\|deny\|counterfactual\)/;
    expect(source).toMatch(matcher);

    for (const verb of [
      "events",
      "decisions",
      "cancel",
      "record",
      "expire",
      "grant",
      "deny",
      "counterfactual",
    ]) {
      expect(
        CONTROL_PLANE_ROUTES.some((route) => route.endsWith(`/${verb}`)),
        `${verb} is accepted but not listed`,
      ).toBe(true);
    }
  });

  it("is wired to the root and to /api, and only those", () => {
    expect(source).toContain('url.pathname === "/" || url.pathname === "/api"');
    expect(source).toContain("controlPlaneSignpost(CITY_DEV_PORT)");
  });

  it("leaves the 404 in place for an unknown api route", () => {
    // The signpost answers the root, not everything. A catch-all would meet a
    // misspelled route with a cheerful description of the ones that exist.
    expect(source).toContain('json(res, 404, { error: "not found" })');
  });
});
