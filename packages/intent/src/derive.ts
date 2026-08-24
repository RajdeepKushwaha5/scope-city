import {
  IntentEnvelopeSchema,
  type IntentEnvelope,
} from "./envelope.js";
import type { OfficeRegistry } from "@scope-city/scope";

/**
 * Turning a raw derivation into an envelope that is safe to propose.
 *
 * The model that produces the draft is doing language work, not security work,
 * and it is the one component here an attacker might eventually influence. So
 * nothing it returns is trusted as authority. Everything below is a
 * *narrowing*: this function can remove an office, lower a ceiling, shorten a
 * lifetime, or add a gate. It can never do the opposite.
 *
 * Stated as the invariant worth testing: for any model output whatsoever, the
 * resulting envelope is a subset of what the caller's bounds already allowed.
 * A compromised or simply confused derivation therefore degrades to a smaller
 * scope, and the failure mode of this file is an agent that cannot do its job
 * -- which is the correct direction to fail in.
 */

export interface DerivationBounds {
  /** Nothing outside this may ever be proposed, whatever the model says. */
  readonly registry: OfficeRegistry;
  /** Offices that always stop for a human, regardless of the draft. */
  readonly alwaysCountersign: readonly string[];
  /** Hard ceiling on any monetary argument, integer minor units. */
  readonly maxAmountMinorCeiling: number;
  /** Hard ceiling on call counts. */
  readonly maxCallsCeiling: number;
  /** Longest authority this operator may issue, milliseconds. */
  readonly maxTtlMs: number;
}

/** The shape a derivation turn is asked to return. Everything is optional. */
export interface RawDerivation {
  readonly offices?: unknown;
  readonly named?: unknown;
  readonly maxAmountMinor?: unknown;
  readonly maxCalls?: unknown;
  readonly ttlMs?: unknown;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) out[key] = raw;
  }
  return out;
}

/**
 * Constrains a raw derivation into a proposable envelope.
 *
 * Pure, and deliberately so: this is the security-relevant half of stage 1, and
 * it must be testable against adversarial input without a model in the loop.
 */
export function constrainEnvelope(params: {
  readonly job: string;
  readonly raw: RawDerivation;
  readonly bounds: DerivationBounds;
}): IntentEnvelope {
  const { job, raw, bounds } = params;

  // Offices the registry does not declare are dropped rather than rejected.
  // An undeclared office has no arg bindings and no response-field list, so the
  // evaluator could not police it and the projector could not filter it --
  // proposing one would be proposing something unenforceable.
  const offices = [...new Set(stringArray(raw.offices))]
    .filter((office) => bounds.registry.has(office))
    .sort();

  // Which resource classes the granted offices actually consult. A named
  // resource for a class no office reads is dead weight in the grant screen and
  // a place for a mistake to hide, so it is discarded.
  const usedClasses = new Set<string>();
  for (const office of offices) {
    const spec = bounds.registry.get(office);
    if (!spec) continue;
    for (const binding of Object.values(spec.args)) {
      if (binding.kind === "resource") usedClasses.add(binding.resourceClass);
    }
  }

  const named: Record<string, string[]> = {};
  if (typeof raw.named === "object" && raw.named !== null) {
    for (const [cls, value] of Object.entries(raw.named as Record<string, unknown>)) {
      if (!usedClasses.has(cls)) continue;
      const ids = [...new Set(stringArray(value))].sort();
      if (ids.length > 0) named[cls] = ids;
    }
  }

  // A class an office needs but the operator could not name is what stage 2
  // exists to fill. Recording it lets the grant screen say "pending" instead of
  // showing an empty grant that looks like a bug.
  const unresolved = [...usedClasses].filter((cls) => !named[cls]).sort();

  // Ceilings clamp; they never raise. A model asking for a bigger number than
  // the operator's own limit gets the operator's limit.
  const maxAmountMinor: Record<string, number> = {};
  for (const [office, value] of Object.entries(numberRecord(raw.maxAmountMinor))) {
    if (!offices.includes(office)) continue;
    maxAmountMinor[office] = Math.min(value, bounds.maxAmountMinorCeiling);
  }

  const maxCalls: Record<string, number> = {};
  for (const [office, value] of Object.entries(numberRecord(raw.maxCalls))) {
    if (!offices.includes(office)) continue;
    if (value <= 0) continue;
    maxCalls[office] = Math.min(value, bounds.maxCallsCeiling);
  }

  // Every mutating office gets a call budget whether the draft asked for one or
  // not. An unbudgeted mutating office is an unbounded one, and "the model
  // forgot to mention it" is not a reason to hand out unlimited refunds.
  for (const office of offices) {
    if (maxCalls[office] !== undefined) continue;
    if (bounds.registry.get(office)?.mutating) maxCalls[office] = 1;
  }

  const ttlRaw = typeof raw.ttlMs === "number" && raw.ttlMs > 0 ? raw.ttlMs : bounds.maxTtlMs;
  const ttlMs = Math.min(Math.floor(ttlRaw), bounds.maxTtlMs);

  // The gate is added here, never read from the draft. If the model could
  // decide which actions need a human, an injected instruction could decide it
  // was not this one.
  const countersignRequired = offices.filter((office) =>
    bounds.alwaysCountersign.includes(office),
  );

  return IntentEnvelopeSchema.parse({
    job,
    offices,
    named,
    unresolved,
    maxAmountMinor,
    maxCalls,
    ttlMs,
    countersignRequired,
  });
}
