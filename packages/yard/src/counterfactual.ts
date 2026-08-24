import type { OfficeRegistry, Scope } from "@scope-city/scope";
import { backtest } from "./backtest.js";
import { classesConsumedBy, classesYieldedBy } from "./compose.js";
import type { Finding } from "./findings.js";

/**
 * What granting one more office would actually cost.
 *
 * Permissions have always been a JSON diff nobody reads. The point of drawing
 * authority as a city is that granting an extra office visibly annexes a
 * district -- and that only works if the map can answer the question *before*
 * the grant, for a scope that does not exist yet.
 *
 * Mechanically this is cheap, which is the nice part: a counterfactual is the
 * same analysis from `backtest`, run against a hypothetical scope instead of
 * the proposed one. No new machinery, and no possibility of the two disagreeing
 * about what a scope means.
 *
 * The delta is what makes it legible. An operator cannot read two reports and
 * subtract them in their head; they can read "+1 office, +2 new response
 * fields, one of them a customer's full history."
 */

export interface BlastRadius {
  readonly offices: number;
  /** Distinct response fields the scope's projection lets through. */
  readonly exposedFields: number;
  /**
   * Offices granted wholesale because they take no record id. These are the
   * ones whose reach does not shrink with a tighter resource list, so they are
   * counted separately rather than folded into the office total.
   */
  readonly unnarrowableOffices: number;
  /** Ordered pairs where one office's output feeds a mutating office. */
  readonly chainedPaths: number;
}

export interface Counterfactual {
  readonly office: string;
  readonly before: BlastRadius;
  readonly after: BlastRadius;
  /** Findings the hypothetical scope has that the proposed one does not. */
  readonly newFindings: readonly Finding[];
  /** Districts newly reachable, for the map to annex. */
  readonly newDistricts: readonly string[];
  /** One line an operator can act on. */
  readonly summary: string;
}

export function blastRadius(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
}): BlastRadius {
  const { scope, registry } = params;
  const classes = Object.keys(scope.resources);

  const exposed = new Set<string>();
  let unnarrowable = 0;

  for (const office of scope.offices) {
    const spec = registry.get(office);
    if (!spec) continue;
    for (const field of scope.projection[office] ?? []) exposed.add(`${office}.${field}`);
    if (!Object.values(spec.args).some((b) => b.kind === "resource")) unnarrowable += 1;
  }

  let chained = 0;
  for (const source of scope.offices) {
    const yielded = classesYieldedBy(source, registry, classes);
    for (const sink of scope.offices) {
      if (sink === source) continue;
      if (!registry.get(sink)?.mutating) continue;
      if (yielded.some((cls) => classesConsumedBy(sink, registry).includes(cls))) chained += 1;
    }
  }

  return {
    offices: scope.offices.length,
    exposedFields: exposed.size,
    unnarrowableOffices: unnarrowable,
    chainedPaths: chained,
  };
}

/**
 * The scope that would exist if `office` were added.
 *
 * Its projection defaults to everything the office declares, because that is
 * the honest worst case for a field the operator has not yet thought about --
 * and the whole purpose of asking "what if" is to see the worst case before
 * agreeing to it.
 */
export function withOffice(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
  readonly office: string;
}): Scope {
  const spec = params.registry.get(params.office);
  if (!spec || params.scope.offices.includes(params.office)) return params.scope;

  return {
    ...params.scope,
    offices: [...params.scope.offices, params.office],
    projection: { ...params.scope.projection, [params.office]: spec.responseFields },
  };
}

export function counterfactual(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
  readonly office: string;
  readonly now: number;
}): Counterfactual {
  const { scope, registry, office, now } = params;
  const hypothetical = withOffice({ scope, registry, office });

  const before = blastRadius({ scope, registry });
  const after = blastRadius({ scope: hypothetical, registry });

  const baseline = new Set(
    backtest({ scope, registry, now }).findings.map((f) => `${f.kind}:${f.office}:${f.summary}`),
  );
  const newFindings = backtest({ scope: hypothetical, registry, now }).findings.filter(
    (f) => !baseline.has(`${f.kind}:${f.office}:${f.summary}`),
  );

  const districtsBefore = new Set(
    scope.offices.map((o) => registry.get(o)?.district).filter((d): d is string => !!d),
  );
  const newDistricts = [
    ...new Set(
      hypothetical.offices
        .map((o) => registry.get(o)?.district)
        .filter((d): d is string => !!d && !districtsBefore.has(d)),
    ),
  ];

  return { office, before, after, newFindings, newDistricts, summary: describe(office, before, after, newDistricts) };
}

function describe(
  office: string,
  before: BlastRadius,
  after: BlastRadius,
  newDistricts: readonly string[],
): string {
  if (after.offices === before.offices) return `${office} is already in scope.`;

  const parts = [`+1 office`];
  const fields = after.exposedFields - before.exposedFields;
  if (fields > 0) parts.push(`+${fields} response field${fields === 1 ? "" : "s"} exposed`);

  const paths = after.chainedPaths - before.chainedPaths;
  if (paths > 0) parts.push(`+${paths} chained path${paths === 1 ? "" : "s"}`);

  if (after.unnarrowableOffices > before.unnarrowableOffices) {
    // The line that should give an operator pause: this one does not get
    // smaller by listing fewer records, because it never took a record id.
    parts.push(`granted wholesale — ${office} takes no record id`);
  }

  if (newDistricts.length > 0) parts.push(`annexes ${newDistricts.join(", ")}`);

  return parts.join(", ");
}
