import { describe, expect, it } from "vitest";
import { buildRegistry, evaluate, type OfficeSpec, type Scope } from "../src/index.js";

const NOW = 1_700_000_000_000;

const SPECS: OfficeSpec[] = [
  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    responseFields: ["id", "amount", "customer.email", "customer.history"],
    freeTextFields: [],
  },
  {
    office: "charge.refund",
    district: "exchequer",
    mutating: true,
    args: {
      charge_id: { kind: "resource", resourceClass: "charge_ids", required: true },
      amount: { kind: "amount_minor", required: true },
    },
    responseFields: ["id", "status"],
    freeTextFields: [],
  },
  {
    office: "mail.send",
    district: "post_house",
    mutating: true,
    args: {
      to: { kind: "resource", resourceClass: "mail_to", required: true },
      body: { kind: "opaque", required: false },
    },
    responseFields: ["id"],
    freeTextFields: [],
  },
];

const registry = buildRegistry(SPECS);

function scope(overrides: Partial<Scope> = {}): Scope {
  return {
    missionId: "m_0123456789abcdef",
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184",
    state: "active",
    offices: ["charge.get", "charge.refund", "mail.send"],
    resources: {
      charge_ids: ["ch_184"],
      mail_to: ["customer@example.test"],
    },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1, "mail.send": 1 },
      maxResponseBytes: 64_000,
    },
    projection: {
      "charge.get": ["id", "amount", "customer.email"],
      "charge.refund": ["id", "status"],
      "mail.send": ["id"],
    },
    countersignRequired: ["charge.refund", "mail.send"],
    expiresAt: NOW + 600_000,
    grantedBy: "operator:test",
    grantedAt: NOW,
    version: 1,
    ...overrides,
  };
}

describe("evaluate — the happy path", () => {
  it("allows an in-scope call and flags it for countersign", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toEqual({ allowed: true, countersignRequired: true });
  });

  it("does not demand a countersign for a read", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toEqual({ allowed: true, countersignRequired: false });
  });
});

describe("evaluate — the attack the demo turns on", () => {
  it("refuses a charge that is not in the grant", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_185", amount: 4900 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "resource_not_in_scope" });
  });

  it("refuses mail to anyone but the granted recipient", () => {
    const decision = evaluate({
      scope: scope(),
      call: {
        office: "mail.send",
        args: { to: "attacker@example.test", body: "the customer list" },
        attemptedAt: NOW,
      },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "resource_not_in_scope" });
  });

  it("refuses an office that was never granted", () => {
    const decision = evaluate({
      scope: scope({ offices: ["charge.get"] }),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "office_not_in_scope" });
  });
});

describe("evaluate — amount boundaries", () => {
  it("allows exactly the ceiling", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses one minor unit over", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4901 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "amount_over_limit" });
  });

  it("refuses a float, because currency maths we cannot verify is not currency maths", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 49.0000001 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "amount_not_integer" });
  });

  it("refuses an office with no ceiling declared", () => {
    const decision = evaluate({
      scope: scope({
        limits: { maxAmountMinor: {}, maxCalls: {}, maxResponseBytes: 64_000 },
      }),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 1 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "amount_over_limit" });
  });
});

describe("evaluate — quota and expiry", () => {
  it("refuses once the call budget is spent", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW },
      registry,
      consumed: { "charge.refund": 1 },
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "call_count_exhausted" });
  });

  it("refuses on the expiry instant, not a millisecond later", () => {
    const s = scope();
    const decision = evaluate({
      scope: s,
      call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: s.expiresAt },
      registry,
      consumed: {},
      now: s.expiresAt,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "scope_expired" });
  });

  it("still allows one millisecond before expiry", () => {
    const s = scope();
    const decision = evaluate({
      scope: s,
      call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: s.expiresAt - 1 },
      registry,
      consumed: {},
      now: s.expiresAt - 1,
    });
    expect(decision.allowed).toBe(true);
  });

  it.each(["drafted", "proposed", "expired", "revoked", "denied"] as const)(
    "refuses everything while the scope is %s",
    (state) => {
      const decision = evaluate({
        scope: scope({ state }),
        call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: NOW },
        registry,
        consumed: {},
        now: NOW,
      });
      expect(decision).toMatchObject({ allowed: false, reason: "scope_not_active" });
    },
  );
});

