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
      /**
       * Same idempotency key as an earlier claim. The operation already
       * happened, so callers must return `result` rather than performing it
       * again -- see the note on `settle` below.
       */
      readonly won: true;
      readonly replayOf: string;
      readonly used: number;
      readonly sequence: number;
      readonly settled: boolean;
      readonly result: unknown;
    };

export interface LedgerEntry {
  readonly sequence: number;
  readonly missionId: string;
  readonly office: string;
  readonly idempotencyKey: string;
  readonly at: number;
  /** True once the call actually completed against the upstream system. */
  settled: boolean;
  /** What the upstream returned, so a retry can be answered without re-running. */
  result: unknown;
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
      // A retry of an operation we already claimed. Hand back the original
      // rather than spending a second unit of quota -- and, crucially, tell the
      // caller whether it actually completed. A caller that treats this like a
      // fresh claim will perform an irreversible action twice.
      return {
        won: true,
        replayOf: previous.idempotencyKey,
        used: state.consumed.get(office) ?? 0,
        sequence: previous.sequence,
        settled: previous.settled,
        result: previous.result,
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
    const entry: LedgerEntry = {
      sequence,
      missionId,
      office,
      idempotencyKey,
      at: now,
      settled: false,
      result: undefined,
    };
    state.byIdempotencyKey.set(idempotencyKey, entry);
    state.entries.push(entry);
    // --- end critical section ---

    return { won: true, used: next, sequence };
  }

  /**
   * Marks a claim as having actually happened, and stores what it returned.
   *
   * Until this is called a claim is only a reservation: the quota is held but
   * the world is unchanged, so `release` may still give it back. After it, the
   * claim is a fact -- a retry gets `result` back and `release` must refuse,
   * because you cannot un-send an email by decrementing a counter.
   */
  settle(params: {
    missionId: string;
    idempotencyKey: string;
    result: unknown;
  }): boolean {
    const entry = this.#missions
      .get(params.missionId)
      ?.byIdempotencyKey.get(params.idempotencyKey);
    if (!entry) return false;
    entry.settled = true;
    entry.result = params.result;
    return true;
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

    // A settled claim describes something that happened in the world. Giving
    // its quota back would let the same irreversible action run again, so a
    // release here is refused rather than honoured.
    if (entry.settled) return false;

    state.byIdempotencyKey.delete(params.idempotencyKey);
    const used = state.consumed.get(params.office) ?? 0;
    state.consumed.set(params.office, Math.max(0, used - 1));
    return true;
  }

  /**
   * The entry for one logical operation, if it exists.
   *
   * Callers use this to answer a retry before applying policy: an operation
   * that already completed is a matter of record, not a decision to make
   * again. Evaluating it afresh would refuse it for spending the very quota it
   * spent itself.
   */
  lookup(missionId: string, idempotencyKey: string): LedgerEntry | undefined {
    return this.#missions.get(missionId)?.byIdempotencyKey.get(idempotencyKey);
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
