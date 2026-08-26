#!/usr/bin/env node
/**
 * Seeds Stripe test mode with the charges the demo refunds.
 *
 * A fresh Stripe sandbox is empty, so the live Exchequer has nothing to find
 * and "refund order #184" fails for a reason that looks like the enforcement
 * misfiring rather than the account being new. This creates the same world the
 * fixtures describe, so the two implementations answer the same questions.
 *
 * Idempotent by order id, with one exception that matters in practice. A charge
 * already carrying an `order_id` is left alone, because charges cannot be
 * deleted in Stripe and running this twice would otherwise leave two candidates
 * for one order and a `find_by_order` that picks whichever came back first.
 *
 * A *fully refunded* charge is replaced rather than kept. The demo refunds
 * ord_184, so after one run there is nothing left to refund, and the next
 * mission fails with "only 0 remains" -- which on the map reads as the
 * enforcement misfiring rather than the account having already been settled.
 * Re-seeding restores a refundable charge and re-points the order id at it.
 *
 *   node scripts/seed-stripe.mjs
 */
import { readFileSync } from "node:fs";

const WANTED = [
  { orderId: "ord_184", amount: 4900, email: "customer@example.test" },
  { orderId: "ord_185", amount: 39900, email: "customer@example.test" },
  { orderId: "ord_186", amount: 1250, email: "someone.else@example.test" },
];

function apiKey() {
  const fromEnv = process.env.STRIPE_API_KEY;
  if (fromEnv) return fromEnv;

  // Read .env directly rather than depending on a loader: this is a one-shot
  // script and a missing key should say so plainly rather than fail later with
  // an authentication error.
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith("STRIPE_API_KEY="));
    const value = line?.slice("STRIPE_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    /* fall through to the error below */
  }

  console.error("STRIPE_API_KEY is not set, in the environment or in .env");
  process.exit(1);
}

const KEY = apiKey();

if (!KEY.includes("_test_")) {
  // The one check worth making unconditionally. Seeding writes charges and
  // this script exists for a sandbox; pointing it at a live key would create
  // real ones.
  console.error("refusing to run: that key is not a test-mode key");
  process.exit(1);
}

async function stripe(path, body) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`stripe ${response.status}: ${json.error?.message ?? "failed"}`);
  }
  return json;
}

const existing = (await stripe("charges?limit=100")).data ?? [];
/** Order ids that still have something left to refund. */
const refundable = new Set(
  existing
    .filter((charge) => charge.amount - charge.amount_refunded > 0)
    .map((charge) => charge.metadata?.order_id)
    .filter((id) => typeof id === "string"),
);

for (const want of WANTED) {
  if (refundable.has(want.orderId)) {
    console.log(`  ${want.orderId} already seeded and refundable, leaving it`);
    continue;
  }

  const charge = await stripe("charges", {
    amount: String(want.amount),
    currency: "usd",
    source: "tok_visa",
    description: `Order ${want.orderId}`,
    receipt_email: want.email,
    "metadata[order_id]": want.orderId,
    // Stamped so a re-seed is visible in the dashboard rather than looking like
    // a duplicate somebody created by accident.
    "metadata[seeded_at]": new Date().toISOString(),
    // `billing_details` is derived from the payment source and cannot be set
    // when creating a charge, so the address arrives from the test token and
    // the email from `receipt_email`. Both are read back by the Exchequer and
    // both are what the projector exists to remove.
  });

  console.log(`  ${want.orderId} -> ${charge.id}  ${charge.amount} ${charge.currency}`);
}

console.log("\nseeded. charges now carrying an order id:");
for (const charge of (await stripe("charges?limit=100")).data ?? []) {
  const orderId = charge.metadata?.order_id;
  if (!orderId) continue;
  const left = charge.amount - charge.amount_refunded;
  console.log(`  ${orderId}  ${charge.id}  ${charge.amount} minor, ${left} refundable`);
}
