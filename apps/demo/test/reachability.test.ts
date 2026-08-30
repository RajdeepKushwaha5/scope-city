import { describe, expect, it } from "vitest";
import {
  boundarySummary,
  isLoopbackHost,
  unreachableBoundary,
} from "../src/reachability.js";

/**
 * The error this exists to stop, quoted so nobody has to guess what it looked
 * like:
 *
 *     Failed to connect to remote MCP server 'scope-city-forge-mtfb6vyc':
 *     connect ECONNREFUSED 192.168.65.254:8794
 *
 * It appeared inside TrueForge's UI, half a minute after the mission started,
 * naming a Docker gateway address nobody had typed. The cause was two
 * environment variables disagreeing, and it was knowable before anything
 * started.
 */
describe("catching a boundary the harness cannot reach", () => {
  const local = "http://127.0.0.1:8791";

  it("refuses to announce a host it is not listening for", () => {
    // The exact case that produced the ECONNREFUSED: the container resolves
    // `host.docker.internal` to the host gateway, connects, and finds nothing
    // listening on that interface because the proxy took loopback only.
    const reason = unreachableBoundary({
      bind: "127.0.0.1",
      publicHost: "host.docker.internal",
      harnessBaseUrl: local,
    });

    expect(reason).toBeDefined();
    expect(reason).toContain("SCOPE_PROXY_BIND=0.0.0.0");
  });

  it("names both ways out rather than only the one it prefers", () => {
    // An operator running the harness on this machine should move the public
    // host, not open the bind. Offering only "bind to everything" would teach
    // the wider setting as the fix for a narrower problem.
    const reason = unreachableBoundary({
      bind: "127.0.0.1",
      publicHost: "host.docker.internal",
      harnessBaseUrl: local,
    })!;

    expect(reason).toContain("SCOPE_PROXY_BIND=0.0.0.0");
    expect(reason).toContain("SCOPE_PROXY_PUBLIC_HOST=127.0.0.1");
  });

  it("catches the mirror image, where the harness is the one elsewhere", () => {
    // Same symptom, different fix: everything is loopback and correct with
    // itself, and the harness is on another host entirely.
    const reason = unreachableBoundary({
      bind: "127.0.0.1",
      publicHost: "127.0.0.1",
      harnessBaseUrl: "https://trueforge.example.test",
    });

    expect(reason).toBeDefined();
    expect(reason).toContain("trueforge.example.test");
  });

  // --- and the pairings that do work ---------------------------------------

  it("says nothing when everything is on this machine", () => {
    expect(
      unreachableBoundary({
        bind: "127.0.0.1",
        publicHost: "127.0.0.1",
        harnessBaseUrl: local,
      }),
    ).toBeUndefined();
  });

  it("says nothing when the proxy listens on every interface", () => {
    // The setup that actually works against a containerised harness, proven by
    // an HTTP 401 from inside the container: reachable, and demanding its token.
    expect(
      unreachableBoundary({
        bind: "0.0.0.0",
        publicHost: "host.docker.internal",
        harnessBaseUrl: local,
      }),
    ).toBeUndefined();
  });

  it("leaves an unparseable harness URL to the client that will report it", () => {
    // Two error messages about one mistake is worse than one.
    expect(
      unreachableBoundary({
        bind: "127.0.0.1",
        publicHost: "127.0.0.1",
        harnessBaseUrl: "not a url",
      }),
    ).toBeUndefined();
  });
});

describe("recognising an address that only answers to itself", () => {
  it("knows the loopback forms a harness is actually configured with", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
  });

  it("does not mistake the route into a container for loopback", () => {
    // Local in the colloquial sense and not in the one that matters: it is the
    // host gateway, reached across the container's network.
    expect(isLoopbackHost("host.docker.internal")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.65.254")).toBe(false);
  });
});

describe("stating the arrangement at startup", () => {
  it("says which interface, and what the harness was told", () => {
    // Three ports and two notions of localhost. The difference between a
    // working setup and the ECONNREFUSED above is invisible until it fails, so
    // it is printed while it still costs nothing to read.
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

describe("naming the settings the reader can actually change", () => {
  it("uses the caller's variable names", () => {
    // The city reads SCOPE_PROXY_BIND and the probes read PROBE_BIND. A message
    // naming the wrong one sends the reader to edit a variable that has no
    // effect on the process that just refused to start.
    const reason = unreachableBoundary({
      bind: "127.0.0.1",
      publicHost: "host.docker.internal",
      harnessBaseUrl: "http://127.0.0.1:8791",
      names: { bind: "PROBE_BIND", publicHost: "PROBE_PUBLIC_HOST" },
    })!;

    expect(reason).toContain("PROBE_BIND=0.0.0.0");
    expect(reason).toContain("PROBE_PUBLIC_HOST=127.0.0.1");
    expect(reason).not.toContain("SCOPE_PROXY_");
  });
});
