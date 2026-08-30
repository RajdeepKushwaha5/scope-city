import type { OfficeRegistry, Scope } from "@scope-city/scope";
import { summarise, type AdversaryReport, type BacktestReport, type Finding } from "./findings.js";
import { runBoundaryProbes } from "./boundary.js";
import { runCompositionProbes } from "./compose.js";
import { runReachAnalysis, runUnusedGrantAnalysis } from "./reach.js";

/**
 * The Yard: everything that can be learned about a scope before granting it.
 *
 * Runs before the operator is asked to approve, because that is the only moment
 * the answer changes anything. Afterwards it is a postmortem.
 *
 * Nothing here calls a system or spends anything. Every check is either the
 * pure evaluator run against a generated call, or a walk over declared shapes
 * in the registry -- so the whole backtest is safe to run on a scope that has
 * not been granted, which is the entire point.
 */
export function backtest(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
  readonly now: number;
}): BacktestReport {
  const boundary = runBoundaryProbes(params);
  const reach = runReachAnalysis(params);
  const composition = runCompositionProbes(params);
  const unused = runUnusedGrantAnalysis(params);

  return summarise(
    [...boundary.findings, ...reach.findings, ...composition.findings, ...unused],
    boundary.probesRun + reach.probesRun + composition.probesRun,
  );
}

/**
 * The same report with an adversary's probes folded in.
 *
 * Separate from `backtest` because `backtest` is synchronous and pure, and a
 * model is neither. Keeping the split means every existing caller, every test
 * and the offline replays go on getting a report without waiting on anything --
 * and the adversarial pass is an addition an operator can see, not a hidden
 * dependency inside a function that used to be a calculation.
 */
export function withAdversary(
  report: BacktestReport,
  extra: {
    readonly findings: readonly Finding[];
    readonly probesRun: number;
    readonly report: AdversaryReport;
  },
): BacktestReport {
  return {
    ...summarise([...report.findings, ...extra.findings], report.probesRun + extra.probesRun),
    adversary: extra.report,
  };
}
