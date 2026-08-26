import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The control plane serves `/api/*` and nothing else, so `/` answered
 * `{"error":"not found"}` -- true, and useless to whoever just typed the port
 * into a browser. The city runs elsewhere and a bare 404 gives no way to work
 * that out.
 */
const source = readFileSync(
  fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
  "utf8",
);

describe("the control plane says what it is", () => {
  it("answers the root rather than 404ing it", () => {
    expect(source).toContain('url.pathname === "/" || url.pathname === "/api"');
  });

  it("points at the city rather than only naming itself", () => {
    // Naming the service without saying where the UI is would leave the reader
    // exactly where the 404 did.
    expect(source).toContain("CITY_DEV_PORT");
    expect(source).toMatch(/city:\s*`http/);
  });

  it("takes the city port from the environment rather than hardcoding it", () => {
    // The dev server port is configurable; a signpost that always claims 5180
    // would be confidently wrong for anyone who changed it.
    expect(source).toContain("SCOPE_CITY_PORT");
  });

  it("still 404s an unknown api route", () => {
    // The signpost is for the root, not a catch-all that swallows typos.
    expect(source).toContain('json(res, 404, { error: "not found" })');
  });
});
