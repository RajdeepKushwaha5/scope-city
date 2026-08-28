/**
 * How hard the model is asked to think, as one shared fact.
 *
 * This list was briefly written down three times: registered against each model
 * slot, validated in the HTTP handler, and offered in the dialog. Three copies
 * of a contract drift, and the failure when they do is not obvious -- a level
 * offered in the UI but not registered on the slot produces a dispatch the
 * operator has already pressed, which then dies at session creation with a 422.
 *
 * So it lives here, in the package both the control plane and the city already
 * depend on, and the copies import it.
 *
 * Three levels rather than TrueForge's seven. `custom` providers may declare any
 * of them, but these are the ones Google itself advertises for its
 * reasoning-capable Gemini models, and claiming a wider range than the provider
 * describes is the kind of gap this project exists to argue against.
 */

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

export type EffortParse =
  | { readonly ok: true; readonly effort: ReasoningEffort | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Read an operator's requested effort off an untrusted request body.
 *
 * Absent means no preference and is the only thing that may launch without one.
 * Anything *present* has to be a supported level, because the alternative --
 * coercing what is not a string to an empty string and treating that as absence
 * -- let numbers, booleans, arrays, objects and null all launch as though the
 * field had never been sent. A malformed request that silently becomes a
 * different valid request is worse than one that is refused.
 */
export function parseReasoningEffort(value: unknown): EffortParse {
  if (value === undefined) return { ok: true, effort: null };
  if (isReasoningEffort(value)) return { ok: true, effort: value };

  return {
    ok: false,
    reason: `effort must be one of ${REASONING_EFFORTS.join(", ")}`,
  };
}

/**
 * How many turns the agent gets, by effort.
 *
 * Without this, effort was a hint to the provider and nothing else: an agent
 * asked for "low" still had the same twenty-four iterations to grind through
 * the job, so the label described the thinking and not the work. A budget that
 * does not move when the setting does is the gap between stated and actual all
 * over again, in the one control an operator is given.
 *
 * The ceiling stays where it was, so "high" behaves exactly as every run has
 * until now and only the lower settings mean anything new.
 */
const ITERATION_BUDGET: Record<ReasoningEffort, number> = {
  low: 12,
  medium: 18,
  high: 24,
};

/**
 * The turn budget for an effort, or the ceiling when none was chosen.
 *
 * Takes `unknown` rather than a narrowed type, because the caller receives the
 * effort as a plain string from a request body. Typing the parameter narrowly
 * meant the call site cast to satisfy it, and a cast is not a check: an effort
 * of "xhigh" -- valid to TrueForge, not registered on these slots -- indexed
 * the table, missed, and put `undefined` into the agent spec's iteration limit.
 * A run with no budget at all is not the low-cost run the label promised.
 *
 * Anything unrecognised falls back to the ceiling, which is what every run did
 * before budgets existed. Failing open here is right: the effort is a
 * preference, and the boundary that actually matters is the scope.
 */
export function iterationLimitFor(effort: unknown): number {
  return isReasoningEffort(effort) ? ITERATION_BUDGET[effort] : ITERATION_BUDGET.high;
}
