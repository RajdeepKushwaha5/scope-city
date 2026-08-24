import { describe, expect, it } from "vitest";
import { buildRegistry, type OfficeSpec, type Scope } from "@scope-city/scope";
import { blastRadius, counterfactual, withOffice } from "../src/counterfactual.js";

const SPECS: OfficeSpec[] = [
  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: { charge_id: { kind: "resource", resourceClass: "charge_ids", required: true } },
    responseFields: ["id", "amount", "customer.email", "customer.history"],
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
    responseFields: ["customers", "count"],
    freeTextFields: ["customers"],
  },
  {
    office: "mail.send",
    district: "post-house",
    mutating: true,
    args: { to: { kind: "resource", resourceClass: "mail_to", required: true } },
    responseFields: ["id", "to"],
    freeTextFields: [],
  },
];

const registry = buildRegistry(SPECS);
const NOW = 1_000_000;

const scope: Scope = {
  missionId: "m".repeat(20),
  scopeId: "SC-1",
  agent: "a",
  job: "refund",
  state: "granted",
  offices: ["charge.get", "charge.refund"],
  resources: { charge_ids: ["ch_184"], mail_to: ["buyer@example.test"] },
  limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 }, maxResponseBytes: 64_000 },
  projection: { "charge.get": ["id", "amount"], "charge.refund": ["id", "amount"] },
  countersignRequired: ["charge.refund"],
  expiresAt: NOW + 600_000,
  grantedBy: "op",
  grantedAt: NOW,
  version: 1,
};

describe("counterfactual", () => {
  it("shows what granting an unnarrowable office costs", () => {
    // The beat the whole map exists for: one extra permission visibly annexes
    // a chunk of the city.
    const cf = counterfactual({ scope, registry, office: "customer.list", now: NOW });

    expect(cf.after.offices).toBe(cf.before.offices + 1);
    expect(cf.after.exposedFields).toBeGreaterThan(cf.before.exposedFields);
    expect(cf.after.unnarrowableOffices).toBe(cf.before.unnarrowableOffices + 1);
    expect(cf.summary).toContain("takes no record id");
    expect(cf.newFindings.some((f) => f.summary.includes("other customers"))).toBe(true);
  });

  it("annexes a district the scope could not previously reach", () => {
    const cf = counterfactual({ scope, registry, office: "mail.send", now: NOW });
    expect(cf.newDistricts).toEqual(["post-house"]);
    expect(cf.summary).toContain("annexes post-house");
  });

  it("counts a new chained path when the addition is mutating", () => {
    // charge.get already yields mail_to via customer.email; adding mail.send
    // turns that into a path from a lookup to an irreversible action.
    const cf = counterfactual({ scope, registry, office: "mail.send", now: NOW });
    expect(cf.after.chainedPaths).toBeGreaterThan(cf.before.chainedPaths);
  });

  it("reports only findings the addition actually introduces", () => {
    // Otherwise the operator re-reads the same warnings on every drag and stops
    // reading them at all.
    const cf = counterfactual({ scope, registry, office: "mail.send", now: NOW });
    for (const finding of cf.newFindings) expect(finding.office).toBe("mail.send");
  });

  it("is a no-op for an office already in scope", () => {
    const cf = counterfactual({ scope, registry, office: "charge.get", now: NOW });
    expect(cf.after).toEqual(cf.before);
    expect(cf.newFindings).toEqual([]);
    expect(cf.summary).toContain("already in scope");
  });

  it("assumes the worst case for a field nobody has considered", () => {
    // The hypothetical projection is everything the office declares, because
    // the point of asking "what if" is to see the worst case before agreeing.
    const hypothetical = withOffice({ scope, registry, office: "customer.list" });
    expect(hypothetical.projection["customer.list"]).toEqual(["customers", "count"]);
  });

  it("does not mutate the scope it was asked about", () => {
    const before = JSON.stringify(scope);
    counterfactual({ scope, registry, office: "customer.list", now: NOW });
    expect(JSON.stringify(scope)).toBe(before);
  });

  it("leaves an unknown office with nothing to say", () => {
    const cf = counterfactual({ scope, registry, office: "nope.nope", now: NOW });
    expect(cf.after).toEqual(cf.before);
  });
});

describe("blastRadius", () => {
  it("counts fields per office, not globally", () => {
    // `id` on two offices is two distinct exposures; collapsing them would
    // understate the reach of a scope that grants many similar offices.
    const radius = blastRadius({ scope, registry });
    expect(radius.exposedFields).toBe(4);
  });

  it("counts an office with no resource argument as unnarrowable", () => {
    const wide = withOffice({ scope, registry, office: "customer.list" });
    expect(blastRadius({ scope: wide, registry }).unnarrowableOffices).toBe(1);
  });
});
