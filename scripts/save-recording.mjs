#!/usr/bin/env node
/**
 * Waits for an in-flight mission to finish, then saves it as the recording.
 *
 * Separate from `capture-recording.mjs` because a mission that is still running
 * is not a mission that failed. Rate-limited keys make a run take far longer
 * than the capture window, and re-launching to get a fresh one spends model
 * quota and a real Stripe charge to reproduce something already most of the way
 * done. This picks up whatever is in flight.
 *
 *   node scripts/save-recording.mjs <missionId> [out]
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.SCOPE_BASE ?? "http://127.0.0.1:8787";
const ID = process.argv[2];
const OUT = process.argv[3] ?? "apps/city/public/replays/refund-184.json";

if (!ID) {
  console.error("usage: node scripts/save-recording.mjs <missionId> [out]");
  process.exit(1);
}

const FINISHED = new Set(["completed", "failed", "cancelled", "denied"]);

/**
 * Grace beyond the mission's own lease before this script gives up.
 *
 * A fixed fifteen-minute deadline used to live here, chosen when leases were
 * ten minutes. Leases are now up to thirty, so the script stopped waiting while
 * the mission was still legally running and then refused to save it for not
 * having completed -- abandoning a run that was going to succeed, and taking
 * the model quota and the Stripe charge with it.
 *
 * So the bound comes from the mission rather than from a constant: wait until
 * the authority it was granted has actually expired, plus a little for the
 * control plane to notice and write the terminal status.
 */
const EXPIRY_GRACE_MS = 60_000;

/** Fallback when the record carries no scope yet, as on the very first poll. */
const FALLBACK_WAIT_MS = 30 * 60 * 1000;

async function record() {
  const response = await fetch(`${BASE}/api/missions/${ID}/record`);
  if (!response.ok) throw new Error(`record ${response.status}`);
  return response.json();
}

/**
 * When this mission's authority runs out, read off its own granted scope.
 *
 * Reading it from the record rather than recomputing it means the script cannot
 * drift from the control plane the way the fixed deadline did.
 */
function deadlineFrom(entries) {
  for (const entry of entries ?? []) {
    const expiresAt = entry.event?.scope?.expiresAt;
    if (typeof expiresAt === "number") return expiresAt + EXPIRY_GRACE_MS;
  }
  return Date.now() + FALLBACK_WAIT_MS;
}

/** The mission's latest status, read off its own record. */
function statusOf(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i].event;
    if (event?.type === "mission.status" && event.status) return event.status;
  }
  return "unknown";
}

let latest = await record();
let status = statusOf(latest.entries ?? []);
const deadline = deadlineFrom(latest.entries);
console.log(
  `mission ${ID} is ${status}, ${latest.entries?.length ?? 0} entries, ` +
    `waiting until ${new Date(deadline).toISOString()}`,
);

while (!FINISHED.has(status) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  latest = await record();
  const next = statusOf(latest.entries ?? []);
  if (next !== status) console.log(`  -> ${next} (${latest.entries?.length ?? 0} entries)`);
  status = next;
}

const { verified, ...saved } = latest;

// A record with no verdict on it is not a passing record. Reaching `verified.ok`
// on an absent `verified` throws a TypeError that reads like a bug in this
// script, when the thing that actually happened is that the control plane
// returned something this script should refuse to save.
if (!verified || !Array.isArray(saved.entries)) {
  console.error("refusing to save a record with no chain verdict on it");
  process.exit(1);
}

console.log(`\nfinal: ${status} | entries ${saved.entries.length} | chain ${verified.ok ? "verified" : verified.reason}`);

// The same two refusals the capture script makes, for the same reason: a
// recording is offered as evidence, so it must not be a run that was cut short
// or a chain that does not check out.
if (!verified.ok) {
  console.error("refusing to save a record that does not verify");
  process.exit(1);
}
if (status !== "completed") {
  console.error(`refusing to save a mission that ended as "${status}"`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(saved, null, 2) + "\n", { encoding: "utf8" });
console.log(`saved ${OUT}`);
