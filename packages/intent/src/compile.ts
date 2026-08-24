import { resolverSafeFields, ScopeSchema, type OfficeRegistry, type Scope } from "@scope-city/scope";
import type { IntentEnvelope, Resolution } from "./envelope.js";

/**
 * Stage 3: the envelope and the resolution become an actual Scope.
 *
 * This is the last point at which authority can be shaped, and it is where the
 * default projection is chosen -- which matters more than it looks. Projection
 * decides what comes *back*, and an office's declared response surface is
 * routinely far wider than the job needs: `charge.get` can return a customer's
 * whole payment history when the job is "refund one order".
 *
 * So the default here is not "everything the office can return". It is the
 * fields the resolver was allowed to read, which is the same subtraction of
 * attacker-writable prose, minus nothing else. That is still wider than ideal
 * -- narrowing it further is what the operator does on the grant screen, and
 * what the over-reach analysis exists to recommend -- but it means a scope
 * compiled with no further thought does not leak free text by default.
 */

export interface CompileParams {
  readonly missionId: string;
  readonly scopeId: string;
  readonly agent: string;
  readonly envelope: IntentEnvelope;
  readonly resolution: Resolution;
  readonly registry: OfficeRegistry;
  /** Epoch millis. Passed rather than read, like everything else in this layer. */
  readonly now: number;
}

/**
 * Whether every resource class the scope's offices consult has at least one id.
 *
 * A scope with an office that takes a `charge_id` and no charge ids granted is
 * not a tight scope, it is a broken one: every call it makes will be refused
 * for `resource_not_in_scope`, and the demo looks like the enforcement is
 * misfiring rather than the resolution having failed. Better to say so before
 * the operator grants it.
 */
export function unfilledClasses(params: {
  readonly offices: readonly string[];
  readonly resources: Readonly<Record<string, readonly string[]>>;
  readonly registry: OfficeRegistry;
}): readonly string[] {
  const missing = new Set<string>();
  for (const office of params.offices) {
    const spec = params.registry.get(office);
    if (!spec) continue;
    for (const binding of Object.values(spec.args)) {
      if (binding.kind !== "resource") continue;
      const ids = params.resources[binding.resourceClass];
      if (!ids || ids.length === 0) missing.add(binding.resourceClass);
    }
  }
  return [...missing].sort();
}

/**
 * Offices that can actually be used with the resources on hand.
 *
 * A verb drags its whole chain into the draft -- "refund order #184" needs a
 * lookup chain, and the drafter cannot know in advance which links the operator
 * will have given it enough to use. Asking for a ticket the operator never
 * mentioned leaves `ticket.get` in the scope with no ticket id, and every call
 * it makes is refused for `resource_not_in_scope`. On the map that reads as the
 * enforcement misfiring, when in truth the scope was wrong.
 *
 * Dropping those offices is a narrowing, so it is always safe, and it produces
 * the tighter scope that should have been proposed in the first place: the
 * agent is handed exactly the offices it can complete work with.
 */
export function usableOffices(params: {
  readonly offices: readonly string[];
  readonly resources: Readonly<Record<string, readonly string[]>>;
  readonly registry: OfficeRegistry;
}): readonly string[] {
  return params.offices.filter((office) => {
    const spec = params.registry.get(office);
    if (!spec) return false;
    for (const [, binding] of Object.entries(spec.args)) {
      if (binding.kind !== "resource" || !binding.required) continue;
      const ids = params.resources[binding.resourceClass];
      if (!ids || ids.length === 0) return false;
    }
    return true;
  });
}

export function compileScope(params: CompileParams): Scope {
  const { envelope, resolution, registry } = params;

  const resolved: Record<string, readonly string[]> = {};
  for (const [cls, ids] of Object.entries(resolution.resolved)) {
    if (ids.length > 0) resolved[cls] = [...ids].sort();
  }

  const offices = usableOffices({ offices: envelope.offices, resources: resolved, registry });

  // Resources are then narrowed to what the surviving offices consult.
  //
  // Resolution follows every chain it can, so it routinely learns more than the
  // job needs -- looking up a ticket to reply to it also reveals an order and a
  // charge. Carrying those into the grant would put resources on the screen
  // that no granted office can reach, which is noise at best and, on a screen
  // whose whole purpose is showing the operator the extent of what they are
  // authorising, actively misleading.
  const consulted = new Set<string>();
  for (const office of offices) {
    const spec = registry.get(office);
    if (!spec) continue;
    for (const binding of Object.values(spec.args)) {
      if (binding.kind === "resource") consulted.add(binding.resourceClass);
    }
  }

  const resources: Record<string, readonly string[]> = {};
  for (const [cls, ids] of Object.entries(resolved)) {
    if (consulted.has(cls)) resources[cls] = ids;
  }

  const projection: Record<string, readonly string[]> = {};
  for (const office of offices) {
    const spec = registry.get(office);
    if (spec) projection[office] = resolverSafeFields(spec);
  }

  return ScopeSchema.parse({
    missionId: params.missionId,
    scopeId: params.scopeId,
    agent: params.agent,
    job: envelope.job,
    // Proposed, never granted. Nothing in this file may hand out authority --
    // only an operator can move a scope to `granted`, and routing every scope
    // through that step is what keeps the grant a human act rather than a
    // formality the pipeline performs on their behalf.
    state: "proposed",
    offices,
    resources,
    limits: {
      // Limits follow the pruned list. A ceiling naming an office that is not
      // in the scope is dead configuration, and dead configuration is where a
      // later reader looks for authority that is not there.
      maxAmountMinor: pick(envelope.maxAmountMinor, offices),
      maxCalls: pick(envelope.maxCalls, offices),
      maxResponseBytes: 64_000,
    },
    projection,
    countersignRequired: envelope.countersignRequired.filter((o) => offices.includes(o)),
    expiresAt: params.now + envelope.ttlMs,
    grantedBy: null,
    grantedAt: null,
    version: 0,
  });
}

function pick(
  record: Readonly<Record<string, number>>,
  offices: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const office of offices) {
    const value = record[office];
    if (value !== undefined) out[office] = value;
  }
  return out;
}
