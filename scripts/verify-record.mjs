#!/usr/bin/env node
/**
 * Checks a mission record, and says what it attests to.
 *
 *   node scripts/verify-record.mjs apps/city/public/replays/refund-184.json
 *
 * The record is the artifact this project offers as evidence, and until now
 * nothing let a third party check one. The chain was verified inside the app
 * and inside the test suite -- both of which are the thing being checked, or
 * shipped alongside it. Someone handed the JSON had to take it on trust, which
 * is precisely the position this project argues no one should be in.
 *
 * ## Why this re-implements the hashing
 *
 * `packages/mission` exports `verifyRecord`, and calling it from here would be
 * less code. It would also verify the record with the same functions that wrote
 * it, so a bug in the canonicaliser would cancel itself out and the check would
 * pass on a record no one else could reproduce.
 *
 * So the arithmetic is written out again, from the record's own stated
 * algorithm, using nothing but `node:crypto`. `packages/mission/test/`
 * cross-checks the two implementations against each other, so they cannot drift
 * apart quietly -- independence at runtime, without the divergence the
 * canonicaliser's own comment warns about.
 *
 * ## What an intact chain does and does not prove
 *
 * It proves the entries have not been edited, reordered, or dropped from the
 * end since they were hashed. It is tamper-evidence, not a signature: nothing
 * here is signed, so anyone able to rewrite the whole file can produce a
 * consistent chain over whatever they like. What it gives you is a stable
 * identity -- the head -- that you can quote and compare against a copy someone
 * else holds.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];

if (!path) {
  console.error("usage: node scripts/verify-record.mjs <record.json>");
  process.exit(2);
}

/**
 * Deterministic JSON. Must match `packages/mission/src/canonical.ts` exactly.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * events hash differently if their keys were assigned in a different order.
 * Sorting makes the hash a function of the content.
 */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

const sha256 = (input) => createHash("sha256").update(input).digest("hex");

function fail(message) {
  console.error(`\n  FAILED  ${message}\n`);
  process.exit(1);
}

let record;
try {
  record = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  fail(`could not read ${path}: ${error.message}`);
}

// Checked rather than assumed. A record naming an algorithm this script does
// not implement must not be reported as verified against a different one.
if (record.algorithm !== "sha256") {
  fail(`record states algorithm "${record.algorithm}", and this script only checks sha256`);
}
if (!Array.isArray(record.entries) || record.entries.length === 0) {
  fail("record carries no entries");
}

/*
 * Read from the scope, not from the top level.
 *
 * The genesis hash covers `{ missionId, scopeId, scope }`. It does not cover
 * the record's top-level `job`, `startedAt`, `finishedAt`, `algorithm` or
 * `lossy` -- those sit outside the chain entirely, and printing them under a
 * heading that says the chain is intact would attest to fields nothing
 * attests to. The scope carries its own job and id, and those are hashed.
 */
const scope = record.scope ?? {};

console.log(`\n  ${path}`);
console.log(`  mission   ${record.missionId}`);
console.log(`  scope     ${scope.scopeId ?? "(none sealed)"}`);
console.log(`  job       ${JSON.stringify(scope.job ?? null)}`);
console.log(`  entries   ${record.entries.length}`);

// A disagreement here is worth saying out loud. It is not proof of tampering --
// the top-level copies are convenience, not evidence -- but a record whose
// unhashed summary contradicts its sealed scope is one to look at twice.
for (const [field, loose, sealed] of [
  ["scopeId", record.scopeId, scope.scopeId],
  ["job", record.job, scope.job],
]) {
  if (loose !== undefined && sealed !== undefined && loose !== sealed) {
    console.log(
      `\n  NOTE  the top-level ${field} disagrees with the sealed scope:` +
        `\n          outside the chain  ${JSON.stringify(loose)}` +
        `\n          inside the chain   ${JSON.stringify(sealed)}`,
    );
  }
}

// --- the chain -------------------------------------------------------------

let previous = sha256(
  canonical({ missionId: record.missionId, scopeId: record.scope?.scopeId, scope: record.scope }),
);

