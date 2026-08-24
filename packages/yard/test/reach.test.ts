import { describe, expect, it } from "vitest";
import { buildRegistry, type OfficeSpec, type Scope } from "@scope-city/scope";
import { backtest } from "../src/backtest.js";
import { runReachAnalysis, runUnusedGrantAnalysis } from "../src/reach.js";

const SPECS: OfficeSpec[] = [
  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    responseFields: ["id", "amount", "customer.email", "customer.address", "customer.history"],
    freeTextFields: ["customer.address", "customer.history"],
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
    responseFields: ["customers", "count"],
    freeTextFields: ["customers"],
  },
  {
    office: "vault.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    responseFields: ["id", "card_number", "api_token"],
    freeTextFields: [],
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

describe("response reach", () => {
  it("finds the leak the demo is about", () => {
    // The genuinely hard finding: an approved call whose response embeds far
    // more than the job asked for. A human cannot spot this by hand at grant
    // time, which is why it runs automatically.
    const leaky = scope({
      projection: { "charge.get": ["id", "amount", "customer.history"], "charge.refund": ["id"] },
    });
    const { findings } = runReachAnalysis({ scope: leaky, registry });
    const leak = findings.find((f) => f.kind === "response_over_reach" && f.severity === "warning");

    expect(leak).toBeDefined();
    expect(leak!.summary).toContain("prior transactions");
    expect(leak!.detail).toContain("customer.history");
  });

  it("escalates a credential to critical", () => {
    const bad = scope({
      offices: ["vault.get"],
      projection: { "vault.get": ["id", "card_number", "api_token"] },
    });
    const { findings } = runReachAnalysis({ scope: bad, registry });
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("does not raise an alarm for an email the job needs", () => {
    // A warning that fires on everything trains the reader to grant through it.
    const withEmail = scope({
      projection: { "charge.get": ["id", "amount", "customer.email"], "charge.refund": ["id"] },
    });
    const { findings } = runReachAnalysis({ scope: withEmail, registry });
    const email = findings.find((f) => f.detail?.includes("customer.email"));
    expect(email?.severity).toBe("note");
  });

  it("reports what projection is stopping, not only what it lets through", () => {
    // Otherwise an operator cannot tell a scope that is safe from one that has
    // simply not been asked for anything interesting yet.
    const { findings } = runReachAnalysis({ scope: scope(), registry });
    const blocked = findings.find((f) => f.summary.includes("projection is stopping it"));
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toContain("customer.history");
    expect(blocked!.severity).toBe("note");
  });

  it("flags free text reaching the agent as an inbound channel", () => {
    const prose = scope({
      projection: { "charge.get": ["id", "customer.address"], "charge.refund": ["id"] },
    });
    const { findings } = runReachAnalysis({ scope: prose, registry });
    const injection = findings.find((f) => f.kind === "injection_surface");
    expect(injection).toBeDefined();
    expect(injection!.detail).toContain("customer.address");
  });

  it("flags an office that cannot be narrowed at all", () => {
    const wide = scope({ offices: ["customer.list"], projection: { "customer.list": ["count"] } });
    const findings = runUnusedGrantAnalysis({ scope: wide, registry });
    expect(findings.some((f) => f.summary.includes("cannot be narrowed"))).toBe(true);
  });
});

describe("backtest", () => {
  it("calls a tight scope clean", () => {
    const report = backtest({ scope: scope(), registry, now: NOW });
    expect(report.clean).toBe(true);
    expect(report.probesRun).toBeGreaterThan(10);
  });

  it("refuses to call a leaky scope clean", () => {
    const leaky = scope({
      projection: { "charge.get": ["id", "customer.history"], "charge.refund": ["id"] },
    });
    expect(backtest({ scope: leaky, registry, now: NOW }).clean).toBe(false);
  });

  it("orders findings worst first, so the top line is the one that matters", () => {
    const bad = scope({
      offices: ["charge.get", "vault.get", "customer.list"],
      projection: {
        "charge.get": ["id", "customer.history"],
        "vault.get": ["api_token"],
        "customer.list": ["customers"],
      },
    });
    const report = backtest({ scope: bad, registry, now: NOW });
    expect(report.findings[0]?.severity).toBe("critical");
  });

  it("is deterministic, so a clean report is a fact and not a sample", () => {
    const a = backtest({ scope: scope(), registry, now: NOW });
    const b = backtest({ scope: scope(), registry, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
