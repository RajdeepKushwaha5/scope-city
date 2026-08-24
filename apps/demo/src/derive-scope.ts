import {
  compileScope,
  constrainEnvelope,
  draftFromText,
  resolve,
  whyUnusable,
  type IntentEnvelope,
  type Resolution,
  type ResolverIO,
} from "@scope-city/intent";
import {
  IRREVERSIBLE_OFFICES,
  exchequerSystem,
  officeRegistry,
  postHouseSystem,
  recordsSystem,
} from "@scope-city/mcp";
import type { Scope } from "@scope-city/scope";

/**
 * Turning the operator's sentence into a proposed scope.
 *
 * This is what makes "the scope came from your words" a true statement rather
 * than a caption on a constant. Before this existed the demo produced the same
 * SC-184 whatever you typed, which is the kind of thing a judge finds by typing
 * something else into the box in the first ten seconds.
 *
 * The two stages run here in the order the security argument requires:
 * derivation sees only the operator's sentence, resolution sees only structured
 * identifiers, and the scope is fixed before the agent reads anything a
 * customer wrote.
 */

export interface DerivedScope {
  readonly scope: Scope;
  readonly envelope: IntentEnvelope;
  readonly resolution: Resolution;
  /**
   * Offices the draft asked for that could not be granted, and why.
   *
   * Reported rather than swallowed: an operator whose job produced no scope is
   * owed the reason. "No office in this city can do that" is a useless answer
   * when the truth is "you did not say how much".
   */
  readonly dropped: readonly { readonly office: string; readonly reason: string }[];
}

/**
 * The operator's own ceilings.
 *
 * Deliberately not model-supplied and not per-request. These are the limits of
 * what this operator may hand out at all, so they are the one thing in the
 * pipeline a derivation cannot argue with.
 */
const BOUNDS = {
  registry: officeRegistry(),
  alwaysCountersign: IRREVERSIBLE_OFFICES,
  maxAmountMinorCeiling: 50_000,
  maxCallsCeiling: 3,
  maxTtlMs: 10 * 60 * 1000,
} as const;

/**
 * A resolver that reads through the same systems the agent will later use.
 *
 * Sharing the systems rather than a second read-only copy matters: if the
 * resolver read a different source, "the scope was built from what is actually
 * there" would stop being true the moment the two drifted. Safety comes from
 * *which fields* are read, which the resolver enforces, not from reading
 * somewhere else.
 */
function localResolverIO(): ResolverIO {
  const systems = [recordsSystem(), exchequerSystem(), postHouseSystem()];
  const handlers = new Map(
    systems.flatMap((system) => system.offices.map((office) => [office.office, office] as const)),
  );

  return {
    async call(office, args) {
      const handler = handlers.get(office);
      if (!handler) return {};
      try {
        const result = await handler.call(args);
        return (result ?? {}) as Record<string, unknown>;
      } catch {
        // A lookup that fails leaves its class unresolved, which surfaces as an
        // unfilled class on the grant screen. Far better than aborting the whole
        // derivation because one id did not exist.
        return {};
      }
    },
  };
}

export async function deriveScopeFromJob(params: {
  readonly job: string;
  readonly missionId: string;
  readonly agent?: string;
  readonly now?: number;
  readonly io?: ResolverIO;
}): Promise<DerivedScope> {
  const now = params.now ?? Date.now();
  const registry = BOUNDS.registry;

  const envelope = constrainEnvelope({
    job: params.job,
    raw: draftFromText(params.job),
    bounds: BOUNDS,
  });

  const resolution = await resolve({ envelope, registry, io: params.io ?? localResolverIO() });

  const scope = compileScope({
    missionId: params.missionId,
    // Derived from the job rather than a counter, so two runs of the same
    // sentence are recognisably the same scope in the record.
    scopeId: `SC-${scopeSuffix(params.job)}`,
    agent: params.agent ?? "support-agent",
    envelope,
    resolution,
    registry,
    now,
  });

  // Compared against the envelope rather than the compiled scope: the scope has
  // already had unusable offices pruned out of it, so asking it what is missing
  // can only ever return nothing.
  const dropped = envelope.offices
    .filter((office) => !scope.offices.includes(office))
    .map((office) => ({
      office,
      reason:
        whyUnusable(office, {
          resources: resolution.resolved,
          registry,
          maxAmountMinor: envelope.maxAmountMinor,
        }) ?? "not usable with the resources on hand",
    }));

  return { scope, envelope, resolution, dropped };
}

/** A short stable tag for a job string. Cosmetic; never a security boundary. */
function scopeSuffix(job: string): string {
  let hash = 0;
  for (let i = 0; i < job.length; i += 1) hash = (hash * 31 + job.charCodeAt(i)) >>> 0;
  return hash.toString(36).slice(0, 6).toUpperCase();
}
