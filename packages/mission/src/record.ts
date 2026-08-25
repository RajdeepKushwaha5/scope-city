import { createHash } from "node:crypto";
import type { Scope } from "@scope-city/scope";
import type { LoggedEvent } from "./event-log.js";

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

/**
 * Deterministic JSON.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * events hash differently if their keys were assigned in a different order --
 * which happens routinely across a serialisation boundary. Sorting keys makes
 * the hash a function of the content rather than of how the object was built.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
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
  | { readonly ok: false; readonly reason: string; readonly brokenAt: number | null };

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
      };
    }
    previous = entry.hash;
  }

  if (previous !== record.head) {
    // Every link checked out but the head disagrees, which means entries were
    // removed from the end -- the one tampering that leaves each remaining
    // hash individually valid.
    return { ok: false, reason: "head does not match the chain", brokenAt: null };
  }

  return { ok: true, entries: record.entries.length };
}
