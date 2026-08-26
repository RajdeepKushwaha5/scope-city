import { describe, expect, it } from "vitest";
import { buildRegistry } from "./office-spec.js";
import { planReadDelegation } from "./delegation.js";
import type { Scope } from "./schema.js";

const baseScope = {
  offices: ["ticket.get", "charge.get", "charge.refund"],
} as unknown as Scope;

const specs = [
  { office: "ticket.get", district: "records", mutating: false, args: {}, responseFields: ["id"], freeTextFields: [] },
  {
    office: "charge.get",
    district: "exchequer",
    mutating: false,
    args: {},
    responseFields: ["id", "amount", "refunded"],
    freeTextFields: [],
  },
  { office: "charge.refund", district: "exchequer", mutating: true, args: {}, responseFields: ["id"], freeTextFields: [] },
] as const;

describe("read delegation policy", () => {
  it("denies delegation when a candidate is mutating even without a quota", () => {
    const registry = buildRegistry(specs.map((spec) =>
      spec.office === "ticket.get" ? { ...spec, mutating: true } : spec,
    ));
    expect(planReadDelegation(baseScope, registry)).toBeNull();
  });

  it("denies delegation when the verifier cannot return prior-action evidence", () => {
    const registry = buildRegistry(specs.map((spec) =>
      spec.office === "charge.get" ? { ...spec, responseFields: ["id", "amount"] } : spec,
    ));
    expect(planReadDelegation(baseScope, registry)).toBeNull();
  });

  it("denies arbitrary pairs that cannot satisfy the named investigation roles", () => {
    const scope = { ...baseScope, offices: ["mail.list", "charge.get"] } as Scope;
    const registry = buildRegistry([
      ...specs,
      { office: "mail.list", district: "post-house", mutating: false, args: {}, responseFields: ["count"], freeTextFields: [] },
    ]);
    expect(planReadDelegation(scope, registry)).toBeNull();
  });

  it("allows a source investigator and evidence-compatible charge verifier", () => {
    expect(planReadDelegation(baseScope, buildRegistry(specs))).toEqual({
      source: "ticket.get",
      target: "charge.get",
    });
  });
});
