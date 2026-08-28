import { describe, expect, it } from "vitest";
import {
  assertSafeAddress,
  encodeHeader,
  renderMessage,
  assertSafeHeaderValue,
  replyCode,
  stuffBody,
} from "../src/systems/smtp.js";

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

describe("addresses cannot carry commands", () => {
  it("refuses a recipient containing CRLF", () => {
    // The envelope writes this into a command line. A newline ends it and
    // starts another, and one extra RCPT TO adds a silent second recipient.
    expect(() =>
      assertSafeAddress("buyer@example.test>\r\nRCPT TO:<attacker@evil.test", "to"),
    ).toThrow(/newlines or angle brackets/);
  });

  it("refuses a bare newline and a null byte too", () => {
    expect(() => assertSafeAddress("a@b.test\nRCPT TO:<c@d.test", "to")).toThrow();
    expect(() => assertSafeAddress("a@b.test\0", "to")).toThrow();
  });

  it("refuses an address bringing its own angle brackets", () => {
    // The envelope supplies them; one arriving inside the value can close the
    // pair early and leave the rest outside it.
    expect(() => assertSafeAddress("<a@b.test>", "to")).toThrow();
  });

  it("refuses something that is not an address at all", () => {
    expect(() => assertSafeAddress("not-an-address", "to")).toThrow(/is not an address/);
    expect(() => assertSafeAddress("", "to")).toThrow();
    expect(() => assertSafeAddress(`${"a".repeat(320)}@b.test`, "to")).toThrow();
  });

  it("accepts the addresses this demo actually uses", () => {
    expect(() => assertSafeAddress("buyer@example.test", "to")).not.toThrow();
    expect(() => assertSafeAddress("scope-city@example.test", "from")).not.toThrow();
  });
});

describe("long non-ASCII subjects", () => {
  it("folds into several encoded words rather than one oversized one", () => {
    // An encoded word may not exceed 75 characters including its wrapper. One
    // long word is accepted by some servers and silently mangled by others.
    const encoded = encodeHeader(`Refund issued — ${"café ☕ ".repeat(12)}`);

    expect(encoded).toContain("\r\n ");
    for (const word of encoded.split("\r\n ")) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a multi-byte character across words", () => {
    // Splitting by byte would cut a character in half and deliver a
    // replacement glyph. Each word must decode back to valid text.
    const original = "☕".repeat(40);
    const decoded = encodeHeader(original)
      .split("\r\n ")
      .map((word) => Buffer.from(word.slice("=?UTF-8?B?".length, -"?=".length), "base64"))
      .map((buf) => buf.toString("utf8"))
      .join("");

    expect(decoded).toBe(original);
    expect(decoded).not.toContain("\uFFFD");
  });

  it("still leaves a short ASCII subject completely alone", () => {
    expect(encodeHeader("Refund issued")).toBe("Refund issued");
  });
});

describe("what lands in an inbox", () => {
  const base = {
    from: "scope-city@example.test",
    to: "buyer@example.test",
    subject: "Your refund for order #184",
    body: "We have refunded $49.00.",
  };

  it("shows a sender name rather than a bare address", () => {
    const rendered = renderMessage({ ...base, fromName: "Scope City" }, new Date(0));
    expect(rendered).toContain("From: Scope City <scope-city@example.test>");
  });

  it("falls back to the address when no name is given", () => {
    expect(renderMessage(base, new Date(0))).toContain("From: scope-city@example.test");
  });

  it("stamps the mission and scope onto the message", () => {
    // A message in an inbox is otherwise just a message. These are what let
    // someone holding the record match the two up.
    const rendered = renderMessage(
      { ...base, trace: { "X-Scope-City-Mission": "m_abc", "X-Scope-City-Scope": "SC-1" } },
      new Date(0),
    );

    expect(rendered).toContain("X-Scope-City-Mission: m_abc");
    expect(rendered).toContain("X-Scope-City-Scope: SC-1");
  });

  it("keeps trace headers above the blank line, not in the body", () => {
    const rendered = renderMessage({ ...base, trace: { "X-A": "1" } }, new Date(0));
    const [headers, body] = rendered.split("\r\n\r\n");

    expect(headers).toContain("X-A: 1");
    expect(body).not.toContain("X-A");
  });

  it("refuses a trace value carrying a newline", () => {
    // A header is another place a line break splits a line and adds one nobody
    // wrote -- the same hole as the recipient, one field along.
    expect(() =>
      renderMessage({ ...base, trace: { "X-A": "1\r\nBcc: attacker@evil.test" } }, new Date(0)),
    ).toThrow(/may not contain newlines/);
  });

  it("encodes a sender name that is not plain ASCII", () => {
    const rendered = renderMessage({ ...base, fromName: "Café Support" }, new Date(0));
    expect(rendered).toContain("=?UTF-8?B?");
    expect(rendered).toContain("<scope-city@example.test>");
  });
});

describe("line endings that are not CRLF", () => {
  it("normalises a bare carriage return", () => {
    // A mail server treats a lone CR as a line break. Left alone it sends a
    // line this code never accounted for -- including one that could start with
    // a dot and arrive unstuffed.
    expect(stuffBody("one\rtwo")).toBe("one\r\ntwo");
  });

  it("stuffs a dot that only a bare CR revealed", () => {
    expect(stuffBody("before\r.hidden")).toBe("before\r\n..hidden");
  });
});
