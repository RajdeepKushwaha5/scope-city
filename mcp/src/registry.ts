import { buildRegistry, type OfficeRegistry, type OfficeSpec } from "@scope-city/scope";

/**
 * How each office is policed.
 *
 * This is the bridge between the systems (which know how to do things) and the
 * evaluator (which knows what is permitted). It has to be written by hand,
 * because the evaluator cannot infer that `charge_id` names a resource and
 * `body` is free text -- and guessing is how scoped systems leak.
 *
 * `responseFields` is the complete set of fields an office can return. It is
 * declared rather than discovered so that projection is a subtraction from a
 * known surface: if a system starts returning a new field and nobody adds it
 * here, projection drops it. Silent omission beats silent disclosure.
 */
export const OFFICE_SPECS: readonly OfficeSpec[] = [
  {
    office: "ticket.get",
    district: "records",
    mutating: false,
    args: { ticket_id: { kind: "resource", resourceClass: "ticket_ids", required: true } },
    responseFields: ["id", "subject", "body", "order_id", "customer_email", "status"],
  },
  {
    office: "ticket.reply",
    district: "records",
    mutating: true,
    args: {
      ticket_id: { kind: "resource", resourceClass: "ticket_ids", required: true },
      body: { kind: "opaque", required: true },
    },
    responseFields: ["id", "replies"],
  },
  {
    office: "ticket.close",
    district: "records",
    mutating: true,
    args: { ticket_id: { kind: "resource", resourceClass: "ticket_ids", required: true } },
    responseFields: ["id", "status"],
  },

  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    // Note how much wider this is than any sensible scope's projection. That
    // gap is what the over-reach analysis reports and the projector closes.
    responseFields: [
      "id",
      "amount",
      "currency",
      "order_id",
      "refunded",
      "customer.email",
      "customer.address",
      "customer.history",
    ],
  },
  {
    office: "charge.refund",
    district: "exchequer",
    mutating: true,
    args: {
      charge_id: { kind: "resource", resourceClass: "charge_ids", required: true },
      amount: { kind: "amount_minor", required: true },
    },
    responseFields: ["id", "charge_id", "amount", "status"],
  },
  {
    office: "customer.list",
    district: "exchequer",
    mutating: false,
    // No resource argument at all: this office cannot be narrowed by id, only
    // granted or withheld. That is exactly why it is a dramatic counterfactual.
    args: {},
    responseFields: ["customers", "count"],
  },

  {
    office: "mail.send",
    district: "post-house",
    mutating: true,
    args: {
      to: { kind: "resource", resourceClass: "mail_to", required: true },
      subject: { kind: "opaque", required: false },
      body: { kind: "opaque", required: true },
    },
    responseFields: ["id", "to"],
  },
  {
    office: "mail.list",
    district: "post-house",
    mutating: false,
    args: {},
    responseFields: ["messages", "count"],
  },
];

export function officeRegistry(): OfficeRegistry {
  return buildRegistry(OFFICE_SPECS);
}

/** Offices that change the world, and so must never be granted casually. */
export const MUTATING_OFFICES: readonly string[] = OFFICE_SPECS.filter((s) => s.mutating).map(
  (s) => s.office,
);

/**
 * Offices whose effects cannot be undone. These are what The Gate stops for --
 * a distinct and smaller set than "mutating": closing a ticket is a mutation
 * you can reverse, sending mail is not.
 */
export const IRREVERSIBLE_OFFICES: readonly string[] = ["charge.refund", "mail.send"];
