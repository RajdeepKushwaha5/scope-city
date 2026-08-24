import { describe, expect, it } from "vitest";
import { fingerprintCall } from "@scope-city/proxy";
import type { Scope } from "@scope-city/scope";
import { CountersignBook } from "../src/index.js";

const NOW = 1_700_000_000_000;

function scope(overrides: Partial<Scope> = {}): Scope {
  return {
    missionId: "m_0123456789abcdef",
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184",
    state: "active",
    offices: ["charge.refund"],
    resources: { charge_ids: ["ch_184"] },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1 },
      maxResponseBytes: 64_000,
    },
    projection: { "charge.refund": ["id", "status"] },
    countersignRequired: ["charge.refund"],
    expiresAt: NOW + 600_000,
    grantedBy: "operator",
    grantedAt: NOW,
    version: 1,
    ...overrides,
  };
}

const REFUND_184 = { charge_id: "ch_184", amount: 4900 };

function raise(book: CountersignBook, args = REFUND_184, s = scope()) {
  return book.raise({
    scope: s,
    toolCallId: "tc1",
    threadId: "root",
    office: "charge.refund",
    args,
    now: NOW,
  });
}

describe("what the operator reads is what runs", () => {
  it("lets through the exact call that was approved", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    const result = book.check("tc1", raised.fingerprint);

    expect(result.approved).toBe(true);
    expect(result.fingerprint).toBe(raised.fingerprint);
  });

  it("hands back a different fingerprint when the call drifted", () => {
    // The operator reads "refund $49 on ch_184" and approves. The model then
    // submits ch_185 for $399 against that approval. The book must not agree.
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    const drifted = fingerprintCall({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_185", amount: 39_900 }, attemptedAt: NOW },
    });

    const result = book.check("tc1", drifted);

    expect(result.fingerprint).not.toBe(drifted);
    expect(result.reason).toMatch(/not this call/);
  });

  it("does not simply echo back whatever fingerprint it is given", () => {
    // A book that agreed with its caller would be no check at all.
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    expect(book.check("tc1", "invented").fingerprint).not.toBe("invented");
  });

  it("treats a scope version bump as invalidating the approval", () => {
    // Limits changed after the operator read the call, so their approval was
    // given under terms that no longer apply.
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    const underNewScope = fingerprintCall({
      scope: scope({ version: 2 }),
      call: { office: "charge.refund", args: REFUND_184, attemptedAt: NOW },
    });

    expect(book.check("tc1", underNewScope).fingerprint).not.toBe(underNewScope);
  });
});

describe("verdicts", () => {
  it("refuses when the operator has not decided yet", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    expect(book.check("tc1", raised.fingerprint)).toMatchObject({
      approved: false,
      reason: "no verdict recorded",
    });
  });

  it("refuses when the operator said no, and carries their reason", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    book.settle("tc1", { status: "denied", reason: "wrong customer", at: NOW });

    expect(book.check("tc1", raised.fingerprint)).toMatchObject({
      approved: false,
      reason: "wrong customer",
    });
  });

  it("refuses to settle something that was never raised", () => {
    expect(new CountersignBook().settle("nope", { status: "approved", at: NOW })).toBe(false);
  });

  it("refuses a call with no raised entry even if a verdict exists", () => {
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });
    book.close("tc1");

    expect(book.check("tc1", "anything")).toMatchObject({ approved: false });
  });
});

describe("pending gates", () => {
  it("lists what is waiting on a human, for the map to raise", () => {
    const book = new CountersignBook();
    raise(book);
    expect(book.allPending()).toHaveLength(1);
    expect(book.pending("tc1")).toMatchObject({ office: "charge.refund", threadId: "root" });
  });

  it("clears the entry once the call it guarded is done", () => {
    const book = new CountersignBook();
    raise(book);
    book.close("tc1");
    expect(book.allPending()).toEqual([]);
  });
});

describe("sweeping", () => {
  it("expires a gate the operator never answered", () => {
    // A gate left raised forever holds a quota claim open, so waiting is not
    // a safe default.
    const book = new CountersignBook();
    raise(book);

    const expired = book.sweep(NOW + 60_000, 30_000);

    expect(expired).toEqual(["tc1"]);
    expect(book.allPending()).toEqual([]);
  });

  it("leaves a gate that has been answered alone", () => {
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    expect(book.sweep(NOW + 60_000, 30_000)).toEqual([]);
    expect(book.allPending()).toHaveLength(1);
  });

  it("leaves a gate that is still fresh alone", () => {
    const book = new CountersignBook();
    raise(book);
    expect(book.sweep(NOW + 1_000, 30_000)).toEqual([]);
  });
});
