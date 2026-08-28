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

describe("checkFingerprint — the binding the proxy actually uses", () => {
  // Found by Qodo. The demo's countersign callback used to raise an entry from
  // the proxy's own request and return its own fingerprint, so every gated call
  // approved itself. The whole point is that the two fingerprints come from
  // different places: one from what TrueForge showed a human, one from what the
  // proxy is about to run.
  it("approves a call whose fingerprint matches what was shown", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    expect(book.checkFingerprint(raised.fingerprint)).toMatchObject({
      approved: true,
      toolCallId: "tc1",
    });
  });

  it("refuses a call that is not the one the operator read", () => {
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    const other = fingerprintCall({
      scope: scope(),
      call: { office: "charge.refund", args: { charge_id: "ch_185", amount: 39_900 }, attemptedAt: NOW },
    });

    expect(book.checkFingerprint(other)).toMatchObject({
      approved: false,
      reason: "no approval was granted for this exact call",
    });
  });

  it("refuses while the operator has not decided", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    expect(book.checkFingerprint(raised.fingerprint)).toMatchObject({ approved: false });
  });

  it("refuses when the operator said no, and carries their reason", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    book.settle("tc1", { status: "denied", reason: "wrong customer", at: NOW });

    expect(book.checkFingerprint(raised.fingerprint)).toMatchObject({
      approved: false,
      reason: "wrong customer",
    });
  });

  it("never echoes the fingerprint it was handed", () => {
    // A check that returns your own input alongside "approved" has told you
    // nothing at all.
    const book = new CountersignBook();
    const result = book.checkFingerprint("invented");
    expect(Object.values(result)).not.toContain("invented");
  });

  it("refuses identical gates because a fingerprint cannot identify which verdict applies", () => {
    const book = new CountersignBook();
    const first = raise(book);
    book.raise({
      scope: scope(),
      toolCallId: "tc2",
      threadId: "field-2",
      office: "charge.refund",
      args: REFUND_184,
      now: NOW,
    });
    book.settle("tc1", { status: "approved", at: NOW });
    book.settle("tc2", { status: "denied", at: NOW });

    expect(book.checkFingerprint(first.fingerprint)).toMatchObject({
      approved: false,
      reason: expect.stringMatching(/ambiguous/),
    });
  });

  it("consumes a decided approval exactly once", () => {
    const book = new CountersignBook();
    const raised = raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    expect(book.consumeFingerprint(raised.fingerprint).approved).toBe(true);
    expect(book.consumeFingerprint(raised.fingerprint)).toMatchObject({
      approved: false,
      reason: expect.stringMatching(/no approval/),
    });
  });
});

/**
 * A countersign is spent when the call it guarded runs, and the verdict is
 * deleted so it can never be reused. That deletion left the replay guard blind
 * to precisely the gates that had been used -- which is when replaying one is
 * worst.
 */
describe("a spent countersign is not offered again", () => {
  it("recognises a gate whose approval has already been spent", () => {
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });

    const fingerprint = book.pending("tc1")!.fingerprint;
    expect(book.consumeFingerprint(fingerprint).approved).toBe(true);

    // The refund has now happened. A resumed session replaying the approval
    // request must not put it back in front of the operator: they would be
    // asked to authorise a payment already made, with no way to tell the
    // repeat from a second genuine request.
    expect(book.settled("tc1")).toBe(true);
  });

  it("does not turn that memory into a reusable approval", () => {
    // The tombstone must not become a way to spend one countersign twice,
    // which would be a worse bug than the one it fixes.
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "approved", at: NOW });
    const fingerprint = book.pending("tc1")!.fingerprint;
    book.consumeFingerprint(fingerprint);

    expect(book.consumeFingerprint(fingerprint).approved).toBe(false);
    expect(book.check("tc1", fingerprint).approved).toBe(false);
  });

  it("remembers a refusal too", () => {
    // A denial is a decision. Replaying it should not give the agent a second
    // chance at a question the operator has already said no to.
    const book = new CountersignBook();
    raise(book);
    book.settle("tc1", { status: "denied", reason: "not in scope", at: NOW });
    book.close("tc1");

    expect(book.settled("tc1")).toBe(true);
  });

  it("lets an expired gate be asked again", () => {
    // Nothing ran, so the operator missed their chance rather than used it.
    // A tombstone here would silently drop a request never answered.
    const book = new CountersignBook();
    raise(book);
    expect(book.sweep(NOW + 60_000, 30_000)).toEqual(["tc1"]);

    expect(book.settled("tc1")).toBe(false);
  });
});
