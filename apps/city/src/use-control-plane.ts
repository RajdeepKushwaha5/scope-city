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
export async function probeControlPlane(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4_000,
): Promise<"available" | "absent"> {
  // Aborted rather than left hanging: a host that swallows the request would
  // otherwise leave the UI in `checking` forever, which reads as a broken page
  // rather than an honest one.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await fetchImpl("/api/health", { signal: abort.signal });
    return response.ok ? "available" : "absent";
  } catch {
    return "absent";
  } finally {
    clearTimeout(timer);
  }
}

export function useControlPlane(): ControlPlane {
  const [state, setState] = useState<ControlPlane>("checking");

  useEffect(() => {
    let cancelled = false;
    void probeControlPlane().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
