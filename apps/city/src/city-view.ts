import type { LiveCityState } from "./live-state.js";
import { OFFICES, type ScopeView } from "./useMission.js";

/**
 * Turning mission state into what the HUD renders.
 *
 * Shared rather than written twice. A live stream and a recorded replay are
 * both a `LiveCityState` reduced from the same events, and the moment each one
 * maps that state to the HUD independently, the two drift -- which is precisely
 * the failure a recorded mission is supposed to be immune to. If a replay
 * displayed differently from the live run it came from, it would stop being
 * evidence of anything.
 */

export interface CityView {
  readonly phase: LiveCityState["phase"];
  readonly scope: ScopeView | null;
  readonly scopeState: "granted" | "none";
  readonly online: readonly string[];
  readonly offices: typeof OFFICES;
  readonly figures: LiveCityState["figures"];
  readonly gate: LiveCityState["gate"];
  readonly pendingGateCount: number;
  readonly gateDistricts: readonly string[];
  readonly log: LiveCityState["log"];
  readonly refusedAt: LiveCityState["refusedAt"];
  readonly sandboxOpen: boolean;
  readonly yard: LiveCityState["yard"];
  readonly treasury: number;
  readonly expiresIn: number | null;
  readonly job: string;
  readonly granted: readonly string[];
  readonly proposed: readonly string[];
}

/** Whether the scope is still doing anything, which drives the drawn limits. */
export function scopeIsEffective(
  state: LiveCityState,
  scope: ScopeView | null,
  expiresIn: number | null,
): boolean {
  return Boolean(
    scope &&
      !state.scopeExpired &&
      state.status !== "cancelled" &&
      state.status !== "failed" &&
      state.status !== "completed" &&
      expiresIn !== 0,
  );
}

export function cityViewFrom(params: {
  readonly state: LiveCityState;
  readonly scope: ScopeView | null;
  readonly expiresIn: number | null;
  readonly idleJob: string;
}): CityView {
  const { state, scope, expiresIn } = params;
  const effective = scopeIsEffective(state, scope, expiresIn);

  return {
    phase: state.phase,
    scope,
    scopeState: effective ? "granted" : "none",
    online: state.online,
    offices: OFFICES,
    figures: state.figures,
    gate: state.gate,
    pendingGateCount: state.pendingGates.length,
    gateDistricts: state.gate ? [state.gate.district] : [],
    log: state.log,
    refusedAt: state.refusedAt,
    sandboxOpen: state.sandboxOpen,
    yard: state.yard,
    treasury: 0,
    expiresIn,
    job: scope?.job ?? params.idleJob,
    granted: effective ? ["records", "exchequer", "post-house"] : [],
    proposed: [],
  };
}
