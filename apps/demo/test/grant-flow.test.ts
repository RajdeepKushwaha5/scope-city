import { describe, expect, it } from "vitest";
import { evaluate, buildRegistry, type OfficeSpec, type Scope } from "@scope-city/scope";
import { isAwaitingGrant, isTerminalMissionStatus } from "../src/live-lifecycle.js";
import { deriveScopeFromJob } from "../src/derive-scope.js";

const SPECS: OfficeSpec[] = [
  {
    office: "charge.refund",
    district: "exchequer",
    mutating: true,
    args: {
      charge_id: { kind: "resource", resourceClass: "charge_ids", required: true },
      amount: { kind: "amount_minor", required: true },
    },
    responseFields: ["id", "amount"],
    freeTextFields: [],
  },
];
const registry = buildRegistry(SPECS);
const NOW = 1_000_000;

const scope = (state: Scope["state"]): Scope => ({
  missionId: "m".repeat(20),
  scopeId: "SC-1",
  agent: "a",
  job: "refund",
  state,
  offices: ["charge.refund"],
  resources: { charge_ids: ["ch_184"] },
  limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 }, maxResponseBytes: 64_000 },
  projection: { "charge.refund": ["id", "amount"] },
  countersignRequired: ["charge.refund"],
  expiresAt: NOW + 600_000,
  grantedBy: null,
  grantedAt: null,
  version: 0,
});

const call = { office: "charge.refund", args: { charge_id: "ch_184", amount: 4900 }, attemptedAt: NOW };

describe("a proposed scope confers no authority", () => {
  it("refuses a call that would be allowed once granted", () => {
    // The belt-and-braces half of the propose/grant split. The mission is not
    // registered with the proxy until grant, so nothing should reach this at
    // all -- but if a scope awaiting a human ever did become reachable, the
    // evaluator still refuses every call against it.
    const proposed = evaluate({ scope: scope("proposed"), call, registry, now: NOW, consumed: {} });
    expect(proposed.allowed).toBe(false);
    if (!proposed.allowed) expect(proposed.reason).toBe("scope_not_active");

    const granted = evaluate({ scope: scope("granted"), call, registry, now: NOW, consumed: {} });
    expect(granted.allowed).toBe(true);
  });

  it("refuses a denied scope for the same reason", () => {
    const denied = evaluate({ scope: scope("denied"), call, registry, now: NOW, consumed: {} });
    expect(denied.allowed).toBe(false);
  });
});

describe("mission lifecycle states", () => {
  it("treats only `proposed` as awaiting the operator", () => {
    expect(isAwaitingGrant("proposed")).toBe(true);
    for (const s of ["starting", "running", "completed", "failed", "cancelled", "denied"] as const) {
      expect(isAwaitingGrant(s)).toBe(false);
    }
  });

  it("treats a denied mission as finished", () => {
    // A denied scope was never registered and never had a session, so there is
    // nothing to wind down -- but it must not look startable either.
    expect(isTerminalMissionStatus("denied")).toBe(true);
    expect(isTerminalMissionStatus("proposed")).toBe(false);
  });
});

describe("derivation produces a proposal, never a grant", () => {
  it("compiles to `proposed` with no granter and no grant time", async () => {
    const derived = await deriveScopeFromJob({
      job: "Refund order #184 and notify its owner, max $49",
      missionId: "m".repeat(20),
      now: NOW,
    });

    expect(derived.scope.state).toBe("proposed");
    expect(derived.scope.grantedBy).toBeNull();
    expect(derived.scope.grantedAt).toBeNull();
  });
});
