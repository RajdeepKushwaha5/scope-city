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
 * about something else. Identifying arguments are matched against the script and
 * its output, which is exactly the working a human would read before signing.
 *
 * And a proof is spent when it is used. Without that, one check authorises every
 * subsequent gate for the same resource -- the agent verifies a refund once and
 * the second refund of the same charge rides on it. Consuming it mirrors
 * `consumeFingerprint`, for the same reason: evidence is for one decision.
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
 * Whether a proof may authorise this call.
 *
 * Every identifying argument must appear somewhere in the working. Requiring
 * *all* of them rather than any is deliberate: a proof mentioning the right
 * charge and the wrong amount is evidence about a different refund, and that is
 * precisely the drift a countersign is supposed to catch.
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
    return {
      ok: false,
      reason: "the sandbox check did not pass",
      detail: proof.output.slice(0, 400),
    };
  }

  const haystack = `${proof.script}\n${proof.output}`;
  const missing = identifyingArguments(args).filter((value) => !haystack.includes(value));

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
