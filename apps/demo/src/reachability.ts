/**
 * Whether the harness can actually reach the boundary it is about to be told
 * about.
 *
 * Scope City registers its mission endpoint with TrueForge by URL, and TrueForge
 * then connects to that URL from wherever it happens to be running. Those are
 * two different machines' idea of "here" the moment the harness is in a
 * container, and getting them out of step produces the least helpful error in
 * the project:
 *
 *     Failed to connect to remote MCP server 'scope-city-forge-mtfb6vyc':
 *     connect ECONNREFUSED 192.168.65.254:8794
 *
 * That surfaces inside TrueForge's own UI, tens of seconds later, naming a
 * gateway address the operator has never typed, about a port that was never
 * listening on the interface the container can see. Nothing in it says the
 * cause, which is two environment variables that have to agree:
 *
 *   SCOPE_PROXY_BIND         which interface the proxy listens on
 *   SCOPE_PROXY_PUBLIC_HOST  the host TrueForge is told to connect to
 *
 * Announcing `host.docker.internal` while listening only on loopback is not a
 * transient failure to be retried. It cannot work, it is knowable before
 * anything starts, and so it is checked there instead.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Whether a host only answers to the machine it runs on. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(
    host
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, ""),
  );
}

/**
 * The reason this pairing cannot work, or `undefined` if it can.
 *
 * Deliberately one-directional: it reports the combination that is certainly
 * broken and stays quiet about the ones that merely might be. A guard that
 * refuses to start on a suspicion is a guard people learn to switch off, and
 * this one is worth keeping on.
 */
export function unreachableBoundary(params: {
  /** The interface the proxy binds, e.g. `127.0.0.1` or `0.0.0.0`. */
  readonly bind: string;
  /** The host the harness is told to connect to. */
  readonly publicHost: string;
  /** Where the harness itself is, so a local harness is not warned about. */
  readonly harnessBaseUrl: string;
  /**
   * What to call the two settings in the message.
   *
   * The city reads `SCOPE_PROXY_BIND` and the probes read `PROBE_BIND`, and an
   * error naming the wrong one sends the reader to edit a variable that has no
   * effect on the process that just refused to start. Passed in rather than
   * rewritten afterwards, because a message assembled by find-and-replace is a
   * message that breaks quietly when the wording changes.
   */
  readonly names?: { readonly bind: string; readonly publicHost: string };
}): string | undefined {
  const { bind, publicHost, harnessBaseUrl } = params;
  const bindVar = params.names?.bind ?? "SCOPE_PROXY_BIND";
  const hostVar = params.names?.publicHost ?? "SCOPE_PROXY_PUBLIC_HOST";

  // `0.0.0.0` is every interface, so nothing announced can be out of reach.
  if (!isLoopbackHost(bind)) return undefined;

  if (!isLoopbackHost(publicHost)) {
    return (
      `The boundary listens on ${bind} but announces itself as ${publicHost}, ` +
      `so whatever connects to ${publicHost} will be refused. ` +
      `Set ${bindVar}=0.0.0.0 to accept those connections, or ` +
      `${hostVar}=127.0.0.1 if the harness is on this machine.`
    );
  }

  // The mirror image: loopback everywhere, but the harness is somewhere else.
  // Worth catching because the symptom is identical and the fix is not.
  let harnessHost: string;
  try {
    harnessHost = new URL(harnessBaseUrl).hostname;
  } catch {
    // An unparseable base URL is the harness client's problem to report, and
    // reporting it here would be a second error message about a first one.
    return undefined;
  }

  if (!isLoopbackHost(harnessHost)) {
    return (
      `The boundary listens on ${bind} and announces itself as ${publicHost}, ` +
      `but the harness is at ${harnessHost}, which cannot reach either. ` +
      `Set ${bindVar}=0.0.0.0 and ${hostVar} to an address ` +
      `${harnessHost} can resolve.`
    );
  }

  return undefined;
}

/**
 * The line worth printing when it *does* line up.
 *
 * A demo run against a containerised harness has three ports and two notions of
 * localhost, and the difference between a working setup and the ECONNREFUSED
 * above is invisible until something fails. Stating it at startup makes the
 * working case checkable at a glance.
 */
export function boundarySummary(params: {
  readonly bind: string;
  readonly publicHost: string;
  readonly port: number;
}): string {
  const { bind, publicHost, port } = params;
  const where = isLoopbackHost(bind) ? "this machine only" : "every interface";
  return `Boundary: listening on ${bind}:${port} (${where}), announced to the harness as http://${publicHost}:${port}`;
}
