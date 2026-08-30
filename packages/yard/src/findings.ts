/**
 * What the Yard reports.
 *
 * A backtest that counts denials is nearly worthless: with a one-id allowlist,
 * "816 out-of-scope calls refused" is a statement about how many probes were
 * written, not about whether the scope is sound. Every finding here is instead
 * something the operator would want to know *before* granting, and each has a
 * counterpart in the enforcement layer -- a warning with no enforcement behind
 * it is just a nicer postmortem.
 *
 * The severities are deliberately few. An operator reading this has one
 * decision to make (grant, narrow, or refuse), so a finding either changes that
 * decision or it is noise.
 */

export type Severity = "critical" | "warning" | "note";

export type FindingKind =
  /** A call outside the scope that the evaluator did *not* refuse. */
  | "boundary_hole"
  /** An allowed call returns data the scope never meant to expose. */
  | "response_over_reach"
  /** Two allowed offices chain to reach something neither covers alone. */
  | "composition_reach"
  /** An office can return instruction-shaped text into the agent's context. */
  | "injection_surface"
  /** The scope grants something the job never needed. */
  | "unused_grant";

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: Severity;
  /** One line, written for an operator rather than a maintainer. */
  readonly summary: string;
  /** The office this concerns, for placing a crack on the map. */
  readonly office: string;
  /** Field paths or resource ids involved, when the finding has them. */
  readonly detail?: readonly string[];
  /** What narrowing would remove this finding. */
  readonly remedy?: string;
}

export interface BacktestReport {
  readonly findings: readonly Finding[];
  /** How many probes ran, so "clean" means something specific. */
  readonly probesRun: number;
  /** True when nothing above `note` was found. */
  readonly clean: boolean;
  /**
   * What a local adversary added, when one ran.
   *
   * Optional because the mechanical probes are the floor and always run. Its
   * absence means no adversary was configured; a `declined` inside it means one
   * was and could not be reached. The two are different facts and the report
   * does not blur them.
   */
  readonly adversary?: AdversaryReport;
}

/**
 * One attack the adversary wrote, and what the evaluator did with it.
 *
 * Carried rather than counted, because a count is the least interesting true
 * thing that can be said here. "4 attacks, 0 holes" reads as nothing having
 * happened; `charge.refund refused for resource_not_granted` is the wall doing
 * its job, in public, before anyone granted anything -- and it is the only
 * evidence a reader has that the adversary wrote anything real.
 */
export interface AdversaryAttempt {
  readonly office: string;
  /** The model's own words for what it was trying, already trimmed. */
  readonly why: string;
  readonly refused: boolean;
  /** The evaluator's reason. Ours, not the model's, and absent on a hole. */
  readonly reason?: string;
}

/** Declared here rather than imported, so `findings.ts` depends on nothing. */
export interface AdversaryReport {
  readonly model: string;
  readonly wrote: number;
  readonly admitted: number;
  readonly holes: number;
  readonly declined?: string;
  /**
   * What it tried, capped.
   *
   * This lands in an operator's panel and in the record, and every `why` in it
   * is text a model produced from a ticket an attacker may have written. It is
   * displayed as data and never counted as a finding: the finding is the
   * evaluator's verdict, which is on the same row.
   */
  readonly attempts: readonly AdversaryAttempt[];
}

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, note: 2 };

/** Most serious first, then stable by office so reruns render identically. */
export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] || a.office.localeCompare(b.office),
  );
}

export function summarise(
  findings: readonly Finding[],
  probesRun: number,
): BacktestReport {
  return {
    findings: sortFindings(findings),
    probesRun,
    clean: !findings.some((f) => f.severity !== "note"),
  };
}
