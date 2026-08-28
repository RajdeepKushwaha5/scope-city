import { useEffect, useState } from "react";

/**
 * Whether a control plane is reachable at all.
 *
 * Judge mode is a static build with no server behind it, and the city was still
 * offering Dispatch as its primary control. Pressing it posts to
 * `/api/missions`, which on a static host is a 404 dressed up as a failed
 * launch -- so the most prominent thing on the page was the one thing that
 * could not work, and a visitor's first action taught them the product was
 * broken.
 *
 * Asked once on mount rather than assumed from the build, because the same
 * bundle is served locally with a control plane and publicly without one.
 * Inferring it from an environment flag would mean a local developer running
 * without the server sees a Dispatch button that lies to them too.
 */
export type ControlPlane = "checking" | "available" | "absent";

/**
 * Asks once whether a control plane answers.
 *
 * Split from the hook so it can be tested without a DOM. A truthy response is
 * not enough: a static host answers `/api/health` with its 404 page, which
 * resolves successfully and is emphatically not a control plane.
 */
/**
 * Why the probe answered as it did.
 *
 * Four distinguishable outcomes rather than a boolean, because they call for
 * different words on screen: a static host is a deployment where live missions
 * were never possible, an unwell harness is a live control plane with a real
 * problem to report, and a timeout is neither. Collapsing them meant the city
 * could only say "no backend" to all three.
 */
export type ProbeReason =
  | "control-plane"
  | "harness-unwell"
  | "not-a-control-plane"
  | "unreachable";

export interface ProbeResult {
  readonly available: boolean;
  readonly reason: ProbeReason;
}

export async function probeControlPlane(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4_000,
): Promise<ProbeResult> {
  // Aborted rather than left hanging: a host that swallows the request would
  // otherwise leave the UI in `checking` forever, which reads as a broken page
  // rather than an honest one.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await fetchImpl("/api/health", { signal: abort.signal });
    // The status is not the answer, in either direction.
    //
    // Not a pass: the deployed city rewrites unknown paths to index.html and
    // answers 200 with a page (see below). Not a fail either: the health route
    // replies 503 when the harness behind it is unreachable, and that is a
    // control plane -- an unwell one, which the operator needs the city to
    // talk to precisely so it can say what is wrong. Reading 503 as "absent"
    // would hide the live controls at the moment they explain the problem.
    //
    // So the body is what decides, whatever the status. It has to look like
    // the health route's own answer: index.html is not JSON at all, which is
    // most of the defence, and the shape check covers a host that serves a
    // JSON error page instead.
    //
    // The static case, for the record: `vercel.json` rewrites everything
    // except /replays/ and /assets/ to index.html, so the deployed city
    // answers `GET /api/health` with 200 and a page. Checking `response.ok`
    // alone reported a control plane there -- the city offered to launch live
    // missions on the one URL judges actually visit, and every one of them
    // would have posted to an endpoint returning HTML.
    const body: unknown = await response.json().catch(() => null);
    if (!isHealth(body)) return { available: false, reason: "not-a-control-plane" };

    // Present either way. `ok: false` is the control plane reporting that the
    // harness behind it is unreachable, which is a thing only a control plane
    // can tell you.
    const healthy = (body as { ok: boolean }).ok;
    return { available: true, reason: healthy ? "control-plane" : "harness-unwell" };
  } catch {
    return { available: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** The shape `GET /api/health` answers with, and nothing else. */
function isHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const health = body as { ok?: unknown; activeMissions?: unknown };
  return typeof health.ok === "boolean" && typeof health.activeMissions === "number";
}

export function useControlPlane(): ControlPlane {
  const [state, setState] = useState<ControlPlane>("checking");

  useEffect(() => {
    let cancelled = false;
    void probeControlPlane().then((result) => {
      if (!cancelled) setState(result.available ? "available" : "absent");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
