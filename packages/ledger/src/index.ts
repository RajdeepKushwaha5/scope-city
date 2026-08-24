/**
 * The quota ledger is where "at most one refund" stops being a wish.
 *
 * evaluate() in @scope-city/scope reads a consumed-count and decides, but two
 * subagents can read the same count in the same tick and both be told yes. The
 * authoritative claim has to happen exactly once, so it lives here.
 *
 * Every mutating method is deliberately SYNCHRONOUS. Node is single-threaded,
 * so a synchronous check-then-write cannot interleave -- but an `await` in the
 * middle of one would hand control back to the event loop and reopen the race.
 * If you ever need to make these async, you need a real lock instead.
 */

export type ClaimOutcome =
  | { readonly won: true; readonly used: number; readonly sequence: number }
  | { readonly won: false; readonly reason: "exhausted"; readonly used: number }
  | { readonly won: false; readonly reason: "replayed"; readonly sequence: number }
  | {
      /** Same idempotency key as an earlier claim: return that claim, don't consume again. */
      readonly won: true;
      readonly replayOf: string;
      readonly used: number;
      readonly sequence: number;
    };

export interface LedgerEntry {
  readonly sequence: number;
  readonly missionId: string;
  readonly office: string;
  readonly idempotencyKey: string;
  readonly at: number;
}

interface MissionState {
  readonly consumed: Map<string, number>;
  readonly byIdempotencyKey: Map<string, LedgerEntry>;
  readonly seenNonces: Set<string>;
  readonly entries: LedgerEntry[];
}

export class QuotaLedger {
  readonly #missions = new Map<string, MissionState>();
  #sequence = 0;

  #state(missionId: string): MissionState {
    let state = this.#missions.get(missionId);
    if (!state) {
      state = {
        consumed: new Map(),
        byIdempotencyKey: new Map(),
        seenNonces: new Set(),
        entries: [],
      };
      this.#missions.set(missionId, state);
    }
    return state;
  }

  /** What evaluate() needs to make its non-authoritative pre-check. */
  consumed(missionId: string): Readonly<Record<string, number>> {
    const state = this.#missions.get(missionId);
    if (!state) return {};
    return Object.fromEntries(state.consumed);
  }

  /**
   * Consume one call against a ceiling, or refuse. This is the only place a
   * quota may decrease, and it never awaits.
   *
   * `nonce` protects against the same physical call being submitted twice;
   * `idempotencyKey` identifies a logical operation, so a retry of the same
   * refund returns the original claim rather than issuing a second one.
   */
  claim(params: {
    missionId: string;
    office: string;
    ceiling: number | undefined;
    idempotencyKey: string;
    nonce: string;
    now: number;
  }): ClaimOutcome {
    const { missionId, office, ceiling, idempotencyKey, nonce, now } = params;
    const state = this.#state(missionId);

    const previous = state.byIdempotencyKey.get(idempotencyKey);
    if (previous) {
      // A retry of an operation we already performed. Hand back the original
      // rather than spending a second unit of quota.
      return {
        won: true,
        replayOf: previous.idempotencyKey,
        used: state.consumed.get(office) ?? 0,
        sequence: previous.sequence,
      };
    }

    if (state.seenNonces.has(nonce)) {
      return { won: false, reason: "replayed", sequence: this.#sequence };
    }

    const used = state.consumed.get(office) ?? 0;
    if (ceiling !== undefined && used >= ceiling) {
      return { won: false, reason: "exhausted", used };
    }

    // --- critical section: no awaits between here and the write ---
    state.seenNonces.add(nonce);
    const next = used + 1;
    state.consumed.set(office, next);
    const sequence = ++this.#sequence;
    const entry: LedgerEntry = { sequence, missionId, office, idempotencyKey, at: now };
    state.byIdempotencyKey.set(idempotencyKey, entry);
    state.entries.push(entry);
    // --- end critical section ---

    return { won: true, used: next, sequence };
  }

  /**
   * Give a unit back. Used when a call was claimed, then refused downstream
   * (a countersign was denied, or the upstream tool errored before acting) --
   * a refund the operator never authorised must not burn the budget.
   */
  release(params: { missionId: string; office: string; idempotencyKey: string }): boolean {
    const state = this.#missions.get(params.missionId);
    if (!state) return false;
    const entry = state.byIdempotencyKey.get(params.idempotencyKey);
    if (!entry) return false;

    state.byIdempotencyKey.delete(params.idempotencyKey);
    const used = state.consumed.get(params.office) ?? 0;
    state.consumed.set(params.office, Math.max(0, used - 1));
    return true;
  }

  /** The audit trail for one mission, in the order things actually happened. */
  entries(missionId: string): readonly LedgerEntry[] {
    return this.#missions.get(missionId)?.entries ?? [];
  }

  /** Drop a mission's counters. Missions are isolated, so this touches nothing else. */
  forget(missionId: string): void {
    this.#missions.delete(missionId);
  }
}
