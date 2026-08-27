import { describe, expect, it } from "vitest";
import { encodeHeader, renderMessage, replyCode, stuffBody } from "../src/systems/smtp.js";

/**
 * The three things a hand-written SMTP client gets wrong, and one of them fails
 * silently: a body that truncates itself while the send still reports success.
 */
describe("dot-stuffing", () => {
  it("escapes a line that would end the DATA section", () => {
    // A bare "." terminates DATA. Sent unescaped, everything after it is
    // discarded and the server still answers 250 -- a truncated message that
    // looks delivered.
    expect(stuffBody("before\n.\nafter")).toBe("before\r\n..\r\nafter");
  });

  it("escapes a line that merely starts with a dot", () => {
    expect(stuffBody(".hidden")).toBe("..hidden");
  });

  it("leaves a dot mid-line alone", () => {
    expect(stuffBody("$49.00 refunded")).toBe("$49.00 refunded");
  });

  it("does not double CRLF that is already there", () => {
    // A body assembled on Windows may already use CRLF. Appending another \r
    // per line would put blank lines through the whole message.
    expect(stuffBody("one\r\ntwo")).toBe("one\r\ntwo");
  });

  it("uses CRLF, because a server may reject bare newlines", () => {
    expect(stuffBody("a\nb")).toBe("a\r\nb");
  });
});

describe("header encoding", () => {
  it("leaves plain ASCII readable rather than encoding it needlessly", () => {
    expect(encodeHeader("Refund issued for order 184")).toBe("Refund issued for order 184");
  });

  it("encodes anything outside ASCII as an RFC 2047 word", () => {
    const encoded = encodeHeader("Refund issued — café ☕");

    expect(encoded.startsWith("=?UTF-8?B?")).toBe(true);
    expect(encoded.endsWith("?=")).toBe(true);
    // Round-trips: the point is that the subject survives, not that it is short.
    const body = encoded.slice("=?UTF-8?B?".length, -"?=".length);
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Refund issued — café ☕");
  });
});

describe("the rendered message", () => {
  const message = {
    from: "scope-city@example.test",
    to: "buyer@example.test",
    subject: "Refund issued",
    body: "Your refund has been issued.",
  };

  it("carries the headers a catcher needs to file it", () => {
    const rendered = renderMessage(message, new Date(0));

    expect(rendered).toContain("From: scope-city@example.test");
    expect(rendered).toContain("To: buyer@example.test");
    expect(rendered).toContain("Subject: Refund issued");
    expect(rendered).toContain('Content-Type: text/plain; charset="utf-8"');
  });

  it("separates headers from body with exactly one blank line", () => {
    // Two blank lines put the first body line into the headers; none makes the
    // whole message a header block.
    const rendered = renderMessage(message, new Date(0));
    expect(rendered).toContain('Content-Transfer-Encoding: 8bit\r\n\r\nYour refund');
  });

  it("ends every line with CRLF", () => {
    const rendered = renderMessage(message, new Date(0));
    expect(rendered.split("\r\n").join("")).not.toContain("\n");
  });
});

describe("reading replies", () => {
  it("reads the code off a reply", () => {
    expect(replyCode("250 OK")).toBe(250);
    expect(replyCode("354 End data with <CR><LF>.<CR><LF>")).toBe(354);
    expect(replyCode("550 no such user")).toBe(550);
  });
});
