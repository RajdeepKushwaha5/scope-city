import type { FailureKind } from "@scope-city/harness";

/**
 * Whether an interrupted session is worth holding on to.
 *
 * A pure function because the decision has three conditions that each look
 * obviously right and are each wrong in a different direction, and the only way
 * to keep them honest is to be able to test them without a control plane, a
 * model pool, or a live TrueForge.
 */

export interface AttemptOutcome {
  readonly kind: FailureKind;
  /**
   * Whether the agent actually did anything this attempt.
   *
   * Not the feed cursor. The control plane appends its own status messages --
   * "running", "rotating" -- to the same feed, and it publishes "running"
   * *before* the turn starts, so a cursor comparison is true even for an
   * attempt whose first call failed. Only work the agent or the boundary did
   * counts: an office reached, a call judged, a gate raised.
   *
   * Asked of the session, not of the turn. A held session that is limited
   * again before it emits anything new still holds everything the earlier
   * attempts established, so the caller carries this forward across a resume
   * rather than recomputing it from one turn's events.
   */
  readonly didWork: boolean;
  readonly sessionId: string | undefined;
}

export function shouldKeepSession(outcome: AttemptOutcome): boolean {
  // Only a rate limit. A rejected credential, an exhausted quota or a malformed
  // spec will fail identically after any wait, and holding a session open for
  // one spends the wait budget on a key that is finished.
  if (outcome.kind !== "rate_limited") return false;

  // Only if there is something to carry. A session that fell over before doing
  // anything is worth no more than a fresh one, and preferring it pins the
  // mission to a model that is currently cooling for no gain.
  if (!outcome.didWork) return false;

  return outcome.sessionId !== undefined;
}

/**
 * World events that mean the agent or the boundary did something.
 *
 * `mission.status` is deliberately absent: it is the control plane narrating
 * itself, and counting it would make every attempt look productive.
 */
export function isWorkEvent(type: string): boolean {
  return (
    type === "agent.arrived" ||
    type === "agent.finished" ||
    type === "gate.raised" ||
    type === "gate.cleared" ||
    type === "yard.verified" ||
    type === "field.joined" ||
    type === "district.online"
  );
}
