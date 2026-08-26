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
