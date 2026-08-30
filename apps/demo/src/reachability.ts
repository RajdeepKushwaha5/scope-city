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
 * cause, which is two settings that have to agree:
 *
 *   SCOPE_PROXY_BIND         which interface the proxy listens on
 *   SCOPE_PROXY_PUBLIC_HOST  the host TrueForge is told to connect to
 *
 * Announcing `host.docker.internal` while listening only on loopback is not a
 * transient failure to be retried. It cannot work, it is knowable before
 * anything starts, and so it is checked there instead.
 *
 * Everything here reports only what it is *certain* about. A guard that refuses
 * to start on a suspicion is a guard people learn to switch off, and this one
 * is worth keeping on.
 */

/** A reachability verdict, with the reason always populated. */
export interface Reachability {
  readonly ok: boolean;
  /** Why it cannot work, or what arrangement was accepted. */
  readonly reason: string;
}

/** Addresses that mean "every interface", so nothing announced is out of reach. */
const WILDCARD = new Set(["0.0.0.0", "::", "*"]);

const LOOPBACK_V4 = "127.0.0.1";
const LOOPBACK_V6 = "::1";

/** Lower-cased and unbracketed, which is how every comparison here wants it. */
function normalise(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

/**
 * Which address family a host names, when that is knowable.
 *
 * `localhost` is deliberately `"name"` rather than IPv4: it resolves to
 * whichever family the system prefers, and on a dual-stack machine that is
 * often `::1`. Calling it IPv4 would manufacture a mismatch that does not
 * exist and refuse a setup that works.
 */
export function addressFamily(host: string): "v4" | "v6" | "name" {
  const value = normalise(host);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return "v4";
  if (value.includes(":")) return "v6";
  return "name";
}

/** Whether a host only answers to the machine it runs on. */
export function isLoopbackHost(host: string): boolean {
  const value = normalise(host);
  return (
    value === LOOPBACK_V4 || value === "localhost" || value === LOOPBACK_V6
  );
}

/** Whether a bind accepts connections on every interface. */
export function isWildcardBind(bind: string): boolean {
  const value = normalise(bind);
  return value === "" || WILDCARD.has(value);
}

/**
 * A host in the form a URL authority needs.
 *
 * An IPv6 literal has to be bracketed or its colons are read as a port
 * separator: `http://::1:8791/` is not a URL, and every boundary URL in this
 * repository is assembled by interpolation. Accepting a bare `::1` in the guard
 * while the callers built that string meant the guard passed a setup that could
 * never have registered.
 */
export function urlHost(host: string): string {
  const value = normalise(host);
  return addressFamily(value) === "v6" ? `[${value}]` : value;
}

/**
 * Whether a boundary bound to `bind` can be reached at `publicHost`.
 *
 * Three ways it certainly cannot, and everything else is accepted:
 *
 * **Loopback bind, non-loopback announcement.** The case that produced the
 * ECONNREFUSED. The container resolves `host.docker.internal`, connects to the
 * host, and finds nothing listening on the interface it reached.
 *
 * **Different loopback families.** `::1` and `127.0.0.1` are both loopback and
 * are not the same listener: a v6-only socket does not answer a v4 connection.
 * These used to be pooled together as "loopback" and the pairing passed.
 *
 * **Two different literal addresses.** A bind of `192.168.1.10` listens on
 * `192.168.1.10` and nowhere else, so announcing `192.168.1.11` is a promise
 * about a socket that does not exist. This used to be waved through, because
 * any non-loopback bind was treated as though it were a wildcard.
 *
 * Note what is deliberately *not* checked: where the harness itself runs. An
 * earlier version inferred that from `TRUEFORGE_BASE_URL`, which does not carry
 * it -- a TrueForge on this machine, reached through the machine's LAN address
 * or DNS name, would have been rejected and the process would have exited on a
 * setup that works. A client's endpoint is not an execution host.
 */
export function boundaryReachability(params: {
  /** The interface the proxy binds, e.g. `127.0.0.1` or `0.0.0.0`. */
  readonly bind: string;
  /** The host the harness is told to connect to. */
  readonly publicHost: string;
  /**
   * What to call the two settings in the reason.
   *
   * The city reads `SCOPE_PROXY_BIND` and the probes read `PROBE_BIND`, and a
   * message naming the wrong one sends the reader to edit a variable that has
   * no effect on the process that just refused to start. Passed in rather than
   * rewritten afterwards, because a message assembled by find-and-replace is a
   * message that breaks quietly when the wording changes.
   */
  readonly names?: { readonly bind: string; readonly publicHost: string };
}): Reachability {
  const { bind, publicHost } = params;
  const bindVar = params.names?.bind ?? "SCOPE_PROXY_BIND";
  const hostVar = params.names?.publicHost ?? "SCOPE_PROXY_PUBLIC_HOST";
  const open = `Set ${bindVar}=0.0.0.0 to accept those connections, or ${hostVar} to an address this listener answers on.`;

  if (isWildcardBind(bind)) {
    return {
      ok: true,
      reason: `listening on every interface, announced as ${publicHost}`,
    };
  }

  if (isLoopbackHost(bind) && !isLoopbackHost(publicHost)) {
    return {
      ok: false,
      reason:
        `The boundary listens on ${bind} but announces itself as ${publicHost}, ` +
        `so whatever connects to ${publicHost} will be refused. ` +
        `Set ${bindVar}=0.0.0.0 to accept those connections, or ` +
        `${hostVar}=127.0.0.1 if the harness is on this machine.`,
    };
  }

  const bindFamily = addressFamily(bind);
  const hostFamily = addressFamily(publicHost);

  // Only when both are literals. A name can resolve to either family, and
  // guessing which would refuse setups that work.
  if (bindFamily !== "name" && hostFamily !== "name") {
    if (bindFamily !== hostFamily) {
      return {
        ok: false,
        reason:
          `The boundary listens on ${bind} (IP${bindFamily}) and announces itself as ` +
          `${publicHost} (IP${hostFamily}). A socket on one family does not answer ` +
          `the other. ${open}`,
      };
    }

    if (normalise(bind) !== normalise(publicHost)) {
      return {
        ok: false,
        reason:
          `The boundary listens on ${bind} and nowhere else, but announces itself as ` +
          `${publicHost}, where nothing is listening. ${open}`,
      };
    }
  }

  return {
    ok: true,
    reason: `listening on ${bind}, announced as ${publicHost}`,
  };
}

/**
 * The line worth printing when it does line up.
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
  // "every interface" is true of a wildcard and of nothing else. Saying it of
  // `192.168.1.10` would describe a listener answering on one address as though
  // it answered on all of them.
  let where = "this interface only";
  if (isWildcardBind(bind)) where = "every interface";
  else if (isLoopbackHost(bind)) where = "this machine only";
  return `Boundary: listening on ${bind}:${port} (${where}), announced to the harness as http://${urlHost(publicHost)}:${port}`;
}
