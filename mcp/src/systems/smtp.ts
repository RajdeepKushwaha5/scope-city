import { createConnection, type Socket } from "node:net";

/**
 * Just enough SMTP to hand a message to a local catcher.
 *
 * Written out rather than pulled in, because the surface actually needed here
 * is small and the alternative was a dependency and a lockfile change days from
 * a deadline. This speaks to Mailpit on localhost: no authentication, no TLS,
 * no relaying, no retries. It is not a mail library and should not grow into
 * one -- anything that needs to reach a real recipient should use a real client.
 *
 * The parts that are easy to get wrong, and are handled:
 *
 *   - CRLF. SMTP lines end `\r\n`, not `\n`, and a server is entitled to reject
 *     anything else.
 *   - Dot-stuffing. A body line consisting of a single `.` ends the DATA
 *     section, so any line starting with `.` gets another prepended. Without
 *     this, a message body can truncate itself and the send still "succeeds".
 *   - Multi-line replies. `250-` continues, `250 ` ends. Reading one line and
 *     moving on desynchronises the conversation against any real server.
 *   - Non-ASCII headers. A subject with an accent or an emoji is encoded as an
 *     RFC 2047 word rather than sent raw, which would corrupt it or be refused.
 */

export interface SmtpMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Shown instead of the bare address, so an inbox reads as a sender. */
  readonly fromName?: string;
  /**
   * Headers tying the message to the mission that sent it.
   *
   * A message in an inbox is otherwise just a message. With the mission and
   * scope ids on it, anyone holding the hash-chained record can match the two
   * up -- the difference between "the agent says it mailed the customer" and a
   * delivered message traceable to the authority that permitted it.
   *
   * Values are checked the way addresses are, because a header is another place
   * a newline splits a line and adds one nobody wrote.
   */
  readonly trace?: Readonly<Record<string, string>>;
}

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
}

/**
 * Reject an address that could carry SMTP commands.
 *
 * The envelope puts this value straight into a command line, so a recipient
 * containing CRLF ends that line and starts another -- one extra RCPT TO is
 * enough to add a silent second recipient. The mission scope already refuses a
 * recipient it did not grant, and a granted one would not contain a newline,
 * so this is the layer beneath that rather than the only check. Both hold.
 *
 * Angle brackets go too: the envelope supplies them, and an address bringing
 * its own can close one early.
 */
export function assertSafeAddress(address: string, field: string): void {
  if (address.length === 0 || address.length > 320) {
    throw new Error(`SMTP: ${field} must be between 1 and 320 characters`);
  }
  if (/[\r\n\0<>]/.test(address)) {
    throw new Error(`SMTP: ${field} may not contain newlines or angle brackets`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) {
    throw new Error(`SMTP: ${field} is not an address: ${JSON.stringify(address)}`);
  }
}

/** RFC 2047, so a subject that is not plain ASCII survives the trip. */
/** The most bytes of UTF-8 one encoded word may carry, inside the 75-char cap. */
const ENCODED_WORD_BYTES = 30;

export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;

  // Split into folded words. An encoded word may not exceed 75 characters
  // including its =?UTF-8?B?...?= wrapper, and a single long one is accepted by
  // some servers and silently mangled by others -- the worst of both.
  //
  // Split by code point rather than by byte, so a multi-byte character is never
  // cut in half and delivered as a replacement glyph.
  const words: string[] = [];
  let chunk: string[] = [];
  let bytes = 0;

  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > ENCODED_WORD_BYTES && chunk.length > 0) {
      words.push(chunk.join(""));
      chunk = [];
      bytes = 0;
    }
    chunk.push(char);
    bytes += size;
  }
  if (chunk.length > 0) words.push(chunk.join(""));

  // Folded onto continuation lines, which is how one header carries several
  // encoded words.
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

/**
 * Escape a body for the DATA section.
 *
 * Normalises to CRLF first: a body built on Windows may already contain CRLF,
 * and blindly appending `\r` to every `\n` would double them.
 */
export function stuffBody(body: string): string {
  // Every line ending, not just CRLF. A bare CR is a line break to a mail
  // server and invisible here, so leaving it in place sends a line this code
  // never accounted for -- including, potentially, one starting with a dot
  // that arrives unstuffed.
  return body
    .replace(/\r\n|\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/** The message as the server will receive it, headers and all. */
/** A header value cannot carry a line break, for the same reason an address cannot. */
export function assertSafeHeaderValue(value: string, field: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`SMTP: ${field} may not contain newlines`);
  }
}

