import { describe, expect, it } from "vitest";
import type { Scope } from "@scope-city/scope";
import { buildRecord, canonical, genesisHash, verifyRecord } from "../src/record.js";
import { MissionEventLog } from "../src/event-log.js";

const scope: Scope = {
  missionId: "m".repeat(20),
  scopeId: "SC-184",
  agent: "support",
  job: "Refund order #184",
  state: "granted",
  offices: ["charge.refund"],
  resources: { charge_ids: ["ch_184"] },
  limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 }, maxResponseBytes: 64_000 },
  projection: { "charge.refund": ["id", "amount"] },
  countersignRequired: ["charge.refund"],
  expiresAt: 2_000_000,
  grantedBy: "operator",
  grantedAt: 1_000_000,
  version: 1,
};

function record(events: unknown[] = [{ kind: "refund", amount: 4900 }, { kind: "mail", to: "a@b.test" }]) {
  const log = new MissionEventLog<unknown>();
  events.forEach((event, i) => log.append(event, 1_000_000 + i));
  return buildRecord({
    missionId: scope.missionId,
    scope,
    events: log.since(0).events,
    startedAt: 1_000_000,
    finishedAt: 1_000_100,
  });
}

describe("canonical", () => {
  it("does not care what order the keys were assigned in", () => {
    // JSON.stringify preserves insertion order, so two structurally identical
    // events would otherwise hash differently depending on how they were built.
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it("distinguishes values that actually differ", () => {
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it("drops undefined rather than emitting invalid JSON", () => {
    expect(canonical({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("handles nesting and nulls", () => {
    expect(canonical({ a: { c: null, b: [1] } })).toBe('{"a":{"b":[1],"c":null}}');
  });
});

describe("the record chain", () => {
  it("verifies a record it just produced", () => {
    const verdict = verifyRecord(record());
    expect(verdict.ok).toBe(true);
  });

  it("catches an altered event", () => {
    // The point of the whole structure: changing a refund amount after the fact
    // invalidates the entry and everything after it.
    const original = record();
    const tampered = {
      ...original,
      entries: original.entries.map((e, i) =>
        i === 0 ? { ...e, event: { kind: "refund", amount: 999_900 } } : e,
      ),
    };

    const verdict = verifyRecord(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.brokenAt).toBe(1);
  });

  it("catches a removed entry", () => {
    const original = record();
    const tampered = { ...original, entries: original.entries.slice(1) };
    expect(verifyRecord(tampered).ok).toBe(false);
  });

  it("catches entries truncated from the end", () => {
    // The one tampering that leaves every remaining hash individually valid,
    // which is why the head is checked separately.
    const original = record();
    const tampered = { ...original, entries: original.entries.slice(0, -1) };
    const verdict = verifyRecord(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("head");
  });

  it("reports the first broken link, not a tally", () => {
    // Everything before it is intact and everything after is unverifiable
    // regardless of whether it was touched. A count would overstate what is known.
    const original = record([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
    const tampered = {
      ...original,
      entries: original.entries.map((e, i) => (i >= 1 ? { ...e, event: { a: 99 } } : e)),
    };
    const verdict = verifyRecord(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.brokenAt).toBe(2);
  });

  it("binds the chain to the scope it was issued under", () => {
    // A record cannot be lifted wholesale and re-presented as belonging to a
    // different, wider authority.
    const original = record();
    const relabelled = {
      ...original,
      scope: { ...scope, offices: ["charge.refund", "customer.list"] },
    };
    expect(verifyRecord(relabelled).ok).toBe(false);
  });

  it("gives different missions different genesis hashes", () => {
    expect(genesisHash("m1", scope)).not.toBe(genesisHash("m2", scope));
  });

  it("is stable across rebuilds of the same events", () => {
    expect(record().head).toBe(record().head);
  });

  it("produces an empty but valid record for a mission that did nothing", () => {
    const empty = record([]);
    expect(empty.entries).toEqual([]);
    expect(verifyRecord(empty).ok).toBe(true);
    expect(empty.head).toBe(genesisHash(scope.missionId, scope));
  });

  it("carries the scope, so the record says what was authorised", () => {
    // A log of actions without the authority they were taken under is only half
    // the evidence.
    const built = record();
    expect(built.scope.offices).toEqual(["charge.refund"]);
    expect(built.scope.resources["charge_ids"]).toEqual(["ch_184"]);
  });
});
