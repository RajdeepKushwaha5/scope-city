import { describe, expect, it } from "vitest";
import { connect } from "node:net";
import { MissionRegistry, startProxyHttp } from "../src/index.js";

/**
 * Shutting down must finish even while something is still connected.
 *
 * `server.close()` stops accepting new connections and then waits for the open
 * ones to end on their own. For this server that is forever: an MCP session is
 * a long-lived streaming HTTP request, so the harness holding one kept the
 * close promise pending and the process alive.
 *
 * It went unnoticed because nothing waits on a shutdown in a test, and by hand
 * it reads as the demo being slow to stop rather than as never stopping. It
 * cost an afternoon in the end -- a probe that had already printed its answer
 * sat there afterwards, and twelve abandoned processes were still holding the
 * port open by the time anyone looked.
 */
describe("closing the proxy", () => {
  it("finishes while a connection is still open", async () => {
    const proxy = await startProxyHttp({
      registry: new MissionRegistry(),
      port: 0,
      host: "127.0.0.1",
      token: "t",
    });

    const address = proxy.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    // A socket that connects and then says nothing, which is what a streaming
    // MCP session looks like to the server between messages.
    const held = connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      held.once("connect", resolve);
      held.once("error", reject);
    });

    // Raced against a timer rather than awaited directly: an unfixed close
    // never settles, so awaiting it would hang the suite instead of failing it.
    const closed = proxy.close().then(() => "closed" as const);
    const timedOut = new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2_000));

    expect(await Promise.race([closed, timedOut])).toBe("closed");

    held.destroy();
  });

  it("still reports the port as free afterwards", async () => {
    // The point of closing. A shutdown that resolved while the listener stayed
    // up would pass the test above and still leave the next run unable to bind.
    const registry = new MissionRegistry();
    const first = await startProxyHttp({ registry, port: 0, host: "127.0.0.1", token: "t" });
    const address = first.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const held = connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => held.once("connect", resolve));
    await first.close();
    held.destroy();

    const second = await startProxyHttp({ registry, port, host: "127.0.0.1", token: "t" });
    expect(second.server.listening).toBe(true);
    await second.close();
  });
});

describe("starting the proxy", () => {
  it("says what is wrong when the port is taken", async () => {
    // The most likely first-run failure: starting the demo twice. Node reports
    // it as an unhandled 'error' event, so before this the process died with a
    // stack trace ending in `Server.setupListenHandle` -- which names nothing
    // the caller did and reads as the project being broken.
    const first = await startProxyHttp({
      registry: new MissionRegistry(),
      port: 0,
      host: "127.0.0.1",
      token: "t",
    });
    const address = first.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const second = startProxyHttp({
      registry: new MissionRegistry(),
      port,
      host: "127.0.0.1",
      token: "t",
    });

    await expect(second).rejects.toThrow(/already in use/);
    // And it says what to do about it, which is the part that saves the time.
    await expect(second).rejects.toThrow(/SCOPE_PROXY_PORT/);

    await first.close();
  });
});
