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

  /** Drops a settled entry once the call it guarded has run or failed. */
  close(toolCallId: string): void {
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
