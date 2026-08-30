export {
  sortFindings,
  summarise,
  type AdversaryAttempt,
  type AdversaryReport,
  type BacktestReport,
  type Finding,
  type FindingKind,
  type Severity,
} from "./findings.js";

export { neighbourId, probesFor, runBoundaryProbes, type Probe } from "./boundary.js";
export { runReachAnalysis, runUnusedGrantAnalysis } from "./reach.js";
export { classesConsumedBy, classesYieldedBy, runCompositionProbes } from "./compose.js";
export { backtest, withAdversary } from "./backtest.js";

export {
  MAX_ADVERSARY_PROBES,
  admissibleProbes,
  isLocalEndpoint,
  runAdversary,
  type Adversary,
  type AdversaryRequest,
  type AdversaryResult,
  type ProposedProbe,
} from "./adversary.js";

export {
  blastRadius,
  counterfactual,
  withOffice,
  type BlastRadius,
  type Counterfactual,
} from "./counterfactual.js";
