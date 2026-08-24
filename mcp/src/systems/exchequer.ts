import {
  NotFoundError,
  assertMinorUnits,
  requireString,
  type OfficeHandler,
  type SystemDefinition,
} from "./types.js";

/**
 * The Exchequer — payments.
 *
 * `charge.get` deliberately returns more than the demo's scope allows: the
 * customer's address and their full payment history. That is not an oversight,
 * it is the point. Real payment APIs return rich objects, and a scope that
 * polices which tools may be called while ignoring what comes back leaks
 * exactly the data it claimed to fence off. The response projector in
 * @scope-city/scope is what cuts this down, and it needs something real to cut.
 */

export interface Charge {
  readonly id: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly customerEmail: string;
  readonly customerAddress: string;
  refundedMinor: number;
}

export function fixtureCharges(): Map<string, Charge> {
  return new Map<string, Charge>([
    [
      "ch_184",
      {
        id: "ch_184",
        orderId: "ord_184",
        amountMinor: 4900,
        currency: "usd",
        customerEmail: "customer@example.test",
        customerAddress: "12 Somewhere Lane, Springfield",
        refundedMinor: 0,
      },
    ],
    [
      "ch_185",
      {
        id: "ch_185",
        orderId: "ord_185",
        amountMinor: 39_900,
        currency: "usd",
        customerEmail: "someone.else@example.test",
        customerAddress: "9 Other Road, Shelbyville",
        refundedMinor: 0,
      },
    ],
    [
      "ch_186",
      {
        id: "ch_186",
        orderId: "ord_186",
        amountMinor: 12_000,
        currency: "usd",
        customerEmail: "third.party@example.test",
        customerAddress: "4 Elsewhere Street, Ogdenville",
        refundedMinor: 0,
      },
    ],
  ]);
}

export function exchequerSystem(charges = fixtureCharges()): SystemDefinition {
  const history = (email: string) =>
    [...charges.values()]
      .filter((c) => c.customerEmail === email)
      .map((c) => ({ id: c.id, amount: c.amountMinor, order_id: c.orderId }));

  const get: OfficeHandler = {
    office: "charge.get",
    description: "Read a charge by id.",
    inputSchema: {
      type: "object",
      properties: { charge_id: { type: "string" } },
      required: ["charge_id"],
    },
    async call(args) {
      const id = requireString(args, "charge_id");
      const charge = charges.get(id);
      if (!charge) throw new NotFoundError(`charge ${id}`);
      return {
        id: charge.id,
        amount: charge.amountMinor,
        currency: charge.currency,
        order_id: charge.orderId,
        refunded: charge.refundedMinor,
        customer: {
          email: charge.customerEmail,
          // Both of these are outside the demo scope's projection, on purpose.
          address: charge.customerAddress,
          history: history(charge.customerEmail),
        },
      };
    },
  };

  const findByOrder: OfficeHandler = {
    office: "charge.find_by_order",
    description: "Find the refundable charge for one order id.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
    async call(args) {
      const orderId = requireString(args, "order_id");
      const charge = [...charges.values()].find((candidate) => candidate.orderId === orderId);
      if (!charge) throw new NotFoundError(`charge for order ${orderId}`);
      return { id: charge.id, amount: charge.amountMinor, order_id: charge.orderId };
    },
  };

  const refund: OfficeHandler = {
    office: "charge.refund",
    description: "Refund a charge, in whole or in part. Irreversible.",
    inputSchema: {
      type: "object",
      properties: {
        charge_id: { type: "string" },
        amount: { type: "integer", description: "Minor units, e.g. cents." },
      },
      required: ["charge_id", "amount"],
    },
    async call(args) {
      const id = requireString(args, "charge_id");
      const amount = assertMinorUnits(args.amount, "amount");
      const charge = charges.get(id);
      if (!charge) throw new NotFoundError(`charge ${id}`);

      const remaining = charge.amountMinor - charge.refundedMinor;
      if (amount > remaining) {
        throw new RangeError(`cannot refund ${amount}; only ${remaining} remains on ${id}`);
      }

      charge.refundedMinor += amount;
      return {
        id: `re_${charge.id}_${charge.refundedMinor}`,
        charge_id: charge.id,
        amount,
        status: "succeeded",
      };
    },
  };

  /**
   * The tool nobody should hand an agent by default, kept in the catalogue
   * precisely so the counterfactual has something alarming to add: dragging
   * this into a scope visibly annexes the whole customer base.
   */
  const list: OfficeHandler = {
    office: "customer.list",
    description: "List every customer. Broad read.",
    inputSchema: { type: "object", properties: {} },
    async call() {
      const seen = new Map<string, { email: string; address: string }>();
      for (const charge of charges.values()) {
        seen.set(charge.customerEmail, {
          email: charge.customerEmail,
          address: charge.customerAddress,
        });
      }
      return { customers: [...seen.values()], count: seen.size };
    },
  };

  return {
    district: "exchequer",
    title: "The Exchequer",
    offices: [findByOrder, get, refund, list],
  };
}
