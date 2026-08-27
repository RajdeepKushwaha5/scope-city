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
}

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
}

/** RFC 2047, so a subject that is not plain ASCII survives the trip. */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Escape a body for the DATA section.
 *
 * Normalises to CRLF first: a body built on Windows may already contain CRLF,
 * and blindly appending `\r` to every `\n` would double them.
 */
export function stuffBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/** The message as the server will receive it, headers and all. */
export function renderMessage(message: SmtpMessage, at: Date = new Date()): string {
  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${at.toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
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
  #pending: ((reply: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#consume(chunk));
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
      const resolve = this.#pending;
      this.#pending = null;
      resolve?.(reply);
      return;
    }
  }

  read(): Promise<string> {
    return new Promise((resolve) => {
      this.#pending = resolve;
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
  const timeoutMs = options.timeoutMs ?? 10_000;

  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = createConnection({ host: options.host, port: options.port });
    s.setTimeout(timeoutMs);
    s.once("connect", () => resolve(s));
    s.once("timeout", () => {
      s.destroy();
      reject(new Error(`SMTP: no response from ${options.host}:${options.port} in ${timeoutMs}ms`));
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
    await smtp.say("QUIT", 221);
  } finally {
    socket.end();
    socket.destroy();
  }
}
