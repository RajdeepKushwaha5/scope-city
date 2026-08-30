export {
  CountersignBook,
  type PendingCountersign,
  type Verdict,
} from "./countersign-book.js";

export {
  MissionOrchestrator,
  type MissionPhase,
  type MissionSnapshot,
} from "./orchestrator.js";

export {
  MissionEventLog,
  type LoggedEvent,
  type Replay,
} from "./event-log.js";

export {
  missionBrief,
  type BriefOptions,
} from "./brief.js";

export { type CityFeedEvent } from "./feed-events.js";

export {
  buildRecord,
  canonical,
  chainHash,
  genesisHash,
  verifyRecord,
  type MissionRecord,
  type RecordEntry,
  type RecordVerdict,
} from "./record.js";

// Re-exported from the harness, where it moved: reading a verdict out of tool
// output is parsing, and the harness cannot import this package to reach it.
export { readVerdict, type Verification } from "@scope-city/harness";

export {
  identifyingArguments,
  proofAuthorises,
  type ProofVerdict,
  type SandboxProof,
} from "./proof.js";

export {
  newOperatorKeyBase64,
  operatorId,
  operatorSigner,
  verifyCountersign,
  type CountersignSignature,
  type OperatorSigner,
} from "./operator-key.js";
