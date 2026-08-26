import { initialLiveCityState, type LiveCityState, type OfficeActivity } from "./live-state.js";
import type { Figure } from "./render/scene.js";
import type { GateRequest, LogLine, Phase, ScopeView } from "./useMission.js";

export function scriptedRawState(params: {
  readonly phase: Phase;
  readonly scope: ScopeView | null;
  readonly scopeState: "none" | "proposed" | "granted";
  readonly online: readonly string[];
  readonly figures: readonly Figure[];
  readonly gate: GateRequest | null;
  readonly log: readonly LogLine[];
  readonly refusedAt: { readonly u: number; readonly v: number } | null;
  readonly sandboxOpen: boolean;
  readonly expiresAt: number | null;
  readonly officeActivity: Readonly<Record<string, OfficeActivity>>;
  readonly now: number;
}): LiveCityState {
  const status: LiveCityState["status"] =
    params.phase === "failed"
      ? "failed"
      : params.phase === "done"
        ? "completed"
        : params.scopeState === "proposed"
          ? "proposed"
          : params.scopeState === "granted"
            ? params.phase === "drafting" ? "starting" : "running"
            : "idle";
  const scope = params.scope && params.scopeState !== "none"
    ? {
        missionId: "scripted-scope-city",
        scopeId: params.scope.id,
        agent: "scripted-boundary-agent",
        job: params.scope.job,
        state: params.scopeState,
        offices: params.scope.offices.filter((office) => office.disposition !== "blocked").map((office) => office.office),
        resources: params.scope.resources,
        limits: {
          maxAmountMinor: { "charge.refund": 4900 },
          maxCalls: { "charge.refund": 1, "mail.send": 1 },
          maxResponseBytes: 64_000,
        },
        projection: {},
        countersignRequired: params.scope.offices.filter((office) => office.disposition === "gated").map((office) => office.office),
        expiresAt: params.expiresAt ?? params.now + params.scope.expiresInMs,
        grantedAt: params.scopeState === "granted" ? params.now : null,
        version: 1,
      }
    : null;

  return {
    ...initialLiveCityState,
    phase: params.phase,
    status,
    online: params.online,
    figures: params.figures,
    gate: params.gate,
    log: params.log,
    refusedAt: params.refusedAt,
    sandboxOpen: params.sandboxOpen,
    scopeExpired: params.phase === "done" && params.scopeState === "none",
    proposedScope: scope as never,
    proposedTtlMs: params.scope?.expiresInMs ?? null,
    officeActivity: params.officeActivity,
  };
}
