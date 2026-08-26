import type { CityFeedEvent } from "@scope-city/mission";
import type { Scope } from "@scope-city/scope";

/**
 * `proposed` is the state a mission spends waiting for a human.
 *
 * It exists because the product's central claim is that the operator sees the
 * authority before the agent holds it, and a mission that goes straight to
 * `starting` has no room in it for that to be true. Nothing is registered with
 * the proxy and no TrueForge session exists while a mission is proposed, so a
 * scope that is never granted was never reachable.
 */
export type LiveMissionStatus =
  | "proposed"
  | "denied"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ManagedLiveMission {
  readonly id: string;
  readonly feed: { append: (event: CityFeedEvent) => unknown };
  readonly gates: { cancelAll: (reason?: string) => void };
  status: LiveMissionStatus;
  expiryTimer?: NodeJS.Timeout;
}

export interface ExpiringLiveMission extends ManagedLiveMission {
  readonly scope: Scope;
  readonly sessionId?: string;
}

export function isTerminalMissionStatus(status: LiveMissionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "denied"
  );
}

/** Whether a mission is still waiting on the operator to grant or deny it. */
export function isAwaitingGrant(status: LiveMissionStatus): boolean {
  return status === "proposed";
}

/** Revokes every server-side capability before publishing a terminal status. */
export function retireMission(
  mission: ManagedLiveMission,
  registry: { forget: (missionId: string) => void },
  status: Extract<LiveMissionStatus, "completed" | "failed" | "cancelled">,
  detail?: string,
): boolean {
  if (isTerminalMissionStatus(mission.status)) return false;
  if (mission.expiryTimer) {
    clearTimeout(mission.expiryTimer);
    mission.expiryTimer = undefined;
  }
  mission.gates.cancelAll(detail ?? `mission ${status}`);
  registry.forget(mission.id);
  mission.status = status;
  mission.feed.append({ type: "mission.status", status, ...(detail ? { detail } : {}) });
  return true;
}

/** Expiry is terminal: revoke scope, publish it, retire, then stop the session. */
export async function expireLiveMission(
  mission: ExpiringLiveMission,
  registry: {
    updateScope: (missionId: string, scope: Scope) => boolean;
    forget: (missionId: string) => void;
  },
  cancelSession: (sessionId: string) => Promise<unknown>,
  at = Date.now(),
): Promise<boolean> {
  if (isTerminalMissionStatus(mission.status)) return false;
  const sessionId = mission.sessionId;
  registry.updateScope(mission.id, { ...mission.scope, state: "expired" });
  mission.feed.append({ type: "scope.expired", at });
  retireMission(mission, registry, "cancelled", "scope expired");
  if (sessionId) await cancelSession(sessionId).catch(() => undefined);
  return true;
}
