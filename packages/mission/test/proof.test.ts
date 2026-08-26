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

  it("refuses a check that failed without echoing the sandbox output", () => {
    // The output is the sandbox's, and it has read whatever the scope allowed.
    // Returning it from an endpoint returns it to whoever can reach that
    // endpoint, which on a control plane with no auth of its own is wider than
    // the operator. The working is already on the feed, beside the gate.
    const failed: SandboxProof = {
      script: "python3 -c 'assert 4900 == 39900'",
      output: '{"response":{"exitCode":1,"result":"AssertionError: customer@example.test"}}',
      passed: false,
    };
    const verdict = proofAuthorises(failed, refundCall);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.detail).not.toContain("customer@example.test");
      expect(verdict.detail).toContain("beside the gate");
    }
  });

  it("refuses a longer number that merely contains the amount", () => {
    // `14900` contains `4900`, so substring matching let a proof for a
    // fourteen-thousand-nine-hundred refund satisfy a pending forty-nine-pound
    // one. An amount has to appear as its own token.
    const bigger: SandboxProof = {
      script: "check",
      output: '{"response":{"exitCode":0,"result":"ch_3U8THZ verified for 14900"}}',
      passed: true,
    };
    expect(proofAuthorises(bigger, refundCall).ok).toBe(false);
  });

  it("accepts an amount that ends a sentence", () => {
    // Prose ends with a full stop, and "ready to refund 4900." is a perfectly
    // good mention. Excluding it made the check reject its own real output.
    const prose: SandboxProof = {
      script: "check",
      output: '{"response":{"exitCode":0,"result":"ch_3U8THZ ready to refund 4900."}}',
      passed: true,
    };
    expect(proofAuthorises(prose, refundCall).ok).toBe(true);
  });

  it("refuses a decimal that starts with the amount", () => {
    // `4900.50` is a different amount, however much it looks like this one.
    const decimal: SandboxProof = {
      script: "check",
      output: '{"response":{"exitCode":0,"result":"ch_3U8THZ verified 4900.50"}}',
      passed: true,
    };
    expect(proofAuthorises(decimal, refundCall).ok).toBe(false);
  });

  it("refuses an id that is only a prefix of the one in the working", () => {
    const other: SandboxProof = {
      script: "check",
      output: '{"response":{"exitCode":0,"result":"ch_3U8THZQQ ready for 4900"}}',
      passed: true,
    };
    expect(proofAuthorises(other, refundCall).ok).toBe(false);
  });

  it("matches against the output rather than the script the agent wrote", () => {
    // Both are agent-influenced, but the output is at least produced by running
    // something, so a script that never executed cannot supply it.
    const scriptOnly: SandboxProof = {
      script: "print('ch_3U8THZ 4900')",
      output: '{"response":{"exitCode":0,"result":"done"}}',
      passed: true,
    };
    expect(proofAuthorises(scriptOnly, refundCall).ok).toBe(false);
  });

  it("accepts a call with nothing identifying to match", () => {
    // A gated office taking only free text has nothing a proof could quote, so
    // the content check has no opinion and the passing check stands on its own.
    expect(proofAuthorises(refundProof, { body: "anything" }).ok).toBe(true);
  });
});

describe("the brief and the check agree", () => {
  it("accepts the verdict shape the brief now asks for", async () => {
    // The instruction and the enforcement have to want the same thing. An
    // earlier brief asked only for "a verdict", so a compliant agent printed
    // one naming the amount and not the charge and was refused at the gate for
    // having verified something unrelated -- a deadlock reached by doing
    // exactly as told.
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({
      scope: {
        missionId: "m".repeat(20),
        scopeId: "SC-1",
        agent: "a",
        job: "Refund order #184",
        state: "granted",
        offices: ["charge.refund"],
        resources: { charge_ids: ["ch_184"] },
        limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: {}, maxResponseBytes: 1 },
        projection: {},
        countersignRequired: ["charge.refund"],
        expiresAt: 2,
        grantedBy: null,
        grantedAt: null,
        version: 0,
      } as never,
      sandbox: true,
    });

    expect(brief).toMatch(/must contain the exact identifiers and amounts/i);
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
