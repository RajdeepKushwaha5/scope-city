import { createHash } from "node:crypto";
import type { Scope } from "@scope-city/scope";
import type { LoggedEvent } from "./event-log.js";
import { canonical } from "./canonical.js";

export { canonical } from "./canonical.js";

/**
 * The record: what happened, in an order nobody can quietly revise.
 *
 * A mission log that anyone can edit after the fact answers the wrong
 * question. The interesting one is not "what does this file say" -- it is
 * "is this file the same one the system produced". Those differ precisely when
 * it matters: after an incident, when the log is evidence and the person
 * holding it has an interest in its contents.
 *
 * So each entry carries the hash of the entry before it. Changing any event
 * changes its hash, which changes every hash after it, so a single altered
 * refund invalidates the whole tail rather than passing unnoticed. Removing an
 * entry breaks the chain at the seam. Appending is the only edit the structure
 * permits, which is exactly the edit a log is supposed to allow.
 *
 * This is deliberately *not* a signature. A hash chain proves internal
 * consistency, not origin: someone who rewrites the file can recompute every
 * hash. Making it unforgeable needs a key the writer does not hold, which is a
 * different feature with different operational weight, and claiming otherwise
 * would be the kind of security theatre this project exists to argue against.
 * What the chain gives is tamper *evidence* against casual revision, and a
 * stable identity for a mission that two parties can compare.
 */

export interface RecordEntry {
  readonly sequence: number;
  readonly at: number;
  readonly event: unknown;
  /** sha256 over the previous hash and this entry's canonical form. */
  readonly hash: string;
}

export interface MissionRecord {
  readonly missionId: string;
  readonly scopeId: string;
  readonly job: string;
  readonly scope: Scope;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly entries: readonly RecordEntry[];
  /** The last hash in the chain. Two records agree iff their heads agree. */
  readonly head: string;
  readonly algorithm: "sha256";
  /** True when events were dropped from the log, so the chain is not complete. */
  readonly lossy: boolean;
}

/** The genesis hash. Binds the chain to one mission and one scope. */
export function genesisHash(missionId: string, scope: Scope): string {
  return createHash("sha256")
    .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
    .digest("hex");
}

export function chainHash(previous: string, entry: Omit<RecordEntry, "hash">): string {
  return createHash("sha256")
    .update(canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }))
    .digest("hex");
}

export function buildRecord<TEvent>(params: {
  readonly missionId: string;
  readonly scope: Scope;
  readonly events: readonly LoggedEvent<TEvent>[];
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly lossy?: boolean;
}): MissionRecord {
  const entries: RecordEntry[] = [];
  // Genesis is derived from the scope, so a record cannot be lifted wholesale
  // and re-presented as belonging to a different, wider authority.
  let previous = genesisHash(params.missionId, params.scope);

  for (const logged of params.events) {
    const base = { sequence: logged.sequence, at: logged.at, event: logged.event };
    const hash = chainHash(previous, base);
    entries.push({ ...base, hash });
    previous = hash;
  }

  return {
    missionId: params.missionId,
    scopeId: params.scope.scopeId,
    job: params.scope.job,
    scope: params.scope,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    entries,
    head: previous,
    algorithm: "sha256",
    lossy: params.lossy ?? false,
  };
}

export type RecordVerdict =
  | { readonly ok: true; readonly entries: number }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly brokenAt: number | null;
      /**
       * Whether the hashes themselves check out.
       *
       * Separated from `ok` because "someone altered this" and "this is only
       * part of what happened" are different problems with different responses,
       * and collapsing them into one boolean loses the distinction exactly when
       * a reader needs it. A lossy record has an intact chain and an incomplete
       * history; a tampered one has neither.
       */
      readonly chainIntact: boolean;
    };

/**
 * Recomputes the chain and says whether the record is internally consistent.
 *
 * Reports the *first* broken link rather than a count, because that is the
 * useful fact: everything before it is intact, and everything after is
 * unverifiable regardless of whether it was altered. A tally of mismatches
 * would overstate what is known.
 */
export function verifyRecord(record: MissionRecord): RecordVerdict {
  let previous = genesisHash(record.missionId, record.scope);

  for (const entry of record.entries) {
    const expected = chainHash(previous, {
      sequence: entry.sequence,
      at: entry.at,
      event: entry.event,
    });

    if (expected !== entry.hash) {
      return {
        ok: false,
        reason: `entry ${entry.sequence} does not match the chain`,
        brokenAt: entry.sequence,
        chainIntact: false,
      };
    }
    previous = entry.hash;
  }

  if (previous !== record.head) {
    // Every link checked out but the head disagrees, which means entries were
    // removed from the end -- the one tampering that leaves each remaining
    // hash individually valid.
    return {
      ok: false,
      reason: "head does not match the chain",
      brokenAt: null,
      chainIntact: false,
    };
  }

  // The chain is sound, but soundness is not the whole claim.
  //
  // A log under capacity pressure drops its oldest events, and the chain
  // rebuilt from what remains verifies perfectly -- it is a valid chain over an
  // incomplete history. Stamping that "ok" would be the most misleading output
  // this function could produce, because the reader's question is whether the
  // record accounts for the mission, not whether the arithmetic is right.
  if (record.lossy) {
    return {
      ok: false,
      reason: "the log dropped events, so this record is not a complete history",
      brokenAt: null,
      chainIntact: true,
    };
  }

  return { ok: true, entries: record.entries.length };
}