export function renderMessage(message: SmtpMessage, at: Date = new Date()): string {
  const sender = message.fromName
    ? `${encodeHeader(message.fromName)} <${message.from}>`
    : message.from;

  const trace = Object.entries(message.trace ?? {}).map(([name, value]) => {
    assertSafeHeaderValue(name, "header name");
    assertSafeHeaderValue(value, `header ${name}`);
    return `${name}: ${value}`;
  });

  return [
    `From: ${sender}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${at.toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset=\"utf-8\"',
    "Content-Transfer-Encoding: 8bit",
    ...trace,
    "",
    stuffBody(message.body),
  ].join("\r\n");
}

/** True for a reply that continues onto another line, e.g. `250-SIZE`. */
function isContinuation(line: string): boolean {
  return /^\d{3}-/.test(line);
}

export function replyCode(reply: string): number {
  return Number.parseInt(reply.slice(0, 3), 10);
}

class SmtpConversation {
  #buffer = "";
  #pending: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
  #failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#consume(chunk));

    // Anything that ends the socket has to end the wait as well. A read is
    // resolved only by data, so without this a server that goes away
    // mid-exchange leaves the send pending until the process exits -- the
    // connect handler's reject cannot help, because that promise resolved the
    // moment the socket opened.
    const fail = (error: Error) => {
      this.#failure = error;
      const pending = this.#pending;
      this.#pending = null;
      pending?.reject(error);
    };

    socket.on("error", (error) => fail(error));
    socket.on("close", () => fail(new Error("SMTP: connection closed mid-exchange")));
    socket.on("timeout", () => {
      socket.destroy();
      fail(new Error("SMTP: timed out waiting for a reply"));
    });
  }

  #consume(chunk: string): void {
    this.#buffer += chunk;

    // A reply is complete only when a line arrives whose code is not followed
    // by a hyphen.
    const lines = this.#buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (isContinuation(lines[i]!)) continue;
      const reply = lines.slice(0, i + 1).join("\r\n");
      this.#buffer = lines.slice(i + 1).join("\r\n");
      const pending = this.#pending;
      this.#pending = null;
      pending?.resolve(reply);
      return;
    }
  }

  read(): Promise<string> {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject };
    });
  }

  async say(line: string, expect: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (replyCode(reply) !== expect) {
      throw new Error(`SMTP: expected ${expect} after "${line.split("\r\n")[0]}", got: ${reply}`);
    }
    return reply;
  }
}

export async function sendMail(message: SmtpMessage, options: SmtpOptions): Promise<void> {
  assertSafeAddress(message.from, "from");
  assertSafeAddress(message.to, "to");

  // A port read from the environment can arrive as NaN or nonsense, and the
  // failure it produces otherwise is a socket error that reads like the server
  // being down rather than the configuration being wrong.
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error(`SMTP: ${String(options.port)} is not a usable port`);
  }

  const timeoutMs = options.timeoutMs ?? 10_000;

  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = createConnection({ host: options.host, port: options.port });
    s.setTimeout(timeoutMs);
    s.once("connect", () => resolve(s));
    s.once("timeout", () => {
      s.destroy();
      // No host or port in the message. This error reaches the agent through a
      // tool result, and an agent that cannot see the mail server should not
      // learn its address by failing to reach it. The operator has the address
      // in their own configuration and in the systems line at startup.
      reject(new Error(`SMTP: no response from the mail server in ${timeoutMs}ms`));
    });
    s.once("error", reject);
  });

  try {
    const smtp = new SmtpConversation(socket);

    const greeting = await smtp.read();
    if (replyCode(greeting) !== 220) throw new Error(`SMTP: bad greeting: ${greeting}`);

    await smtp.say("EHLO scope-city", 250);
    await smtp.say(`MAIL FROM:<${message.from}>`, 250);
    await smtp.say(`RCPT TO:<${message.to}>`, 250);
    await smtp.say("DATA", 354);
    await smtp.say(`${renderMessage(message)}\r\n.`, 250);
    // The message is the server's the moment DATA is accepted above. Everything
    // after is housekeeping, and a failure in it must not be reported as a
    // failure to deliver -- that would have the caller record nothing for mail
    // already sent, which is the one error worse than losing it.
    await smtp.say("QUIT", 221).catch(() => undefined);
  } finally {
    socket.end();
    socket.destroy();
  }
}
