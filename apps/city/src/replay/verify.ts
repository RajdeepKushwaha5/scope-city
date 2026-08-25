// Imported by subpath, not from the barrel: the barrel reaches `record.ts`
// and through it `node:crypto`, which does not exist in a browser.
import { canonical } from "@scope-city/mission/canonical";
import type { RecordedMission } from "./recorded.js";

/**
 * Verifying the chain in the browser, before anything is replayed.
 *
 * A recording is offered as evidence, and evidence that is never checked is
 * decoration. Judge mode was replaying the file while telling the viewer it was
 * hash-chained -- true of the file as produced, and unverified by the thing
 * making the claim.
 *
 * This cannot reuse the server's verifier: that one hashes with `node:crypto`
 * synchronously, which does not exist in a browser. So there are two
 * implementations of the same chain, which is a real hazard -- two hash
 * functions that disagree would either reject good records or, far worse,
 * accept altered ones. They are held together by canonicalising through the
 * *same* exported function and by a test that asserts both produce identical
 * digests over the shipped recording.
 *
 * Note what this proves and what it does not. A hash chain shows the file is
 * internally consistent: no entry was altered, removed, or reordered after it
 * was written. It says nothing about origin, because anyone who rewrites the
 * file can recompute every hash. Claiming otherwise would be the kind of
 * security theatre this project exists to argue against.
 */

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ReplayVerdict =
  | { readonly ok: true; readonly entries: number }
  | { readonly ok: false; readonly reason: string; readonly brokenAt: number | null };

export async function verifyRecording(record: RecordedMission): Promise<ReplayVerdict> {
  if (record.lossy) {
    return {
      ok: false,
      reason: "the recording is incomplete — events were dropped when it was captured",
      brokenAt: null,
    };
  }

  // Genesis binds the chain to the mission and the scope it ran under, so a
  // record cannot be lifted and re-presented as belonging to wider authority.
  let previous = await sha256Hex(
    canonical({ missionId: record.missionId, scopeId: record.scope.scopeId, scope: record.scope }),
  );

  for (const entry of record.entries) {
    const expected = await sha256Hex(
      canonical({
        previous,
        sequence: entry.sequence,
        at: entry.at,
        event: entry.event,
      }),
    );

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
    // removed from the end -- the one tampering that leaves each remaining hash
    // individually valid.
    return { ok: false, reason: "the chain head does not match", brokenAt: null };
  }

  return { ok: true, entries: record.entries.length };
}
