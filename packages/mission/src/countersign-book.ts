import type { Scope } from "@scope-city/scope";
import { fingerprintCall } from "@scope-city/proxy";

/**
 * Where the two halves of an approval meet.
 *
 * TrueForge asks the human: it emits tool.approval_required with the arguments
 * the operator reads, pauses the turn, and resumes when a later turn carries
 * their verdict. The proxy, separately, is about to perform a call.
 *
 * Nothing connects those on its own. The harness knows what was shown; the
 * proxy knows what is about to run; only something holding both can say whether
 * they are the same call. Without that, an operator who approved "refund $49 on
 * ch_184" has, as far as the system is concerned, approved a refund -- and the
 * model is free to submit a different one.
 *
 * This is that something. It is deliberately small and synchronous: it makes
 * one decision, and the decision is a comparison.
 */

export interface PendingCountersign {
  readonly toolCallId: string;
  readonly threadId: string;
  readonly office: string;
  readonly args: Record<string, unknown>;
  /** Fingerprint of the call as the operator saw it. */
  readonly fingerprint: string;
  readonly raisedAt: number;
}

export type Verdict =
  | { readonly status: "approved"; readonly at: number }
  | { readonly status: "denied"; readonly reason?: string; readonly at: number };

export class CountersignBook {
  readonly #pending = new Map<string, PendingCountersign>();
  readonly #verdicts = new Map<string, Verdict>();
  /**
   * Calls whose verdict has been spent, kept as bare ids with no verdict
   * attached.
   *
   * A decided verdict is deliberately deleted the moment the call it guarded
   * runs, so that nothing can reuse an approval. That left the replay guard
   * blind to exactly the gates that matter most: a resumed session replaying
   * an approval whose call has already gone through would find no verdict,
   * decide the gate was new, and put a spent countersign back in front of the
   * operator -- asking them to authorise a payment already made.
   *
   * A tombstone is not an authorisation and cannot become one. `check` and
   * `checkFingerprint` read `#verdicts` alone, so a replayed call still has
   * nothing to proceed on. This set answers only "has the operator already
   * dealt with this", which is a different question.
   */
  readonly #decided = new Set<string>();

  /**
   * Records what the operator is being shown, fingerprinted against the scope
   * they are being shown it under. A scope version bump invalidates it, because
   * an approval granted under one set of limits does not carry to another.
   */
  raise(params: {
    scope: Scope;
    toolCallId: string;
    threadId: string;
    office: string;
    args: Record<string, unknown>;
    now: number;
  }): PendingCountersign {
    const { scope, toolCallId, threadId, office, args, now } = params;

    const entry: PendingCountersign = {
      toolCallId,
      threadId,
      office,
      args,
      fingerprint: fingerprintCall({
        scope,
        call: { office, args, attemptedAt: now },
      }),
      raisedAt: now,
    };

    this.#pending.set(toolCallId, entry);
    return entry;
  }

  pending(toolCallId: string): PendingCountersign | undefined {
    return this.#pending.get(toolCallId);
  }

  /**
   * Whether this call has already been decided.
   *
   * Asked when a session is resumed after an interruption. The harness replays
   * what it was doing, so a gate the operator already answered can arrive a
   * second time -- and putting it back in front of them would ask for a
   * countersign they have given, on a call that may by then have run.
   */
  settled(toolCallId: string): boolean {
    return this.#verdicts.has(toolCallId) || this.#decided.has(toolCallId);
  }

