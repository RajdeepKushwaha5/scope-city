import { describe, expect, it } from "vitest";
import { buildRegistry, type OfficeSpec } from "@scope-city/scope";
import { ttlMsIn } from "../src/draft.js";
import { constrainEnvelope, type DerivationBounds } from "../src/derive.js";
import { draftFromText } from "../src/draft.js";

const SPECS: OfficeSpec[] = [
  {
    office: "charge.refund",
    district: "exchequer",
    mutating: true,
    args: {
      charge_id: { kind: "resource", resourceClass: "charge_ids", required: true },
      amount: { kind: "amount_minor", required: true },
    },
    responseFields: ["id"],
    freeTextFields: [],
  },
];

const BOUNDS: DerivationBounds = {
  registry: buildRegistry(SPECS),
  alwaysCountersign: ["charge.refund"],
  maxAmountMinorCeiling: 50_000,
  maxCallsCeiling: 3,
  maxTtlMs: 10 * 60 * 1000,
};

describe("ttlMsIn", () => {
  it("reads the lease term the operator stated", () => {
    expect(ttlMsIn("for 2 minutes")).toBe(120_000);
    expect(ttlMsIn("within 30 seconds")).toBe(30_000);
    expect(ttlMsIn("for 1 hour")).toBe(3_600_000);
  });

  it("accepts the short forms people actually type", () => {
    expect(ttlMsIn("for 5 min")).toBe(300_000);
    expect(ttlMsIn("30 secs")).toBe(30_000);
    expect(ttlMsIn("2 hrs")).toBe(7_200_000);
  });

  it("does not invent a duration from a bare number", () => {
    // "order 184" has a number and no unit. Reading a lease term out of it
    // would silently change how long authority lives based on a record id.
    expect(ttlMsIn("order 184")).toBeNull();
    expect(ttlMsIn("Refund order #184")).toBeNull();
    expect(ttlMsIn("")).toBeNull();
  });

  it("refuses a zero or negative term", () => {
    expect(ttlMsIn("for 0 minutes")).toBeNull();
  });
});

describe("the lease the operator asks for", () => {
  const derive = (job: string) =>
    constrainEnvelope({ job, raw: draftFromText(job), bounds: BOUNDS });

  it("uses the stated term when it is inside the operator's own ceiling", () => {
    expect(derive("Refund charge 184 up to $49 for 2 minutes").ttlMs).toBe(120_000);
  });

  it("clamps a longer request down to the ceiling", () => {
    // An operator asking for an hour gets the maximum they are permitted to
    // issue, not the hour. Bounds are the one thing a draft cannot argue with.
    expect(derive("Refund charge 184 up to $49 for 1 hour").ttlMs).toBe(600_000);
  });

  it("falls back to the ceiling when no term is stated", () => {
    // The default is the shortest of the two, never the longest -- and here
    // they coincide because the ceiling is the default.
    expect(derive("Refund charge 184 up to $49").ttlMs).toBe(600_000);
  });

  it("puts the term on the scope's expiry rather than somewhere else", () => {
    const envelope = derive("Refund charge 184 up to $49 for 2 minutes");
    expect(envelope.ttlMs).toBe(120_000);
  });
});
