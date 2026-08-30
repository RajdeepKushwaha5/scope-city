import { describe, expect, it } from "vitest";
import {
  newOperatorKeyBase64,
  operatorSigner,
  verifyCountersign,
} from "../src/operator-key.js";
import { CountersignBook } from "../src/countersign-book.js";
import type { Scope } from "@scope-city/scope";

const NOW = 1_000_000;

function scopeOf(): Scope {
  return {
    missionId: "m_signing_test_0001",
    scopeId: "SC-SIGN",
    agent: "refund-agent",
    job: "Refund order 184",
    state: "granted",
    offices: ["charge.refund"],
    resources: { charge_ids: ["ch_184"] },
    limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: {}, maxResponseBytes: 64_000 },
    projection: {},
    countersignRequired: ["charge.refund"],
    expiresAt: NOW + 600_000,
    grantedBy: "operator:test",
    grantedAt: NOW,
    version: 1,
  } as Scope;
}

/**
 * The chain proves the record was not edited. It cannot prove a human approved,
 * because until this existed the record was the only witness to itself:
 * `approved: true` was a line the process wrote about its own behaviour, and
 * anyone able to rewrite the file could produce as many as they liked.
 */
describe("signing an approval so a stranger can check it", () => {
  /*
   * Refusals first. Every test above the line is a signature that must not be
   * accepted, because a signature that verifies too easily is worse than none:
   * it invites the reader to stop checking.
   */

  it("refuses a signature over a different call", () => {
    // The property that makes this worth having. An approval cannot be lifted
    // off one call and dropped onto another, because the fingerprint it covers
    // is part of what was signed.
    const { signer } = operatorSigner(newOperatorKeyBase64());
    const signed = signer.sign("fingerprint-of-the-call-they-read");

    expect(
      verifyCountersign({
        fingerprint: "fingerprint-of-a-different-call",
        signature: signed.signature,
        publicKeyPem: signer.publicKeyPem,
      }),
    ).toBe(false);
  });

  it("refuses a signature from another key", () => {
    const a = operatorSigner(newOperatorKeyBase64()).signer;
    const b = operatorSigner(newOperatorKeyBase64()).signer;
    const signed = a.sign("abc");

    expect(
      verifyCountersign({
        fingerprint: "abc",
        signature: signed.signature,
        publicKeyPem: b.publicKeyPem,
      }),
    ).toBe(false);
  });

  it("refuses a tampered signature rather than throwing", () => {
    // The verifier's job is to answer the question. A malformed input is a
    // failed verification, not a crash that leaves the reader with nothing.
    const { signer } = operatorSigner(newOperatorKeyBase64());
    const signed = signer.sign("abc");

    expect(
      verifyCountersign({
        fingerprint: "abc",
        signature: "not base64 at all !!",
        publicKeyPem: signer.publicKeyPem,
      }),
    ).toBe(false);
    expect(
      verifyCountersign({ fingerprint: "abc", signature: signed.signature, publicKeyPem: "junk" }),
    ).toBe(false);
  });

  it("does not sign a denial", () => {
    // There is nothing to attest to. The call did not happen, and
    // `gate.cleared { approved: false }` is a control that fired rather than a
    // claim about who authorised anything.
    const { signer } = operatorSigner(newOperatorKeyBase64());
    const book = new CountersignBook(signer);
    book.raise({
      scope: scopeOf(),
      toolCallId: "call_1",
      threadId: "main",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount_minor: 4900 },
      now: NOW,
    });

    book.settle("call_1", { status: "denied", reason: "no", at: NOW });
    expect(book.signatureFor("call_1")).toBeUndefined();
  });

  // --- and what a good signature does --------------------------------------

  it("signs the fingerprint the operator's approval was already bound to", () => {
    /*
     * One value carries both properties. The fingerprint stops an approval
     * being reused for a different call; the signature stops it being invented
     * by whatever wrote the record. Signing anything else would have left the
     * two guarantees describing different things.
     */
    const { signer } = operatorSigner(newOperatorKeyBase64());
    const book = new CountersignBook(signer);
    const raised = book.raise({
      scope: scopeOf(),
      toolCallId: "call_1",
      threadId: "main",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount_minor: 4900 },
      now: NOW,
    });

    book.settle("call_1", { status: "approved", at: NOW });
    const signed = book.signatureFor("call_1")!;

    expect(signed.algorithm).toBe("ed25519");
    expect(
      verifyCountersign({
        fingerprint: raised.fingerprint,
        signature: signed.signature,
        publicKeyPem: signer.publicKeyPem,
      }),
    ).toBe(true);
  });

  it("still gates without a key, because a signature is for the reader", () => {
    // Nothing in the enforcement path reads a signature. A book with no signer
    // decides exactly as it did before, so an instance without a key is not a
    // less safe instance, only a less checkable record.
    const book = new CountersignBook();
    book.raise({
      scope: scopeOf(),
      toolCallId: "call_1",
      threadId: "main",
      office: "charge.refund",
      args: { charge_id: "ch_184", amount_minor: 4900 },
      now: NOW,
    });

    book.settle("call_1", { status: "approved", at: NOW });
    expect(book.signatureFor("call_1")).toBeUndefined();
    expect(book.settled("call_1")).toBe(true);
  });

  it("keeps the same operator id across restarts of a configured key", () => {
    // A reader should be able to say two missions were approved by the same
    // operator. That only works if the id is a function of the key.
    const key = newOperatorKeyBase64();
    expect(operatorSigner(key).signer.operator).toBe(operatorSigner(key).signer.operator);
    expect(operatorSigner(key).signer.operator).not.toBe(
      operatorSigner(newOperatorKeyBase64()).signer.operator,
    );
  });

  it("says when it generated the key itself", () => {
    // A signature from a key that dies with the process is a weaker claim, and
    // the difference must not be silent.
    expect(operatorSigner("").ephemeral).toBe(true);
    expect(operatorSigner(newOperatorKeyBase64()).ephemeral).toBe(false);
  });
});
