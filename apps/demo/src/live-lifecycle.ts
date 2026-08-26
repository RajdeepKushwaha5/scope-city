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
  readonly gates: {
    cancelAll: (
      reason?: string,
    ) => readonly { toolCallId: string; office: string | null; waitedMs: number }[] | void;
  };
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
  const reason = detail ?? `mission ${status}`;
  // `Array.isArray` rather than `?? []`: this reads through an interface other
  // code implements, and a queue that returns something other than a list
  // should leave the record short an event rather than crash the retirement
  // path -- which is the one path that has to run when things are already
  // going wrong.
  const reported = mission.gates.cancelAll(reason);
  const abandoned = Array.isArray(reported) ? reported : [];

  /*
   * A question nobody answered is its own fact.
   *
   * These calls are refused, exactly as a human refusal refuses them, and the
   * record used to show only that: a `gate.raised` and then a cancelled
   * mission, with the reader left to notice a missing `gate.cleared` and infer
   * what it meant. Absence is a poor way to carry a fact that matters this
   * much -- `gate.cleared { approved: false }` is a control that fired, and
   * this is a control that was never exercised. They end the same way and mean
   * opposite things.
   *
   * Written before the terminal status, so the record reads in the order the
   * events happened: the gates fell, then the mission ended.
   */
  for (const gate of abandoned) {
    mission.feed.append({
      type: "world",
      event: {
        type: "gate.abandoned",
        toolCallId: gate.toolCallId,
        office: gate.office,
        waitedMs: gate.waitedMs,
        reason,
        at: Date.now(),
      },
    });
  }

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
