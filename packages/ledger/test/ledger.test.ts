import { describe, expect, it } from "vitest";
import { QuotaLedger } from "../src/index.js";

const NOW = 1_700_000_000_000;
const MISSION = "m_0123456789abcdef";

function claim(ledger: QuotaLedger, n: number, ceiling = 1) {
  return ledger.claim({
    missionId: MISSION,
    office: "charge.refund",
    ceiling,
    idempotencyKey: `key-${n}`,
    nonce: `nonce-${n}`,
    now: NOW,
  });
}

describe("QuotaLedger — one refund means one refund", () => {
  it("lets the first claim through", () => {
    const ledger = new QuotaLedger();
    expect(claim(ledger, 1)).toMatchObject({ won: true, used: 1 });
  });

  it("refuses the second claim against a ceiling of one", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1);
    expect(claim(ledger, 2)).toMatchObject({ won: false, reason: "exhausted" });
  });

  it("survives the race two subagents create: many claims, exactly one winner", () => {
    const ledger = new QuotaLedger();
    // evaluate() would tell all ten of these yes -- it reads a count it does
    // not own. Only the ledger can settle it.
    const outcomes = Array.from({ length: 10 }, (_, i) => claim(ledger, i));
    expect(outcomes.filter((o) => o.won)).toHaveLength(1);
  });

  it("treats an undefined ceiling as unmetered", () => {
    const ledger = new QuotaLedger();
    for (let i = 0; i < 50; i += 1) {
      expect(
        ledger.claim({
          missionId: MISSION,
          office: "charge.get",
          ceiling: undefined,
          idempotencyKey: `read-${i}`,
          nonce: `read-nonce-${i}`,
          now: NOW,
        }).won,
      ).toBe(true);
    }
  });
});

describe("QuotaLedger — idempotency and replay", () => {
  it("returns the original claim for a repeated idempotency key without spending again", () => {
    const ledger = new QuotaLedger();
    const first = claim(ledger, 1, 2);

    const retry = ledger.claim({
      missionId: MISSION,
      office: "charge.refund",
      ceiling: 2,
      idempotencyKey: "key-1",
      nonce: "a-different-nonce",
      now: NOW,
    });

    expect(retry).toMatchObject({ won: true, replayOf: "key-1" });
    expect(ledger.consumed(MISSION)["charge.refund"]).toBe(1);
    expect(retry).toMatchObject({ sequence: (first as { sequence: number }).sequence });
  });

  it("refuses a reused nonce, which is the same call submitted twice", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1, 5);

    const replay = ledger.claim({
      missionId: MISSION,
      office: "charge.refund",
      ceiling: 5,
      idempotencyKey: "a-new-key",
      nonce: "nonce-1",
      now: NOW,
    });

    expect(replay).toMatchObject({ won: false, reason: "replayed" });
  });
});

describe("QuotaLedger — release", () => {
  it("gives the unit back when a countersign is denied", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1);
    expect(ledger.consumed(MISSION)["charge.refund"]).toBe(1);

    const released = ledger.release({
      missionId: MISSION,
      office: "charge.refund",
      idempotencyKey: "key-1",
    });

    expect(released).toBe(true);
    expect(ledger.consumed(MISSION)["charge.refund"]).toBe(0);
    // and the budget is genuinely usable again
    expect(claim(ledger, 2)).toMatchObject({ won: true });
  });

  it("never drops below zero", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1);
    ledger.release({ missionId: MISSION, office: "charge.refund", idempotencyKey: "key-1" });
    ledger.release({ missionId: MISSION, office: "charge.refund", idempotencyKey: "key-1" });
    expect(ledger.consumed(MISSION)["charge.refund"]).toBe(0);
  });
});

describe("QuotaLedger — mission isolation", () => {
  it("keeps two concurrent missions from spending each other's budget", () => {
    const ledger = new QuotaLedger();
    const args = { office: "charge.refund", ceiling: 1, now: NOW } as const;

    const a = ledger.claim({ ...args, missionId: "mission_aaaaaaaaaaaa", idempotencyKey: "k", nonce: "n" });
    const b = ledger.claim({ ...args, missionId: "mission_bbbbbbbbbbbb", idempotencyKey: "k", nonce: "n" });

    // Same key, same nonce, different missions: both must win. Two judges on
    // the public demo must not consume each other's quota.
    expect(a.won).toBe(true);
    expect(b.won).toBe(true);
  });

  it("forgets one mission without touching another", () => {
    const ledger = new QuotaLedger();
    const args = { office: "charge.refund", ceiling: 1, idempotencyKey: "k", nonce: "n", now: NOW } as const;
    ledger.claim({ ...args, missionId: "mission_aaaaaaaaaaaa" });
    ledger.claim({ ...args, missionId: "mission_bbbbbbbbbbbb" });

    ledger.forget("mission_aaaaaaaaaaaa");

    expect(ledger.consumed("mission_aaaaaaaaaaaa")).toEqual({});
    expect(ledger.consumed("mission_bbbbbbbbbbbb")["charge.refund"]).toBe(1);
  });
});

describe("QuotaLedger — audit trail", () => {
  it("records every winning claim with a monotonic sequence", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1, 3);
    claim(ledger, 2, 3);
    claim(ledger, 3, 3);

    const entries = ledger.entries(MISSION);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("does not record refusals as if they happened", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1, 1);
    claim(ledger, 2, 1);
    expect(ledger.entries(MISSION)).toHaveLength(1);
  });
});

describe("QuotaLedger — a claim is a reservation until it settles", () => {
  // Found by Qodo review. Before this distinction existed, a retry looked like
  // a won claim and the caller ran the operation a second time.
  it("reports a replay as unsettled while the first call is still in flight", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1, 5);

    const retry = ledger.claim({
      missionId: MISSION,
      office: "charge.refund",
      ceiling: 5,
      idempotencyKey: "key-1",
      nonce: "different",
      now: NOW,
    });

    expect(retry).toMatchObject({ won: true, replayOf: "key-1", settled: false });
  });

  it("hands back the original result once the first call has settled", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1, 5);
    ledger.settle({ missionId: MISSION, idempotencyKey: "key-1", result: { id: "re_1" } });

    const retry = ledger.claim({
      missionId: MISSION,
      office: "charge.refund",
      ceiling: 5,
      idempotencyKey: "key-1",
      nonce: "different",
      now: NOW,
    });

    expect(retry).toMatchObject({ won: true, settled: true, result: { id: "re_1" } });
  });

  it("refuses to release a settled claim, because the world already changed", () => {
    // You cannot un-send an email by decrementing a counter. Releasing here
    // would hand the budget back for something that already happened.
    const ledger = new QuotaLedger();
    claim(ledger, 1);
    ledger.settle({ missionId: MISSION, idempotencyKey: "key-1", result: {} });

    const released = ledger.release({
      missionId: MISSION,
      office: "charge.refund",
      idempotencyKey: "key-1",
    });

    expect(released).toBe(false);
    expect(ledger.consumed(MISSION)["charge.refund"]).toBe(1);
  });

  it("still releases an unsettled claim", () => {
    const ledger = new QuotaLedger();
    claim(ledger, 1);
    expect(
      ledger.release({ missionId: MISSION, office: "charge.refund", idempotencyKey: "key-1" }),
    ).toBe(true);
  });

  it("reports failure when settling something that was never claimed", () => {
    const ledger = new QuotaLedger();
    expect(ledger.settle({ missionId: MISSION, idempotencyKey: "nope", result: {} })).toBe(false);
  });
});
