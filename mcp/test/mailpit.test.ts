import { describe, expect, it } from "vitest";
import { mailpitSystem } from "../src/systems/mailpit.js";
import { unreachableError } from "../src/systems/smtp.js";

/**
 * The office contract, checked without a server. Delivery itself is exercised
 * against a real Mailpit by hand; what matters here is that the office behaves
 * the same way the fixture does and does not over-report.
 */

/** A port the OS has just confirmed is free, so nothing can be listening on it. */
async function closedPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("the Mailpit-backed Post House", () => {
  const system = mailpitSystem({ host: "127.0.0.1", port: 65_535 });

  it("presents the same two offices as the fixture", () => {
    expect(system.district).toBe("post-house");
    expect(system.offices.map((o) => o.office).sort()).toEqual(["mail.list", "mail.send"]);
  });

  it("records nothing when the send fails", async () => {
    // The one direction this must not be wrong in. Pushing to the outbox before
    // the server accepts would make a failed send look delivered, and
    // `mail.list` would then confirm a message that never left.
    const send = system.offices.find((o) => o.office === "mail.send")!;
    const list = system.offices.find((o) => o.office === "mail.list")!;

    await expect(
      send.call({ to: "buyer@example.test", body: "hello" }),
    ).rejects.toThrow();

    expect(await list.call({})).toEqual({ messages: [], count: 0 });
  });

  it("requires a recipient and a body", async () => {
    const send = system.offices.find((o) => o.office === "mail.send")!;

    await expect(send.call({ body: "no recipient" })).rejects.toThrow();
    await expect(send.call({ to: "buyer@example.test" })).rejects.toThrow();
  });
});

describe("the port it is given", () => {
  it("refuses a port that is not a usable one", async () => {
    // MAILPIT_PORT comes from the environment, so it can arrive as NaN or
    // nonsense. Without this the failure is a socket error that reads like the
    // server being down rather than the configuration being wrong.
    for (const port of [Number.NaN, 0, -1, 70_000, 1.5]) {
      const send = mailpitSystem({ host: "127.0.0.1", port }).offices.find(
        (o) => o.office === "mail.send",
      )!;

      await expect(
        send.call({ to: "buyer@example.test", body: "hello" }),
        `port ${port} should be refused`,
      ).rejects.toThrow(/not a usable port/);
    }
  });

  it("does not name the mail server in an error the agent will read", async () => {
    // This error reaches the agent through a tool result. An agent that cannot
    // see the mail server should not learn its address by failing to reach it.
    //
    // A port nothing is listening on, found rather than assumed. Port 9 refuses
    // immediately on most machines and is the discard service on some, where
    // this would connect and then hang. Binding to port 0 and closing gets one
    // the OS has just confirmed free.
    //
    // Localhost rather than an unroutable address on purpose: the refusal is
    // immediate, where a blackhole makes this wait out the full connect timeout
    // and turns a unit test into a twenty-second one.
    //
    // The port is confirmed free and then released, so in principle something
    // else could claim it in the gap. That would change which error arrives --
    // a connection to something that is not an SMTP server, or a timeout --
    // and this test deliberately does not depend on which: every path out of
    // here must be free of the address. The one that names it, ECONNREFUSED,
    // is pinned exactly in the test below, which needs no port at all.
    const port = await closedPort();
    const send = mailpitSystem({ host: "127.0.0.1", port }).offices.find(
      (o) => o.office === "mail.send",
    )!;

    const error = await send
      .call({ to: "buyer@example.test", body: "hi" })
      .then(() => null)
      .catch((caught: Error) => caught);

    expect(error, "the send should have failed").not.toBeNull();
    expect(error!.message).not.toContain("127.0.0.1");
    expect(error!.message).not.toContain(String(port));
  });
});

describe("the address does not travel in the error", () => {
  /**
   * The case that made this necessary, tested on the error Node actually
   * raises rather than by arranging a refused connection. Reproducing the
   * refusal needs a port nothing is listening on, and nothing can promise a
   * port stays free between confirming it and connecting to it.
   */
  it("keeps the code and drops the address", () => {
    const refused = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:1025"),
      { code: "ECONNREFUSED", errno: -111, syscall: "connect", address: "127.0.0.1", port: 1025 },
    );

    const sanitised = unreachableError(refused);

    expect(sanitised.message).not.toContain("127.0.0.1");
    expect(sanitised.message).not.toContain("1025");
    // The operator still needs to know what went wrong. Dropping the code as
    // well would leave "could not reach the mail server" for a refusal, a
    // timeout and a DNS failure alike.
    expect(sanitised.message).toContain("ECONNREFUSED");
  });

  it("says something useful when there is no code at all", () => {
    expect(unreachableError(new Error("boom")).message).toContain("failed");
  });
});