describe("evaluate — deny by default", () => {
  it("refuses an office with no spec, because unpoliceable is not permitted", () => {
    const decision = evaluate({
      scope: scope({ offices: ["ghost.tool"] }),
      call: { office: "ghost.tool", args: {}, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "office_not_in_scope" });
  });

  it("refuses when a required argument is absent", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { amount: 100 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "missing_required_argument" });
  });

  it("refuses a resource class the scope never granted at all", () => {
    const decision = evaluate({
      scope: scope({ resources: { mail_to: ["customer@example.test"] } }),
      call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "resource_not_in_scope" });
  });
});

describe("evaluate — a ceiling alone does not bound an amount", () => {
  // Found by Qodo review. -1000 is comfortably under a 4900 ceiling, and a
  // negative refund runs the downstream arithmetic backwards: refundedMinor
  // decreases, restoring refundable headroom. Repeat it and the ceiling means
  // nothing at all. The range has to be closed at both ends.
  it("refuses a negative amount that would otherwise pass the ceiling check", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: -1000 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "amount_not_positive" });
  });

  it("refuses zero, which is a call with no meaning and no reason to allow", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 0 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "amount_not_positive" });
  });

  it("still allows the smallest meaningful amount", () => {
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 1 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it("cannot be repeated to inflate headroom, because the first attempt never lands", () => {
    // The attack in full: drive refundedMinor negative, then refund more than
    // the ceiling. It fails at step one.
    const attack = [-4900, -1000, -1];
    for (const amount of attack) {
      const decision = evaluate({
        scope: scope(),
        call: { office: "charge.refund", args: { charge_id: "ch_184", amount }, attemptedAt: NOW },
        registry,
        consumed: {},
        now: NOW,
      });
      expect(decision.allowed).toBe(false);
    }
  });
});

/**
 * An argument the office does not declare cannot be policed, and the whole
 * `args` object is handed to the upstream handler after this function returns.
 *
 * Every handler shipped here picks its fields by name, so nothing reached
 * Stripe that the handler had not asked for -- but that is the authors having
 * been careful, not the boundary having held. An office written as
 * `call(args) { return api.post(args) }` would forward a refund reason, a
 * transfer reversal or an application-fee flag, and nothing above it would
 * notice. This function promises no path falls through to permitted.
 */
describe("evaluate — arguments the office never declared", () => {
  it("refuses a call carrying a field the spec does not name", () => {
    const decision = evaluate({
      scope: scope(),
      call: {
        office: "charge.refund",
        // Real Stripe parameters, and the reason this matters: each one has an
        // effect, and the scope was never asked about any of them.
        args: { charge_id: "ch_184", amount: 4900, reverse_transfer: true },
        attemptedAt: NOW,
      },
      registry,
      consumed: {},
      now: NOW,
    });

    expect(decision).toEqual({
      allowed: false,
      reason: "argument_not_declared",
      detail: "charge.refund does not declare reverse_transfer",
    });
  });

  it("names every undeclared field, in a stable order", () => {
    // The agent has to be able to fix the call it just made. One name at a
    // time turns that into a guessing game across several refusals.
    const decision = evaluate({
      scope: scope(),
      call: {
        office: "charge.refund",
        args: { charge_id: "ch_184", amount: 4900, refund_application_fee: true, reason: "x" },
        attemptedAt: NOW,
      },
      registry,
      consumed: {},
      now: NOW,
    });

    expect(decision).toMatchObject({
      reason: "argument_not_declared",
      detail: "charge.refund does not declare reason, refund_application_fee",
    });
  });

  it("refuses before spending anything on the call", () => {
    // Ordered ahead of the quota check, so a malformed call cannot burn a
    // unit of a budget it was never going to be allowed to use.
    const decision = evaluate({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900, x: 1 }, attemptedAt: NOW },
      registry,
      // Already exhausted: if quota were checked first this would say so.
      consumed: { "charge.refund": 1 },
      now: NOW,
    });

    expect(decision).toMatchObject({ reason: "argument_not_declared" });
  });

  it("still allows a call that names only what the office declares", () => {
    // The check must not cost the ordinary path anything.
    expect(
      evaluate({
        scope: scope(),
        call: { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW },
        registry,
        consumed: {},
        now: NOW,
      }),
    ).toEqual({ allowed: true, countersignRequired: true });
  });

  it("allows a declared optional argument to be absent", () => {
    // Refusing the undeclared must not become requiring the declared.
    expect(
      evaluate({
        scope: scope(),
        call: { office: "charge.get", args: { charge_id: "ch_184" }, attemptedAt: NOW },
        registry,
        consumed: {},
        now: NOW,
      }),
    ).toEqual({ allowed: true, countersignRequired: false });
  });
});
