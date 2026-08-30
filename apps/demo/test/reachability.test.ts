import { describe, expect, it } from "vitest";
import {
  addressFamily,
  boundaryReachability,
  boundarySummary,
  isLoopbackHost,
  isWildcardBind,
  urlHost,
} from "../src/reachability.js";

/**
 * The error this exists to stop, quoted so nobody has to guess what it was:
 *
 *     Failed to connect to remote MCP server 'scope-city-forge-mtfb6vyc':
 *     connect ECONNREFUSED 192.168.65.254:8794
 *
 * It appeared inside TrueForge's UI, half a minute after the mission started,
 * naming a Docker gateway address nobody had typed. The cause was two settings
 * disagreeing, and it was knowable before anything started.
 */
describe("catching a boundary the harness cannot reach", () => {
  /*
   * Every test above the line is a pairing that certainly cannot work. The
   * guard is deliberately one-directional: it refuses what it is sure about and
   * stays quiet about the rest, because a guard that refuses on a suspicion is
   * a guard people learn to switch off.
   */

  it("refuses to announce a host it is not listening for", () => {
    // The exact case that produced the ECONNREFUSED: the container resolves
    // `host.docker.internal`, connects to the host, and finds nothing listening
    // on the interface it reached, because the proxy took loopback only.
    const verdict = boundaryReachability({
      bind: "127.0.0.1",
      publicHost: "host.docker.internal",
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("SCOPE_PROXY_BIND=0.0.0.0");
  });

  it("does not treat the two loopback families as one listener", () => {
    // Both are loopback and they are not the same socket: a v6-only listener
    // does not answer a v4 connection. Pooling them as "loopback" passed this.
    expect(
      boundaryReachability({ bind: "::1", publicHost: "127.0.0.1" }).ok,
    ).toBe(false);
    expect(
      boundaryReachability({ bind: "127.0.0.1", publicHost: "::1" }).ok,
    ).toBe(false);
  });

  it("does not treat a specific interface as though it were a wildcard", () => {
    // A bind of 192.168.1.10 listens there and nowhere else, so announcing
    // .11 promises a socket that does not exist. Every non-loopback bind used
    // to be waved through as if it were 0.0.0.0.
    const verdict = boundaryReachability({
      bind: "192.168.1.10",
      publicHost: "192.168.1.11",
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("nowhere else");
  });

  it("names the settings the reader can actually change", () => {
    // The city reads SCOPE_PROXY_BIND and the probes read PROBE_BIND. Naming
    // the wrong one sends the reader to edit a variable with no effect on the
    // process that just refused to start.
    const verdict = boundaryReachability({
      bind: "127.0.0.1",
      publicHost: "host.docker.internal",
      names: { bind: "PROBE_BIND", publicHost: "PROBE_PUBLIC_HOST" },
    });

    expect(verdict.reason).toContain("PROBE_BIND=0.0.0.0");
    expect(verdict.reason).toContain("PROBE_PUBLIC_HOST=127.0.0.1");
    expect(verdict.reason).not.toContain("SCOPE_PROXY_");
  });

  // --- and the pairings it must not refuse ---------------------------------

  it("says nothing when everything is on this machine", () => {
    expect(
      boundaryReachability({ bind: "127.0.0.1", publicHost: "127.0.0.1" }).ok,
    ).toBe(true);
  });

  it("says nothing when the proxy listens on every interface", () => {
    // The arrangement that actually works against a containerised harness,
    // proven by an HTTP 401 from inside the container: reachable, and asking
    // for its token.
    expect(
      boundaryReachability({
        bind: "0.0.0.0",
        publicHost: "host.docker.internal",
      }).ok,
    ).toBe(true);
    expect(
      boundaryReachability({ bind: "::", publicHost: "host.docker.internal" })
        .ok,
    ).toBe(true);
  });

  it("does not guess a family for a name that could be either", () => {
    // `localhost` resolves to whichever family the system prefers, often ::1 on
    // a dual-stack machine. Calling it IPv4 would invent a mismatch and refuse
    // a setup that works.
    expect(
      boundaryReachability({ bind: "localhost", publicHost: "127.0.0.1" }).ok,
    ).toBe(true);
    expect(
      boundaryReachability({ bind: "::1", publicHost: "localhost" }).ok,
    ).toBe(true);
  });

  it("does not infer where the harness runs from the URL used to reach it", () => {
    /*
     * An earlier version took a non-loopback `TRUEFORGE_BASE_URL` to mean the
     * harness was on another machine, and exited 2. But a TrueForge on *this*
     * machine is routinely reached through its LAN address or DNS name, and
     * that setup works: a loopback boundary is reachable from a local harness
     * however the client addresses its API.
     *
     * A client's endpoint is not an execution host, so this no longer looks at
     * one. The signature not accepting a base URL is the assertion.
     */
    expect(
      boundaryReachability({ bind: "127.0.0.1", publicHost: "127.0.0.1" }).ok,
    ).toBe(true);
  });
});

describe("recognising the shape of an address", () => {
  it("does not mistake the route into a container for loopback", () => {
    // Local in the colloquial sense and not in the one that matters: it is the
    // host gateway, reached across the container's network.
    expect(isLoopbackHost("host.docker.internal")).toBe(false);
    expect(isLoopbackHost("192.168.65.254")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("does not call a specific interface a wildcard", () => {
    expect(isWildcardBind("192.168.1.10")).toBe(false);
    expect(isWildcardBind("127.0.0.1")).toBe(false);
  });

  it("only claims a family when the host states one", () => {
    expect(addressFamily("localhost")).toBe("name");
    expect(addressFamily("host.docker.internal")).toBe("name");
  });

  // --- and what it does recognise ------------------------------------------

  it("knows the loopback forms a harness is configured with", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
  });

  it("knows the wildcards", () => {
    expect(isWildcardBind("0.0.0.0")).toBe(true);
    expect(isWildcardBind("::")).toBe(true);
    expect(isWildcardBind("")).toBe(true);
  });

  it("reads the families from literals", () => {
    expect(addressFamily("127.0.0.1")).toBe("v4");
    expect(addressFamily("::1")).toBe("v6");
    expect(addressFamily("[::1]")).toBe("v6");
  });
});

describe("putting a host into a URL", () => {
  it("brackets an IPv6 literal", () => {
    /*
     * `http://::1:8791/` is not a URL -- the colons are read as a port
     * separator. Every boundary URL here is assembled by interpolation, so a
     * guard that accepted a bare `::1` passed a setup that could never have
     * registered with the harness.
     */
    expect(urlHost("::1")).toBe("[::1]");
    expect(`http://${urlHost("::1")}:8791`).toBe("http://[::1]:8791");
    expect(() => new URL(`http://${urlHost("::1")}:8791/mcp`)).not.toThrow();
  });

  it("does not double-bracket one that already is", () => {
    expect(urlHost("[::1]")).toBe("[::1]");
  });

  it("leaves names and IPv4 alone", () => {
    expect(urlHost("host.docker.internal")).toBe("host.docker.internal");
    expect(urlHost("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("stating the arrangement at startup", () => {
  it("does not call a specific interface every interface", () => {
    // Saying "every interface" of 192.168.1.10 describes a listener answering
    // on one address as though it answered on all of them.
    expect(
      boundarySummary({
        bind: "192.168.1.10",
        publicHost: "192.168.1.10",
        port: 8791,
      }),
    ).toContain("this interface only");
  });

  it("says which interface, and what the harness was told", () => {
    const line = boundarySummary({
      bind: "0.0.0.0",
      publicHost: "host.docker.internal",
      port: 8791,
    });
    expect(line).toContain("0.0.0.0:8791");
    expect(line).toContain("every interface");
    expect(line).toContain("http://host.docker.internal:8791");
  });

  it("distinguishes a boundary only this machine can reach", () => {
    expect(
      boundarySummary({
        bind: "127.0.0.1",
        publicHost: "127.0.0.1",
        port: 8791,
      }),
    ).toContain("this machine only");
  });
});

describe("refusing a bind Node cannot listen on", () => {
  /*
   * The preflight exists to catch a listener that will not exist. Accepting a
   * value `server.listen` rejects means the operator gets a startup error from
   * inside the listener instead of the diagnosis this file was written to give.
   */

  it("refuses a bracketed bind", () => {
    // Brackets are required in a URL authority and rejected as a listen host.
    // The comparisons here strip them, so `[::]` used to pass.
    const verdict = boundaryReachability({
      bind: "[::]",
      publicHost: "127.0.0.1",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("Use ::");
  });

  it("refuses a bracketed loopback bind too", () => {
    expect(boundaryReachability({ bind: "[::1]", publicHost: "::1" }).ok).toBe(
      false,
    );
  });

  it("does not accept a star as a wildcard", () => {
    // Node wants a numeric IP literal. `*` is a shell habit, not an address.
    expect(isWildcardBind("*")).toBe(false);
  });

  // --- and the wildcards that do work --------------------------------------

  it("accepts the two Node actually takes", () => {
    expect(isWildcardBind("0.0.0.0")).toBe(true);
    expect(isWildcardBind("::")).toBe(true);
  });
});