  /** Everything currently awaiting a human, for the map to render as raised gates. */
  allPending(): readonly PendingCountersign[] {
    return [...this.#pending.values()];
  }

  /** Records the operator's decision. Returns false if nothing was waiting. */
  settle(toolCallId: string, verdict: Verdict): boolean {
    if (!this.#pending.has(toolCallId)) return false;
    this.#verdicts.set(toolCallId, verdict);
    return true;
  }

  /**
   * Answers the proxy's question: may this exact call proceed?
   *
   * Three things must all hold. The operator must have decided; they must have
   * approved; and the call about to run must fingerprint identically to the one
   * they read. A mismatch is not an error to recover from -- it means the call
   * drifted after it was shown, so the approval does not apply to it.
   */
  check(toolCallId: string, fingerprint: string): {
    approved: boolean;
    fingerprint: string;
    reason?: string;
  } {
    const verdict = this.#verdicts.get(toolCallId);
    if (!verdict) {
      return { approved: false, fingerprint: "", reason: "no verdict recorded" };
    }
    if (verdict.status === "denied") {
      return { approved: false, fingerprint: "", reason: verdict.reason ?? "the operator refused" };
    }

    const entry = this.#pending.get(toolCallId);
    if (!entry) {
      return { approved: false, fingerprint: "", reason: "nothing was raised for this call" };
    }

    // Returning the recorded fingerprint rather than the one we were asked
    // about lets the proxy do the comparison itself. A book that answered
    // "approved" and echoed the caller's own fingerprint back would agree with
    // whatever it was told.
    return {
      approved: true,
      fingerprint: entry.fingerprint,
      reason: entry.fingerprint === fingerprint ? undefined : "the approved call is not this call",
    };
  }

  /**
   * Answers the proxy, which does not know TrueForge's tool_call_id.
   *
   * This is the binding that matters, and it only works because the two sides
   * are computed from different sources. `raise` fingerprints the arguments
   * TrueForge *displayed to the operator*; the proxy fingerprints the call it
   * is *about to execute*. If those two agree, the operator approved this call.
   * If they do not, something changed in between and the approval does not
   * apply to it.
   *
   * A caller that passes in a fingerprint and receives "approved" plus that
   * same fingerprint back has learned nothing, so this returns a decision and
   * never echoes its input.
   */
  checkFingerprint(fingerprint: string): {
    approved: boolean;
    toolCallId?: string;
    reason?: string;
  } {
    const matches = [...this.#pending.entries()].filter(
      ([, entry]) => entry.fingerprint === fingerprint,
    );
    if (matches.length > 1) {
      return {
        approved: false,
        reason: "multiple gated calls have this fingerprint; tool-call identity is ambiguous",
      };
    }
    const match = matches[0];
    if (match) {
      const [toolCallId] = match;
      const verdict = this.#verdicts.get(toolCallId);
      if (!verdict) {
        return { approved: false, toolCallId, reason: "the operator has not decided yet" };
      }
      if (verdict.status === "denied") {
        return {
          approved: false,
          toolCallId,
          reason: verdict.reason ?? "the operator refused",
        };
      }
      return { approved: true, toolCallId };
    }

    // Nothing was raised for this call. Either the harness never gated it, or
    // the call being made is not the call that was shown.
    return { approved: false, reason: "no approval was granted for this exact call" };
  }

  /**
   * Atomically takes the verdict for one exact call.
   *
   * The proxy has no TrueForge tool-call id, so a fingerprint is safe only
   * when it names exactly one raised gate. A decided verdict is removed before
   * the upstream action starts: success, failure and retry must all see it as
   * spent. Undecided gates stay pending because an early proxy request must not
   * erase the operator's chance to answer.
   */
  consumeFingerprint(fingerprint: string): {
    approved: boolean;
    toolCallId?: string;
    reason?: string;
  } {
    const result = this.checkFingerprint(fingerprint);
    if (!result.toolCallId) return result;
    if (!this.#verdicts.has(result.toolCallId)) return result;
    this.close(result.toolCallId);
    return result;
  }

  /**
   * Drops a settled entry once the call it guarded has run or failed.
   *
   * Leaves a tombstone when there was a verdict to spend, so a replay of that
   * call is recognised as already dealt with. An entry closed without one --
   * a gate that expired unanswered -- gets none: nothing ran, and if the agent
   * asks again the operator should get the chance they missed.
   */
  close(toolCallId: string): void {
    if (this.#verdicts.has(toolCallId)) this.#decided.add(toolCallId);
    this.#pending.delete(toolCallId);
    this.#verdicts.delete(toolCallId);
  }

  /**
   * Expires anything the operator never answered. A gate left raised forever
   * holds a quota claim open, so it has to time out rather than wait.
   */
  sweep(now: number, maxAgeMs: number): readonly string[] {
    const expired: string[] = [];
    for (const [id, entry] of this.#pending) {
      if (now - entry.raisedAt > maxAgeMs && !this.#verdicts.has(id)) {
        expired.push(id);
        this.close(id);
      }
    }
    return expired;
  }
}
