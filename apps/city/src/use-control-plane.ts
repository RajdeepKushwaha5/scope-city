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
  /**
   * The models this control plane will actually rotate over, when it says.
   *
   * Null where there is nothing to ask -- a static deployment, or a server too
   * old to report them. The city has to be able to tell "four models" from "I
   * do not know", because the panel used to assert the first while knowing
   * neither.
   */
  readonly models: readonly string[] | null;
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
    // Read separately from the shape check, because the two failures are
    // different facts. A body that parses and does not match is a host that
    // answered something else; a body that never arrives is a host that stopped
    // talking -- and the abort fires here too, when the headers came back and
    // the body then stalled. Folding both into "not a control plane" reported a
    // stalled connection as a static site.
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      const stalled = cause instanceof Error && cause.name === "AbortError";
      return { available: false, reason: stalled ? "unreachable" : "not-a-control-plane", models: null };
    }
    if (!isHealth(body)) return { available: false, reason: "not-a-control-plane", models: null };

    // Present either way. `ok: false` is the control plane reporting that the
    // harness behind it is unreachable, which is a thing only a control plane
    // can tell you.
    const healthy = (body as { ok: boolean }).ok;
    return {
      available: true,
      reason: healthy ? "control-plane" : "harness-unwell",
      models: modelsIn(body),
    };
  } catch {
    return { available: false, reason: "unreachable", models: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The rotation the health body reports, if it reports one.
 *
 * Null rather than an empty array when the field is missing, because "this
 * server did not say" and "this server rotates over nothing" are different
 * facts and the panel says different things about them. A server that has no
 * rotation candidates is a real state -- a machine with only a local model
 * registered discovers none -- and it should read as that rather than as
 * silence.
 */
function modelsIn(body: unknown): readonly string[] | null {
  const models = (body as { models?: { rotation?: unknown } }).models;
  if (typeof models !== "object" || models === null) return null;
  const rotation = (models as { rotation?: unknown }).rotation;
  if (!Array.isArray(rotation)) return null;
  return rotation.filter((name): name is string => typeof name === "string");
}

/** The shape `GET /api/health` answers with, and nothing else. */
function isHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const health = body as { ok?: unknown; activeMissions?: unknown };
  return typeof health.ok === "boolean" && typeof health.activeMissions === "number";
}

export function useControlPlane(): { state: ControlPlane; models: readonly string[] | null } {
  const [state, setState] = useState<ControlPlane>("checking");
  // What the server said it would rotate over, or null if there was nobody to
  // ask. The panel needs the difference: it used to assert a model and a count
  // while knowing neither.
  const [models, setModels] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void probeControlPlane().then((result) => {
      if (cancelled) return;
      setState(result.available ? "available" : "absent");
      setModels(result.models);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, models };
}
