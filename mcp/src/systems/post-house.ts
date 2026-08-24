import { requireString, type OfficeHandler, type SystemDefinition } from "./types.js";

/**
 * The Post House — outbound mail.
 *
 * Mail is the quietest irreversible action in the demo. A refund can at least
 * be argued about; a message that has left the building cannot be recalled, and
 * the recipient list is the thing an injected instruction most wants to change.
 * That is why `mail_to` is a scoped resource class rather than a free string.
 */

export interface SentMail {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly at: number;
}

export interface Outbox {
  readonly sent: SentMail[];
}

export function createOutbox(): Outbox {
  return { sent: [] };
}

export function postHouseSystem(outbox: Outbox = createOutbox()): SystemDefinition {
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
      const subject = typeof args.subject === "string" ? args.subject : "(no subject)";

      const mail: SentMail = {
        id: `msg_${outbox.sent.length + 1}`,
        to,
        subject,
        body,
        at: Date.now(),
      };
      outbox.sent.push(mail);

      // Only the id is returned. There is nothing useful in echoing the body
      // back to a model that just wrote it, and less to leak this way.
      return { id: mail.id, to: mail.to };
    },
  };

  const list: OfficeHandler = {
    office: "mail.list",
    description: "List messages sent in this session.",
    inputSchema: { type: "object", properties: {} },
    async call() {
      return {
        messages: outbox.sent.map((m) => ({ id: m.id, to: m.to, subject: m.subject })),
        count: outbox.sent.length,
      };
    },
  };

  return { district: "post-house", title: "Post House", offices: [send, list] };
}
