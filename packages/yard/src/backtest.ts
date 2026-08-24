import type { OfficeRegistry, Scope } from "@scope-city/scope";
import { summarise, type BacktestReport } from "./findings.js";
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
