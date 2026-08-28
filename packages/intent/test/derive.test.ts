import { describe, expect, it } from "vitest";
import { buildRegistry, type OfficeSpec } from "@scope-city/scope";
import { appearsInJob, constrainEnvelope, type DerivationBounds } from "../src/derive.js";

const SPECS: OfficeSpec[] = [
  {
    office: "ticket.get",
    district: "records",
    mutating: false,
    args: { ticket_id: { kind: "resource", resourceClass: "ticket_ids", required: true } },
    responseFields: ["id", "body", "order_id"],
    freeTextFields: ["body"],
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

const BOUNDS: DerivationBounds = {
  registry: buildRegistry(SPECS),
  alwaysCountersign: ["charge.refund"],
  maxAmountMinorCeiling: 5_000,
  maxCallsCeiling: 3,
  maxTtlMs: 600_000,
};

const run = (raw: Parameters<typeof constrainEnvelope>[0]["raw"]) =>
  constrainEnvelope({ job: "any job", raw, bounds: BOUNDS });

describe("constrainEnvelope narrows and never widens", () => {
  it("drops offices the registry does not declare", () => {
    // An undeclared office has no arg bindings, so the evaluator could not
    // police it and the projector could not filter it. Proposing one would be
    // proposing something unenforceable.
    const env = run({ offices: ["charge.refund", "database.drop", "shell.exec"] });
    expect(env.offices).toEqual(["charge.refund"]);
  });

  it("clamps an amount ceiling to the operator's own limit", () => {
    const env = run({ offices: ["charge.refund"], maxAmountMinor: { "charge.refund": 999_999 } });
    expect(env.maxAmountMinor["charge.refund"]).toBe(5_000);
  });

  it("clamps call counts", () => {
    const env = run({ offices: ["charge.refund"], maxCalls: { "charge.refund": 500 } });
    expect(env.maxCalls["charge.refund"]).toBe(3);
  });

  it("clamps ttl", () => {
    const env = run({ offices: [], ttlMs: 99_999_999 });
    expect(env.ttlMs).toBe(600_000);
  });

  it("budgets a mutating office the draft forgot to budget", () => {
    // An unbudgeted mutating office is an unbounded one. "The model did not
    // mention it" is not a reason to allow unlimited refunds.
    const env = run({ offices: ["charge.refund"] });
    expect(env.maxCalls["charge.refund"]).toBe(1);
  });

  it("adds the gate even when the draft omits it", () => {
    const env = run({ offices: ["charge.refund"] });
    expect(env.countersignRequired).toEqual(["charge.refund"]);
  });

  it("cannot be talked out of the gate", () => {
    // The gate is added from bounds and never read from the draft. If a model
    // could decide which actions need a human, an injected instruction could
    // decide this one did not.
    const env = run({
      offices: ["charge.refund"],
      // @ts-expect-error -- deliberately shaped like a model trying to opt out
      countersignRequired: [],
    });
    expect(env.countersignRequired).toEqual(["charge.refund"]);
  });

  it("discards named resources no granted office consults", () => {
    const env = run({ offices: ["charge.refund"], named: { ticket_ids: ["tkt_1"] } });
    expect(env.named["ticket_ids"]).toBeUndefined();
  });

  it("records classes an office needs but the operator could not name", () => {
    const env = run({ offices: ["charge.refund"] });
    expect(env.unresolved).toEqual(["charge_ids"]);
  });

  it("survives garbage without widening anything", () => {
    const env = run({
      offices: "not-an-array",
      named: 42,
      maxAmountMinor: { "charge.refund": "free" },
      maxCalls: null,
      ttlMs: -1,
    } as never);
    expect(env.offices).toEqual([]);
    expect(env.named).toEqual({});
    expect(env.maxAmountMinor).toEqual({});
    expect(env.ttlMs).toBe(600_000);
  });

  it("refuses negative and zero call budgets rather than storing them", () => {
    // A zero budget that reached the ledger would read as "no calls left" in
    // one place and "no limit configured" in another.
    const env = run({ offices: ["charge.refund"], maxCalls: { "charge.refund": 0 } });
    expect(env.maxCalls["charge.refund"]).toBe(1);
  });

  it("never proposes an office outside the bounds, for any input", () => {
    const attempts: unknown[] = [
      ["customer.list"],
      ["CHARGE.REFUND"],
      ["charge.refund ", " charge.refund"],
      [{ office: "charge.refund" }],
      [null, undefined, 0, ""],
    ];
    for (const offices of attempts) {
      const env = run({ offices } as never);
      for (const office of env.offices) expect(BOUNDS.registry.has(office)).toBe(true);
    }
  });
});

/**
 * The claim for stage 1 is that the envelope comes from the operator's own
 * sentence. A plain substring test does not deliver that: it admits ids nobody
 * wrote, reached by *shortening* a real one rather than inventing a new one --
 * which is the harder case to notice on a grant screen, because every id on it
 * looks plausible.
 */
describe("an id has to be in the sentence, not merely inside it", () => {
  const JOB = "Refund order #184, max $49, for 30 minutes";

  it("drops fragments of the id the operator did write", () => {
    // Each of these was admitted before: 1, 4, 8 and 18 are all pieces of 184.
    for (const id of ["ch_1", "ch_4", "ch_8", "ch_18"]) {
      expect(appearsInJob(JOB, id), id).toBe(false);
    }
  });

  it("drops an id matching a digit from somewhere else entirely", () => {
    // `ch_0` used to pass on the zero in "30 minutes", which is the clearest
    // statement of how little a substring match proves.
    expect(appearsInJob(JOB, "ch_0")).toBe(false);
  });

  it("still admits the ids the operator actually named", () => {
    for (const id of ["ord_184", "ch_184", "tkt_184"]) {
      expect(appearsInJob(JOB, id), id).toBe(true);
    }
  });

  it("does not treat a longer number as the one that was written", () => {
    // 184 is a prefix of 1840. Neither should stand in for the other.
    expect(appearsInJob(JOB, "ord_1840")).toBe(false);
    expect(appearsInJob("refund the charge for order 1840", "ord_184")).toBe(false);
  });

  it("reads an id written out in full", () => {
    expect(appearsInJob("close ticket tkt_184 and refund ch_184", "ch_184")).toBe(true);
    // And does not infer an order from a sentence that names none, even though
    // 184 is present -- it is present only inside other ids.
    expect(appearsInJob("close ticket tkt_184 and refund ch_184", "ord_184")).toBe(false);
  });

  it("survives an id containing regex metacharacters", () => {
    // The token is interpolated into a RegExp. An id of `ch_.*` must not match
    // everything, and must not throw.
    expect(appearsInJob(JOB, "ch_.*")).toBe(false);
    expect(() => appearsInJob(JOB, "ch_[")).not.toThrow();
  });

  it("keeps the ids out of the envelope, not just out of the helper", () => {
    const env = constrainEnvelope({
      job: JOB,
      raw: { offices: ["charge.refund"], named: { charge_ids: ["ch_184", "ch_1", "ch_0"] } },
      bounds: BOUNDS,
    });

    expect(env.named["charge_ids"]).toEqual(["ch_184"]);
  });
});
