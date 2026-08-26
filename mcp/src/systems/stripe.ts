import {
  NotFoundError,
  assertMinorUnits,
  requireString,
  type OfficeHandler,
  type SystemDefinition,
} from "./types.js";

/**
 * The Exchequer, backed by Stripe test mode.
 *
 * The same three offices as the fixture, against a real API over the real
 * network, returning real charge objects. A refund issued here is genuinely
 * irreversible in the test ledger -- which is the property the gate exists to
 * protect, and the reason this is worth doing at all. A demo whose
 * "irreversible action" is a counter in memory is asking to be taken on faith.
 *
 * Nothing above this file changes. The office specs, the evaluator, the
 * projector, the quota ledger and the countersign are untouched: swapping a
 * fixture for a real payment processor is a change to one module, which is the
 * strongest claim the architecture makes and the only way to demonstrate it.
 *
 * The key never reaches the agent. It is read here, held by the process behind
 * the scope proxy, and every call the agent makes is policed before this code
 * runs at all.
 */

export interface StripeOptions {
  readonly apiKey: string;
  /** Injected in tests so the mapping can be exercised without the network. */
  readonly fetchImpl?: typeof fetch;
}

interface StripeCharge {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly amount_refunded: number;
  readonly metadata?: Record<string, string>;
  readonly billing_details?: {
    email?: string | null;
    address?: Record<string, unknown> | null;
  };
  readonly receipt_email?: string | null;
}

/** A Stripe error surfaced with its message rather than a bare status. */
export class StripeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`stripe ${status}: ${message}`);
    this.name = "StripeError";
    this.status = status;
  }
}

