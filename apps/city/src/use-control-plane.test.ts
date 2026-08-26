import { describe, expect, it } from "vitest";
import { probeControlPlane } from "./use-control-plane.js";

/**
 * The published site has no server behind it, and the city was still offering
 * Dispatch as its primary control. Pressing it posts to `/api/missions`, which
 * on a static host is a 404 dressed up as a failed launch -- so the most
 * prominent thing on the page was the one thing that could not work, and a
 * visitor's first action taught them the product was broken.
 */
const respond = (init: { ok: boolean }) =>
  (async () => init as Response) as unknown as typeof fetch;

describe("probeControlPlane", () => {
  it("reports available when the health check answers", async () => {
    expect(await probeControlPlane(respond({ ok: true }))).toBe("available");
  });

  it("reports absent when a static host answers with its 404 page", async () => {
    // The case that matters on Pages. Something replies, and it is emphatically
    // not a control plane: a truthy response is not a working backend.
    expect(await probeControlPlane(respond({ ok: false }))).toBe("absent");
  });

  it("reports absent when nothing is listening", async () => {
    const refuse = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probeControlPlane(refuse)).toBe("absent");
  });

  it("gives up rather than hanging", async () => {
    // A host that accepts the connection and never answers would otherwise
    // leave the UI in `checking` forever, which reads as a broken page rather
    // than an honest one.
    const hang = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    expect(await probeControlPlane(hang, 20)).toBe("absent");
  });
});
