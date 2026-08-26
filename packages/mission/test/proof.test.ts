import { describe, expect, it } from "vitest";
import { identifyingArguments, proofAuthorises, type SandboxProof } from "../src/proof.js";

/**
 * The bug these exist for, stated plainly.
 *
 * A mission kept only its most recent sandbox verification, so any passing
 * check authorised any pending irreversible call. The shipped recording
 * demonstrated it: the agent verified a refund, the refund was countersigned,
 * and then a `mail.send` gate was approved on the strength of the refund's
 * working -- nothing was ever checked about the mail.
 */

const refundProof: SandboxProof = {
  script: 'python3 -c "\namount_to_refund = 4900\nrecord_amount = 4900\nassert amount_to_refund == record_amount\n"',
  output: '{"response":{"exitCode":0,"result":"Verdict: ch_3U8THZ ready to refund 4900.\\n"}}',
  passed: true,
};

const refundCall = { charge_id: "ch_3U8THZ", amount: 4900 };
const mailCall = { to: "customer@example.test", body: "Your refund is on its way" };

describe("proofAuthorises", () => {
  it("accepts working that is about this call", () => {
    expect(proofAuthorises(refundProof, refundCall).ok).toBe(true);
  });

  it("refuses a different call riding on the same proof", () => {
    // The headline bug. A refund's working says nothing about sending mail.
    const verdict = proofAuthorises(refundProof, mailCall);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("not about this call");
  });

  it("refuses the right resource at the wrong amount", () => {
    // Requiring *every* identifying argument rather than any: a proof naming
    // the correct charge and a different amount is evidence about a different
    // refund, which is exactly the drift a countersign catches.
    const verdict = proofAuthorises(refundProof, { charge_id: "ch_3U8THZ", amount: 39900 });
    expect(verdict.ok).toBe(false);
  });

  it("refuses when no check has run", () => {
    const verdict = proofAuthorises(undefined, refundCall);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("no sandbox verification");
  });

  it("refuses a check that failed, and says what it said", () => {
    const failed: SandboxProof = {
      script: "python3 -c 'assert 4900 == 39900'",
      output: '{"response":{"exitCode":1,"result":"AssertionError"}}',
      passed: false,
    };
    const verdict = proofAuthorises(failed, refundCall);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.detail).toContain("AssertionError");
  });

  it("accepts a call with nothing identifying to match", () => {
    // A gated office taking only free text has nothing a proof could quote, so
    // the content check has no opinion and the passing check stands on its own.
    expect(proofAuthorises(refundProof, { body: "anything" }).ok).toBe(true);
  });
});

describe("identifyingArguments", () => {
  it("takes ids and amounts", () => {
    expect(identifyingArguments(refundCall)).toEqual(["ch_3U8THZ", "4900"]);
  });

  it("ignores free text an attacker writes", () => {
    // Requiring the proof to quote a ticket body would let whoever wrote the
    // ticket choose what the verification has to say.
    expect(identifyingArguments(mailCall)).toEqual(["customer@example.test"]);
    expect(identifyingArguments({ subject: "urgent", note: "please" })).toEqual([]);
  });

  it("ignores values with whitespace, which are prose rather than ids", () => {
    expect(identifyingArguments({ label: "two words" })).toEqual([]);
  });
});
