import { describe, expect, it } from "vitest";
import { mailpitSystem } from "../src/systems/mailpit.js";

/**
 * The office contract, checked without a server. Delivery itself is exercised
 * against a real Mailpit by hand; what matters here is that the office behaves
 * the same way the fixture does and does not over-report.
 */
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

  it("does not name the mail server in a timeout the agent will read", async () => {
    // This error reaches the agent through a tool result. An agent that cannot
    // see the mail server should not learn its address by failing to reach it.
    const send = mailpitSystem({ host: "192.0.2.1", port: 1025 }).offices.find(
      (o) => o.office === "mail.send",
    )!;

    await expect(send.call({ to: "buyer@example.test", body: "hi" })).rejects.toThrow();
    await send.call({ to: "buyer@example.test", body: "hi" }).catch((error: Error) => {
      expect(error.message).not.toContain("192.0.2.1");
      expect(error.message).not.toContain("1025");
    });
  }, 30_000);
});
