import { describe, expect, it } from "vitest";
import { NotFoundError } from "../src/systems/types.js";
import { stripeSystem } from "../src/systems/stripe.js";

/**
 * The Stripe Exchequer, exercised without Stripe.
 *
 * `fetch` is injected, so these run offline and deterministically. That matters
 * beyond convenience: a suite that reaches a payment API is slow, flaky, and
 * writes to somebody's account, and the one thing worth testing here is the
 * mapping -- whether a Stripe charge object becomes the shape the evaluator and
 * projector already understand.
 *
 * The payloads are trimmed from real test-mode responses rather than invented.
 */

const CHARGE = {
  id: "ch_3U8T0Z",
  amount: 4900,
  currency: "usd",
  amount_refunded: 0,
  metadata: { order_id: "ord_184" },
  receipt_email: "customer@example.test",
  billing_details: {
    email: null,
    address: { line1: "12 Somewhere Lane", city: "Springfield", country: "US" },
  },
};

const OTHER = {
  id: "ch_3U8T0a",
  amount: 39900,
  currency: "usd",
  amount_refunded: 0,
  metadata: { order_id: "ord_185" },
  receipt_email: "customer@example.test",
};

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = handler(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

function system(handler: (url: string, init?: RequestInit) => unknown) {
  return stripeSystem({ apiKey: "rk_test_fake", fetchImpl: fakeFetch(handler) });
}

const officeOf = (sys: ReturnType<typeof system>, name: string) => {
  const office = sys.offices.find((o) => o.office === name);
  if (!office) throw new Error(`no office ${name}`);
  return office;
};

describe("charge.find_by_order", () => {
  it("matches on the order id in metadata", async () => {
    const sys = system(() => ({ data: [OTHER, CHARGE] }));
    const result = await officeOf(sys, "charge.find_by_order").call({ order_id: "ord_184" });
    expect(result).toEqual({ id: "ch_3U8T0Z", amount: 4900, order_id: "ord_184" });
  });

  it("prefers a charge that still has something left to refund", async () => {
    // An order can have several charges, and after a demo run one is spent.
    // Trusting Stripe's list order to put the useful one first is relying on
    // something undocumented; handing back a settled charge fails later with
    // "only 0 remains", which reads as the enforcement misfiring.
    const spent = { ...CHARGE, id: "ch_spent", amount_refunded: 4900 };
    const fresh = { ...CHARGE, id: "ch_fresh", amount_refunded: 0 };
    const sys = system(() => ({ data: [spent, fresh] }));

    const result = (await officeOf(sys, "charge.find_by_order").call({
      order_id: "ord_184",
    })) as { id: string };
    expect(result.id).toBe("ch_fresh");
  });

  it("still returns a fully settled charge when that is all there is", async () => {
    // Better to hand back the settled charge and let the refund refuse with a
    // reason than to claim the order does not exist.
    const spent = { ...CHARGE, id: "ch_spent", amount_refunded: 4900 };
    const sys = system(() => ({ data: [spent] }));
    const result = (await officeOf(sys, "charge.find_by_order").call({
      order_id: "ord_184",
    })) as { id: string };
    expect(result.id).toBe("ch_spent");
  });

  it("raises the same NotFoundError the fixture does", async () => {
    // Nothing above this file should be able to tell which implementation
    // refused a lookup.
    const sys = system(() => ({ data: [] }));
    await expect(
      officeOf(sys, "charge.find_by_order").call({ order_id: "ord_999" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("charge.get", () => {
  it("maps a Stripe charge into the shape the scope already polices", async () => {
    const sys = system((url) => (url.includes("charges/") ? CHARGE : { data: [CHARGE, OTHER] }));
    const result = (await officeOf(sys, "charge.get").call({ charge_id: "ch_3U8T0Z" })) as Record<
      string,
      unknown
    >;

    expect(result["id"]).toBe("ch_3U8T0Z");
    expect(result["amount"]).toBe(4900);
    expect(result["order_id"]).toBe("ord_184");
    expect(result["refunded"]).toBe(0);
  });

  it("returns more than any sensible scope allows, on purpose", async () => {
    // The projector needs something real to remove. An office that only ever
    // returned the safe fields would make the response layer untestable and
    // the demo's central claim unobservable.
    const sys = system((url) => (url.includes("charges/") ? CHARGE : { data: [CHARGE, OTHER] }));
    const result = (await officeOf(sys, "charge.get").call({ charge_id: "ch_3U8T0Z" })) as {
      customer: { email: string; address: string; history: unknown[] };
    };

    expect(result.customer.email).toBe("customer@example.test");
    expect(result.customer.address).toContain("Somewhere Lane");
    expect(result.customer.history).toHaveLength(2);
  });

  it("falls back to receipt_email when billing details carry none", async () => {
    const sys = system((url) => (url.includes("charges/") ? CHARGE : { data: [CHARGE] }));
    const result = (await officeOf(sys, "charge.get").call({ charge_id: "ch_3U8T0Z" })) as {
      customer: { email: string };
    };
    expect(result.customer.email).toBe("customer@example.test");
  });

  it("does not build a history for a charge with no email", async () => {
    // Matching every charge whose email is the empty string would hand back the
    // entire account as one customer's history.
    const anonymous = { ...CHARGE, receipt_email: null, billing_details: { email: null } };
    const sys = system((url) => (url.includes("charges/") ? anonymous : { data: [anonymous, OTHER] }));
    const result = (await officeOf(sys, "charge.get").call({ charge_id: "ch_3U8T0Z" })) as {
      customer: { history: unknown[] };
    };
    expect(result.customer.history).toEqual([]);
  });
});

describe("charge.refund", () => {
  it("posts a refund for the exact amount", async () => {
    let sent: string | undefined;
    const sys = stripeSystem({
      apiKey: "rk_test_fake",
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/refunds")) {
          sent = String(init?.body ?? "");
          return { ok: true, status: 200, json: async () => ({ id: "re_1", status: "succeeded" }) } as Response;
        }
        return { ok: true, status: 200, json: async () => CHARGE } as Response;
      }) as unknown as typeof fetch,
    });

    const result = await officeOf(sys, "charge.refund").call({
      charge_id: "ch_3U8T0Z",
      amount: 4900,
    });

    expect(sent).toContain("charge=ch_3U8T0Z");
    expect(sent).toContain("amount=4900");
    expect(result).toEqual({
      id: "re_1",
      charge_id: "ch_3U8T0Z",
      amount: 4900,
      status: "succeeded",
    });
  });

  it("refuses more than remains, before the call goes out", async () => {
    // Stripe would refuse this too, but learning it from a 400 after the quota
    // has been claimed is a worse place to find out.
    const partly = { ...CHARGE, amount_refunded: 4000 };
    const sys = system(() => partly);
    await expect(
      officeOf(sys, "charge.refund").call({ charge_id: "ch_3U8T0Z", amount: 4900 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("refuses a non-positive amount without asking Stripe", async () => {
    // The layer defends itself: a negative refund runs the arithmetic backwards
    // and a scope misconfiguration should not be the only thing standing in the
    // way of it.
    const sys = system(() => CHARGE);
    await expect(
      officeOf(sys, "charge.refund").call({ charge_id: "ch_3U8T0Z", amount: -100 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("the office surface matches the fixture", () => {
  it("declares the same three offices", async () => {
    const sys = system(() => ({ data: [] }));
    expect(sys.offices.map((o) => o.office).sort()).toEqual([
      "charge.find_by_order",
      "charge.get",
      "charge.refund",
    ]);
    expect(sys.district).toBe("exchequer");
  });
});