export function stripeSystem(options: StripeOptions): SystemDefinition {
  const doFetch = options.fetchImpl ?? fetch;

  async function api(
    path: string,
    init?: { method: "POST"; body: Record<string, string>; idempotencyKey?: string },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      // Basic auth with the key as username and an empty password, which is how
      // Stripe takes a secret or restricted key.
      authorization: `Basic ${Buffer.from(`${options.apiKey}:`).toString("base64")}`,
    };
    if (init) headers["content-type"] = "application/x-www-form-urlencoded";
    if (init?.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

    const response = await doFetch(`https://api.stripe.com/v1/${path}`, {
      method: init?.method ?? "GET",
      headers,
      ...(init ? { body: new URLSearchParams(init.body).toString() } : {}),
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = (body["error"] ?? {}) as { message?: string };
      throw new StripeError(response.status, error.message ?? "request failed");
    }
    return body;
  }

  /** The billing address as one line, or empty. Kept as prose deliberately. */
  function addressOf(charge: StripeCharge): string {
    const address = charge.billing_details?.address;
    if (!address) return "";
    return ["line1", "line2", "city", "postal_code", "country"]
      .map((key) => address[key])
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(", ");
  }

  function emailOf(charge: StripeCharge): string {
    return charge.billing_details?.email ?? charge.receipt_email ?? "";
  }

  /**
   * Charges are listed and filtered here rather than searched.
   *
   * Stripe's search endpoint is a separate permission, and this key is scoped
   * to charges and refunds and nothing else. Listing a page and matching on
   * metadata needs only the read it already has: narrower authority in exchange
   * for a bounded scan, which is the trade this project argues for everywhere
   * else. It would not scale to a real ledger, and a real deployment would ask
   * for the search grant deliberately rather than inherit it.
   */
  async function chargesPage(): Promise<StripeCharge[]> {
    const body = await api("charges?limit=100");
    return (body["data"] ?? []) as StripeCharge[];
  }

  async function chargeById(id: string): Promise<StripeCharge> {
    try {
      return (await api(`charges/${encodeURIComponent(id)}`)) as unknown as StripeCharge;
    } catch (cause) {
      // A missing charge raises the same NotFoundError the fixture does, so
      // nothing above can tell which implementation refused it.
      if (cause instanceof StripeError && cause.status === 404) {
        throw new NotFoundError(`charge ${id}`);
      }
      throw cause;
    }
  }

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
      const charge = await chargeById(id);
      const email = emailOf(charge);

      // History is assembled from charges sharing the email, exactly as the
      // fixture does, and exactly as the projector exists to remove. Real
      // payment APIs return rich objects; the point of this office is to be
      // wider than any sensible scope allows.
      const history =
        email === ""
          ? []
          : (await chargesPage())
              .filter((candidate) => emailOf(candidate) === email)
              .map((candidate) => ({
                id: candidate.id,
                amount: candidate.amount,
                order_id: candidate.metadata?.["order_id"] ?? null,
              }));

      return {
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        order_id: charge.metadata?.["order_id"] ?? null,
        refunded: charge.amount_refunded,
        customer: { email, address: addressOf(charge), history },
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
      const forOrder = (await chargesPage()).filter(
        (candidate) => candidate.metadata?.["order_id"] === orderId,
      );
      if (forOrder.length === 0) throw new NotFoundError(`charge for order ${orderId}`);

      // One order can have several charges, and after a demo run one of them is
      // spent. This office says it finds the *refundable* charge, so it does,
      // rather than trusting Stripe's list order to put the useful one first --
      // an ordering that is not documented and not ours to rely on. Handing back
      // a fully refunded charge would fail later with "only 0 remains", which on
      // the map reads as the enforcement misfiring rather than the order having
      // already been settled.
      const found =
        forOrder.find((candidate) => candidate.amount - candidate.amount_refunded > 0) ??
        forOrder[0];
      if (!found) throw new NotFoundError(`charge for order ${orderId}`);

      // The refundable remainder, not the original amount.
      //
      // This office says it finds the *refundable* charge, and a caller asking
      // it how much to refund is asking what is left. Returning the original on
      // a partly settled charge let the scope be derived with a ceiling above
      // the remainder, so the agent requested more than existed and
      // `charge.refund` refused a mission that was otherwise correct -- an
      // enforcement refusal caused by this office overstating what it found.
      return {
        id: found.id,
        amount: found.amount - found.amount_refunded,
        order_id: orderId,
      };
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
    async call(args, context) {
      const id = requireString(args, "charge_id");
      const amount = assertMinorUnits(args.amount, "amount");

      // Checked here as well as in the scope, because each layer defends
      // itself. Stripe would refuse an over-refund too, but learning that from
      // a 400 after the quota has been claimed is a worse place to find out
      // than before the call goes out.
      const charge = await chargeById(id);
      const remaining = charge.amount - charge.amount_refunded;
      if (amount > remaining) {
        throw new RangeError(`cannot refund ${amount}; only ${remaining} remains on ${id}`);
      }

      // Idempotent at Stripe, not just here.
      //
      // Without a key, a refund that Stripe created but whose response was lost
      // -- a dropped connection, a timeout -- looks like a failure. The proxy
      // then releases its quota claim and a retry creates a *second* refund.
      // The preflight read above cannot close that window: it is a separate
      // request, so it cannot see a refund being created concurrently with it.
      //
      // The key comes from the proxy rather than from these arguments, and that
      // distinction is the whole of it. A key derived from charge and amount
      // collides two legitimate partial refunds of the same size, so Stripe
      // returns the first one and this reports a refund that never happened --
      // which is a worse failure than the duplicate it was meant to prevent.
      // A fresh key per attempt has the opposite problem: every retry becomes a
      // new action. Only the caller knows whether a request is a retry, and the
      // proxy's key is exactly that knowledge.
      const created = await api("refunds", {
        method: "POST",
        body: { charge: id, amount: String(amount) },
        ...(context?.idempotencyKey
          ? { idempotencyKey: `scope-city:${context.idempotencyKey}` }
          : {}),
      });

      return {
        id: String(created["id"] ?? ""),
        charge_id: id,
        amount,
        status: String(created["status"] ?? "unknown"),
      };
    },
  };

  return {
    district: "exchequer",
    title: "The Exchequer",
    offices: [get, findByOrder, refund],
  };
}
