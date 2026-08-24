export {
  sortFindings,
  summarise,
  type BacktestReport,
  type Finding,
  type FindingKind,
  type Severity,
} from "./findings.js";

export { neighbourId, probesFor, runBoundaryProbes, type Probe } from "./boundary.js";
export { runReachAnalysis, runUnusedGrantAnalysis } from "./reach.js";
export { classesConsumedBy, classesYieldedBy, runCompositionProbes } from "./compose.js";
export { backtest } from "./backtest.js";

export {
  blastRadius,
  counterfactual,
  withOffice,
  type BlastRadius,
  type Counterfactual,
} from "./counterfactual.js";