for (const entry of record.entries) {
  const expected = sha256(
    canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }),
  );

  // The first break, not a count. Everything before it is intact and everything
  // after is unverifiable regardless of whether it was altered, so a tally
  // would claim to know more than it does.
  if (expected !== entry.hash) {
    fail(
      `entry ${entry.sequence} does not match the chain\n` +
        `          expected ${expected}\n` +
        `          found    ${entry.hash}`,
    );
  }
  previous = entry.hash;
}

if (previous !== record.head) {
  // Every link checks out but the head disagrees: entries were removed from the
  // end, the one edit that leaves each remaining hash individually valid.
  fail(
    `head does not match the chain -- entries were removed from the end\n` +
      `          head states  ${record.head}\n` +
      `          chain ends   ${previous}`,
  );
}

if (record.lossy) {
  // A valid chain over an incomplete history. Calling that "verified" would be
  // the most misleading thing this script could print, because the question is
  // whether the record accounts for the mission, not whether the arithmetic is
  // right.
  fail("the log dropped events, so this record is not a complete history");
}

// --- what it attests to ----------------------------------------------------

const worldEvents = record.entries
  .map((entry) => (entry.event?.type === "world" ? entry.event.event : null))
  .filter(Boolean);

const count = (type) => worldEvents.filter((e) => e.type === type).length;
const threads = new Set(worldEvents.map((e) => e.threadId).filter(Boolean));

/*
 * Counted two ways, because a record can say it either way.
 *
 * `gate.abandoned` is written when a mission is retired with questions still
 * standing, but only records produced after that event existed carry it -- and
 * a run killed outright may never have written its retirement at all. A gate
 * that was raised and never cleared is the older, structural evidence of the
 * same thing, so both are counted and the larger is reported. Reading only the
 * explicit event would report zero unanswered gates for exactly the records
 * where nobody was there to answer.
 */
const clearedIds = new Set(
  worldEvents.filter((e) => e.type === "gate.cleared").map((e) => e.toolCallId),
);
const abandonedIds = new Set(
  worldEvents.filter((e) => e.type === "gate.abandoned").map((e) => e.toolCallId),
);
const raisedIds = worldEvents
  .filter((e) => e.type === "gate.raised")
  .map((e) => e.toolCallId);

const unanswered = new Set(
  raisedIds.filter((id) => !clearedIds.has(id)).concat([...abandonedIds]),
).size;

let status = "unknown";
for (let i = record.entries.length - 1; i >= 0; i -= 1) {
  const event = record.entries[i].event;
  if (event?.type === "mission.status" && event.status) {
    status = event.status;
    break;
  }
}

console.log(`\n  chain intact, head ${record.head.slice(0, 16)}…`);
console.log(`\n  what it attests to`);
console.log(`    ended            ${status}`);
console.log(`    threads          ${threads.size}${threads.size > 1 ? " (subagents ran)" : ""}`);
console.log(`    gates raised     ${count("gate.raised")}`);
console.log(`    countersigned    ${worldEvents.filter((e) => e.type === "gate.cleared" && e.approved).length}`);
console.log(`    refused at gate  ${worldEvents.filter((e) => e.type === "gate.cleared" && !e.approved).length}`);
console.log(`    left unanswered  ${unanswered}`);
console.log(`    sandbox checks   ${count("yard.verified")}`);

console.log(`\n  the authority it was granted`);
console.log(`    offices          ${(scope.offices ?? []).join(", ") || "none"}`);
console.log(`    countersign      ${(scope.countersignRequired ?? []).join(", ") || "none"}`);
if (scope.grantedAt && scope.expiresAt) {
  console.log(`    lease            ${Math.round((scope.expiresAt - scope.grantedAt) / 60000)} minutes`);
}

console.log(
  `\n  The chain covers the entries and the sealed scope. It does not cover the` +
    `\n  record's top-level job, timestamps, algorithm or lossy flag, which sit` +
    `\n  outside it -- so those are reported above from the scope where possible.` +
    `\n\n  Tamper-evidence, not a signature: nothing here is signed, so anyone able` +
    `\n  to rewrite the whole file can produce a consistent chain. Compare the head` +
    `\n  against another copy to confirm you are both holding the same record.\n`,
);

