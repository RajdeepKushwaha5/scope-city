import { randomBytes } from "node:crypto";
import type { OfficeRegistry, Scope } from "@scope-city/scope";
import type { QuotaLedger } from "@scope-city/ledger";
import type { EmitProxyEvent } from "./events.js";
import type { CountersignGate, UpstreamCall } from "./enforce.js";

/**
 * Everything one mission owns.
 *
 * Missions are isolated because the public demo is a shared URL: two judges
 * running it at the same time must not see each other's offices or spend each
 * other's quota. Isolation is therefore a correctness property, not a nicety,
 * and it is enforced by making the mission id the only way to reach any of this.
 */
export interface Mission {
  readonly id: string;
  scope: Scope;
  readonly registry: OfficeRegistry;
  readonly ledger: QuotaLedger;
  readonly upstream: UpstreamCall;
  readonly countersign: CountersignGate;
  readonly emit: EmitProxyEvent;
  readonly createdAt: number;
}

/**
 * Unguessable, and long enough that enumerating missions is not a strategy.
 * This is the capability -- there is no separate token, because a token is one
 * more thing that could end up in a model's context.
 */
export function newMissionId(): string {
  return `m_${randomBytes(24).toString("hex")}`;
}

export class MissionRegistry {
  readonly #missions = new Map<string, Mission>();

  register(mission: Mission): void {
    if (this.#missions.has(mission.id)) {
      throw new Error(`mission ${mission.id} already registered`);
    }
    this.#missions.set(mission.id, mission);
  }

  /**
   * Returns undefined rather than throwing for an unknown id: an unknown
   * mission and a mission that has been forgotten are the same thing to a
   * caller, and neither should produce a stack trace over the wire.
   */
  get(id: string): Mission | undefined {
    return this.#missions.get(id);
  }

  /** Replaces the scope in place, e.g. when the operator grants or revokes. */
  updateScope(id: string, scope: Scope): boolean {
    const mission = this.#missions.get(id);
    if (!mission) return false;
    mission.scope = scope;
    return true;
  }

  forget(id: string): void {
    const mission = this.#missions.get(id);
    if (!mission) return;
    mission.ledger.forget(id);
    this.#missions.delete(id);
  }

  /** Drops missions older than `maxAgeMs`, so a long-lived demo does not leak. */
  sweep(now: number, maxAgeMs: number): number {
    let dropped = 0;
    for (const [id, mission] of this.#missions) {
      if (now - mission.createdAt > maxAgeMs) {
        this.forget(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  get size(): number {
    return this.#missions.size;
  }
}
