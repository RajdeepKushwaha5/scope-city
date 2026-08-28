import { requireString, type OfficeHandler, type SystemDefinition } from "./types.js";
import { sendMail } from "./smtp.js";

/**
 * The Post House, backed by a real SMTP server.
 *
 * The fixture kept an in-memory outbox, which is enough to enforce against but
 * not enough to *show*. The demo makes two claims about mail -- that an
 * unscoped agent sends the customer list to an attacker, and that a scoped one
 * reaches only the authorised recipient -- and with an in-memory array both are
 * assertions. Against Mailpit they are an inbox somebody can open.
 *
 * Mail is also the quietest irreversible action here. A refund can be argued
 * about; a message that has left cannot be recalled, and the recipient list is
 * exactly what an injected instruction wants to change. That is why `mail_to`
 * is a scoped resource class rather than a free string, and it is why this
 * office is countersigned.
 *
 * Sent messages are still tracked in memory as well, because `mail.list` is
 * scoped to this mission and reading them back out of a shared catcher would
 * show one mission the mail of another.
 */

export interface MailpitOptions {
  readonly host: string;
  readonly port: number;
  /** The envelope sender. Nothing receives replies; this only has to be valid. */
  readonly from?: string;
  /**
   * The mission this Post House belongs to, stamped onto every message.
   *
   * A message in an inbox is otherwise just a message. Carrying the mission and
   * scope ids makes it traceable back to the hash-chained record, which is the
   * difference between an agent claiming it mailed the customer and a delivered
   * message you can match to the authority that permitted it.
   */
  readonly mission?: { readonly missionId?: string; readonly scopeId?: string };
}

interface SentRecord {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
}

export function mailpitSystem(options: MailpitOptions): SystemDefinition {
  const from = options.from ?? "scope-city@example.test";
  const sent: SentRecord[] = [];

  const send: OfficeHandler = {
    office: "mail.send",
    description: "Send an email. Irreversible once it leaves.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "body"],
    },
    async call(args) {
      const to = requireString(args, "to");
      const body = requireString(args, "body");
      // A mail with no subject is still a mail. "(no subject)" reads in an inbox
      // as something having gone wrong, when what happened is that the agent
      // did not write one.
      const supplied = typeof args.subject === "string" ? args.subject.trim() : "";
      const subject = supplied.length > 0 ? supplied : "Message from your support agent";

      // Nothing is recorded until the server has accepted it. Pushing first and
      // sending after would leave `mail.list` claiming a message that never
      // left, which is the one direction this must not be wrong in: an outbox
      // that over-reports makes a failed send look like a delivered one.
      await sendMail(
        {
          from,
          to,
          subject,
          body,
          // A display name, so an inbox shows a sender rather than an address.
          fromName: "Scope City",
          trace: {
            ...(options.mission?.missionId
              ? { "X-Scope-City-Mission": options.mission.missionId }
              : {}),
            ...(options.mission?.scopeId ? { "X-Scope-City-Scope": options.mission.scopeId } : {}),
          },
        },
        { host: options.host, port: options.port },
      );

      const record: SentRecord = { id: `msg_${sent.length + 1}`, to, subject };
      sent.push(record);

      // Only the id and recipient come back. Echoing the body to a model that
      // just wrote it adds nothing and leaks more.
      return { id: record.id, to: record.to };
    },
  };

  const list: OfficeHandler = {
    office: "mail.list",
    description: "List messages sent in this session.",
    inputSchema: { type: "object", properties: {} },
    async call() {
      return {
        messages: sent.map((m) => ({ id: m.id, to: m.to, subject: m.subject })),
        count: sent.length,
      };
    },
  };

  return { district: "post-house", title: "Post House", offices: [send, list] };
}
