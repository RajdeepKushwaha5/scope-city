/**
 * Binding a sandbox proof to the call it justifies.
 *
 * The gate already refuses an approval with no passing check behind it. That
 * turned out to be half the job, and the missing half is the same mistake the
 * countersign fingerprint exists to prevent -- made one layer up, by the person
 * who wrote the fingerprint.
 *
 * A mission kept only its most recent verification, so *any* passing check
 * authorised *any* pending irreversible call. The shipped recording demonstrates
 * it: the agent verified a refund, the refund was countersigned, and then a
 * `mail.send` gate was approved on the strength of the refund's working. Nothing
 * was ever checked about the mail.
 *
 * Two conditions now, and both are needed.
 *
 * The proof must be *about* this call. A verification that never mentions the
 * charge being refunded is not evidence about that refund, whatever it says
 * about something else. Identifying arguments are matched against the sandbox's
 * output -- both are ultimately agent-influenced, but the output is at least
 * produced by running something, so a script that never executed cannot supply
 * it.
 *
 * And a proof is spent when it is used. Without that, one check authorises every
 * subsequent gate for the same resource -- the agent verifies a refund once and
 * the second refund of the same charge rides on it. Consuming it mirrors
 * `consumeFingerprint`, for the same reason: evidence is for one decision.
 *
 * ## What this does not do
 *
 * It does not make a proof unforgeable, and saying so plainly matters more than
 * the feature does.
 *
 * The agent writes the script, so it produces the output. A script that prints
 * the right numbers without checking anything exits zero and matches, and no
 * amount of content matching fixes that -- the thing being constrained cannot
 * also be the thing attesting it is constrained. What this rules out is a proof
 * for a *different* call being reused for this one, which is the failure that
 * actually occurred.
 *
 * The defence against fabricated working is that a human reads it. That is why
 * the script and its output are displayed beside the gate rather than reduced
 * to a tick, and why the countersign is a person's act rather than a check the
 * machine performs on its own.
 */

export interface SandboxProof {
  readonly script: string;
  readonly output: string;
  readonly passed: boolean;
}

export type ProofVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

/**
 * The argument values that identify a call.
 *
 * Amounts and resource ids; not free text. A `body` or `subject` is written by
 * whoever raised the ticket, so requiring the proof to quote it would let an
 * attacker choose what the verification has to say.
 */
export function identifyingArguments(args: Readonly<Record<string, unknown>>): readonly string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (name === "body" || name === "subject" || name === "note") continue;
    if (typeof value === "number" && Number.isFinite(value)) out.push(String(value));
    else if (typeof value === "string" && value.length > 0 && !/\s/.test(value)) out.push(value);
  }
  return out;
}

/**
 * Whether `text` contains `value` as a standalone token.
 *
 * Substring matching was wrong in a way that mattered: `14900` contains `4900`,
 * so a proof verifying a fourteen-thousand-nine-hundred refund satisfied a
 * pending forty-nine-pound one. An identifier or amount has to appear on its own
 * rather than inside a longer number or id.
 */
function mentions(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Lookarounds rather than captured neighbours, so two adjacent matches cannot
  // consume each other's boundary. The trailing rule allows a full stop -- prose
  // ends sentences, and "ready to refund 4900." is a perfectly good mention --
  // while still rejecting `4900.50`, which is a different amount.
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])(?!\\.\\d)`).test(text);
}

/**
 * Whether a proof may authorise this call.
 *
 * Every identifying argument must appear in the working. Requiring *all* of
 * them rather than any is deliberate: a proof mentioning the right charge and
 * the wrong amount is evidence about a different refund, which is precisely the
 * drift a countersign is supposed to catch.
 */
export function proofAuthorises(
  proof: SandboxProof | undefined,
  args: Readonly<Record<string, unknown>>,
): ProofVerdict {
  if (!proof) {
    return {
      ok: false,
      reason: "no sandbox verification for this call",
      detail:
        "The agent has not shown its working. An irreversible action is not " +
        "approvable until the check it was asked to run has run.",
    };
  }

  if (!proof.passed) {
    // The output is deliberately not echoed here.
    //
    // It is the sandbox's, and the sandbox has read whatever the scope allowed
    // -- amounts, ids, whatever the agent printed while working. Returning it
    // from an endpoint means returning it to whoever can reach the endpoint,
    // which on a control plane with no auth of its own is a wider audience than
    // the operator. The working is already on the feed, where it renders beside
    // the gate for the person who is actually deciding.
    return {
      ok: false,
      reason: "the sandbox check did not pass",
      detail: "See the working beside the gate. The check the agent ran reported a failure.",
    };
  }

  // Matched against the sandbox's output, not the script the agent wrote. Both
  // are ultimately agent-influenced, but the output is at least produced by
  // running something, so a script that never executed cannot supply it.
  const missing = identifyingArguments(args).filter((value) => !mentions(proof.output, value));

  if (missing.length > 0) {
    return {
      ok: false,
      reason: "the sandbox verification is not about this call",
      detail:
        `The working never mentions ${missing.join(", ")}. A check that passed for ` +
        `something else is not evidence about this action.`,
    };
  }

  return { ok: true };
}
