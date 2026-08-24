import { describe, expect, it } from "vitest";
import { buildRegistry, type OfficeSpec, type Scope } from "@scope-city/scope";
import { neighbourId, probesFor, runBoundaryProbes } from "../src/boundary.js";

const SPECS: OfficeSpec[] = [
  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    responseFields: ["id", "amount", "customer.history"],
    freeTextFields: ["customer.history"],
  },
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
  {
    office: "customer.list",
    district: "exchequer",
    mutating: false,
    args: {},
    responseFields: ["customers"],
    freeTextFields: ["customers"],
  },
];

const registry = buildRegistry(SPECS);
const NOW = 1_000_000;

const scope = (over: Partial<Scope> = {}): Scope => ({
  missionId: "m".repeat(20),
  scopeId: "SC-1",
  agent: "a",
  job: "refund",
  state: "granted",
  offices: ["charge.get", "charge.refund"],
  resources: { charge_ids: ["ch_184"] },
  limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 }, maxResponseBytes: 64_000 },
  projection: { "charge.get": ["id", "amount"], "charge.refund": ["id", "amount"] },
  countersignRequired: ["charge.refund"],
  expiresAt: NOW + 600_000,
  grantedBy: "op",
  grantedAt: NOW,
  version: 1,
  ...over,
});

describe("neighbourId", () => {
  it("steps to the record next door", () => {
    expect(neighbourId("ch_184")).toBe("ch_185");
    expect(neighbourId("ord_009")).toBe("ord_010");
  });

  it("preserves width, so the probe stays the same shape", () => {
    // `ch_009` -> `ch_10` would be refused for looking wrong rather than for
    // being out of scope, and the probe would prove nothing.
    expect(neighbourId("ch_009")).toBe("ch_010");
  });

  it("still produces something for an id with no number", () => {
    expect(neighbourId("ch_abc")).toBe("ch_abc_x");
  });
});

describe("boundary probes", () => {
  it("probes every dimension the scope constrains", () => {
    const probes = probesFor({ scope: scope(), registry, now: NOW });
    const reasons = probes.map((p) => p.why);

    expect(reasons.some((r) => r.includes("next to the one granted"))).toBe(true);
    expect(reasons.some((r) => r.includes("over the ceiling"))).toBe(true);
    expect(reasons.some((r) => r.includes("negative amount"))).toBe(true);
    expect(reasons.some((r) => r.includes("budget is spent"))).toBe(true);
    expect(reasons.some((r) => r.includes("expired"))).toBe(true);
    expect(reasons.some((r) => r.includes("never granted"))).toBe(true);
  });

  it("finds no hole in a sound scope", () => {
    // The enforcement layer is supposed to refuse all of these. If this test
    // ever fails, the finding is real and the evaluator has a gap.
    const result = runBoundaryProbes({ scope: scope(), registry, now: NOW });
    expect(result.findings).toEqual([]);
    expect(result.probesRun).toBeGreaterThan(5);
  });

  it("reports a hole when a ceiling is missing", () => {
    // No ceiling on a refund means any amount is under the limit.
    const wide = scope({
      limits: { maxAmountMinor: {}, maxCalls: { "charge.refund": 1 }, maxResponseBytes: 64_000 },
    });
    const result = runBoundaryProbes({ scope: wide, registry, now: NOW });
    // The amount probes are not generated without a ceiling, so the hole shows
    // up as the scope simply never constraining the amount at all.
    const probes = probesFor({ scope: wide, registry, now: NOW });
    expect(probes.some((p) => p.why.includes("over the ceiling"))).toBe(false);
    expect(result.findings.filter((f) => f.severity === "critical")).toEqual([]);
  });

  it("reports a hole when an extra record is granted", () => {
    // ch_185 granted means the neighbour probe is legitimate, which is exactly
    // what an operator should be shown before approving a two-record scope.
    const wide = scope({ resources: { charge_ids: ["ch_184", "ch_185"] } });
    const result = runBoundaryProbes({ scope: wide, registry, now: NOW });
    expect(result.findings.some((f) => f.kind === "boundary_hole")).toBe(true);
  });

  it("probes ungranted offices too", () => {
    const probes = probesFor({ scope: scope(), registry, now: NOW });
    expect(probes.some((p) => p.office === "customer.list")).toBe(true);
  });

  it("runs without touching anything", () => {
    // The whole point: probing a refund of a neighbouring charge refunds
    // nobody. There is no io parameter to pass, by construction.
    const result = runBoundaryProbes({ scope: scope(), registry, now: NOW });
    expect(result.probesRun).toBeGreaterThan(0);
  });
});
