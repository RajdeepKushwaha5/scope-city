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
