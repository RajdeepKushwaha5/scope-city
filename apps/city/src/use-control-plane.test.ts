import { describe, expect, it } from "vitest";
import { probeControlPlane } from "./use-control-plane.js";

/**
 * The published site has no server behind it, and the city was still offering
 * Dispatch as its primary control. Pressing it posts to `/api/missions`, which
 * on a static host is a 404 dressed up as a failed launch -- so the most
 * prominent thing on the page was the one thing that could not work, and a
 * visitor's first action taught them the product was broken.
 *
 * The first fix asked whether anything answered. That was not enough, and the
 * deployment config says why: `vercel.json` rewrites everything except
 * /replays/ and /assets/ to index.html, so the published city answers
 * `GET /api/health` with **200 and a page**. A status-only check reported a
 * control plane on exactly the URL judges visit.
 */

/** A host that answers with a status, a content type, and a body. */
const serving = (status: number, body: unknown, json = true) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!json) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    }) as unknown as Response) as unknown as typeof fetch;

const HEALTH = { ok: true, harness: { ok: true }, activeMissions: 0 };

describe("probeControlPlane", () => {
  it("reports available for the health route's own answer", async () => {
    expect(await probeControlPlane(serving(200, HEALTH))).toEqual({ available: true, reason: "control-plane" });
  });

  it("reports available when the harness is unwell, which the route answers 503", async () => {
    // The status this test used to fake was 200, and the route does not send
    // one: `json(res, harness.ok ? 200 : 503, ...)`. So the assertion passed
    // against a response the server never produces, while the code returned
    // "absent" for the real thing -- hiding the live controls at exactly the
    // moment they would have explained why the harness was unreachable.
    expect(
      await probeControlPlane(serving(503, { ok: false, harness: { ok: false }, activeMissions: 0 })),
    ).toEqual({ available: true, reason: "harness-unwell" });
  });

  it("reports absent when a static host rewrites the path to index.html", async () => {
    // The bug this exists for. 200, and emphatically not a control plane:
    // proven against a server mimicking the vercel.json rewrite, which returned
    // `text/html` and the built page.
    expect(await probeControlPlane(serving(200, null, false))).toEqual({ available: false, reason: "not-a-control-plane" });
  });

  it("reports absent when a host serves a JSON error page with a 200", async () => {
    // Some hosts answer unknown paths with JSON rather than HTML, so parsing
    // successfully is not the test either -- the shape has to match.
    expect(await probeControlPlane(serving(200, { error: "not found" }))).toEqual({ available: false, reason: "not-a-control-plane" });
  });

  it("reports absent when a static host answers with its 404 page", async () => {
    expect(await probeControlPlane(serving(404, { error: "not found" }))).toEqual({ available: false, reason: "not-a-control-plane" });
  });

  it("distinguishes a static host from a host that is not there", async () => {
    // Both are "no live missions", and they are not the same fact: one is a
    // deployment where this was never possible, the other is something that
    // should be running and is not. Reporting them identically left the city
    // able to say only "no backend" to both.
    const staticHost = await probeControlPlane(serving(200, null, false));
    const nothing = await probeControlPlane((async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);

    expect(staticHost.reason).toBe("not-a-control-plane");
    expect(nothing.reason).toBe("unreachable");
  });

  it("reports absent when nothing is listening", async () => {
    const refuse = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probeControlPlane(refuse)).toEqual({ available: false, reason: "unreachable" });
  });

  it("calls a stalled body unreachable, not a static host", async () => {
    // The headers arrive and the body never does. Both failures used to land on
    // the same branch, so a connection that died halfway was reported as a
    // deployment with no backend -- two different problems, one wrong answer.
    const stall = ((_url: string, init?: { signal?: AbortSignal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      } as unknown as Response)) as unknown as typeof fetch;

    expect(await probeControlPlane(stall, 20)).toEqual({
      available: false,
      reason: "unreachable",
    });
  });

  it("gives up rather than hanging", async () => {
    // A host that accepts the connection and never answers would otherwise
    // leave the UI in `checking` forever, which reads as a broken page rather
    // than an honest one.
    const hang = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    expect(await probeControlPlane(hang, 20)).toEqual({ available: false, reason: "unreachable" });
  });
});
