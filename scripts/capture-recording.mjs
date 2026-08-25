#!/usr/bin/env node
/**
 * Captures one complete mission as the recording judge mode replays.
 *
 * Runs the real thing end to end against a live control plane -- derivation,
 * the Yard, a human grant, a TrueForge session, real Stripe calls, the sandbox,
 * the gate, a countersign -- and saves exactly what the server produced. A judge
 * replaying this watches a mission that happened rather than a script that
 * describes one, and the record is hash-chained so they can check that for
 * themselves.
 *
 * Existing as a script rather than a one-off matters: a recording that can only
 * be reproduced by whoever made it is a recording nobody can re-make when the
 * product moves, and the last one went stale precisely because re-making it was
 * a manual chore.
 *
 *   node scripts/seed-stripe.mjs
 *   pnpm --filter @scope-city/demo dev      # in another terminal
 *   node scripts/capture-recording.mjs
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.SCOPE_BASE ?? "http://127.0.0.1:8787";
const ORDER = process.argv[2] ?? "Refund order #184 and notify its owner, max $49";
const OUT = process.argv[3] ?? "apps/city/public/replays/refund-184.json";

/** Terminal statuses, after which nothing more will happen. */
const FINISHED = new Set(["completed", "failed", "cancelled", "denied"]);

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const launched = await post("/api/missions", { order: ORDER });

// A 409 carries a missionId too -- the *existing* mission's -- so checking only
// for its presence read a refusal as a success and then failed further down
// with an unhelpful TypeError about a scope that was never sent.
if (launched.status === 409) {
  console.error(
    `a mission is already active (${launched.body.missionId}).\n` +
      `cancel it first:  curl -X POST ${BASE}/api/missions/${launched.body.missionId}/cancel`,
  );
  process.exit(1);
}
if (launched.status !== 200 || !launched.body.scope) {
  console.error("launch failed:", launched.body.error, launched.body.detail ?? "");
  process.exit(1);
}

const id = launched.body.missionId;
console.log(`mission ${id}`);
console.log(`  proposed: ${launched.body.scope.offices.length} offices, ` +
  `${launched.body.report.probesRun} probes, clean=${launched.body.report.clean}`);

// The operator's decision, made explicitly and after the Yard has reported --
// which is the whole point of the propose/grant split and has to appear in the
// recording in that order.
const granted = await post(`/api/missions/${id}/grant`);
if (granted.status !== 202) {
  console.error("grant failed:", granted.body.error);
  process.exit(1);
}
console.log("  granted");

const controller = new AbortController();
const stream = await fetch(`${BASE}/api/missions/${id}/events`, { signal: controller.signal });
const reader = stream.body.getReader();
const decoder = new TextDecoder();

let buffer = "";
let status = "starting";
const timer = setTimeout(() => controller.abort(), 300_000);

outer: while (true) {
  const chunk = await reader.read().catch(() => ({ done: true }));
  if (chunk.done) break;
  buffer += decoder.decode(chunk.value, { stream: true });

  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";

  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;

    let event;
    try {
      // The payload is the feed event itself, not wrapped in an envelope.
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }

    if (event.type === "mission.status" && event.status) {
      status = event.status;
      console.log(`  status: ${status}${event.detail ? ` (${event.detail})` : ""}`);
      if (FINISHED.has(status)) break outer;
    }

    if (event.type === "world" && event.event?.type === "yard.verified") {
      console.log(`  sandbox: ${event.event.passed ? "verified" : "check failed"}`);
    }

    if (event.type === "world" && event.event?.type === "gate.raised") {
      const call = event.event;
      console.log(`  gate: ${call.office} ${JSON.stringify(call.args ?? {})}`);
      const decided = await post(`/api/missions/${id}/decisions`, {
        toolCallId: call.toolCallId,
        approved: true,
      });
      // A 428 here is the sandbox binding refusing an approval with no passing
      // check behind it, which is the feature working rather than a failure.
      console.log(`  countersigned: ${decided.status === 200 ? "accepted" : decided.body.error}`);
    }
  }
}

clearTimeout(timer);
controller.abort();

const record = await (await fetch(`${BASE}/api/missions/${id}/record`)).json();
const { verified, ...saved } = record;

console.log(`\nentries ${saved.entries.length} | chain ${verified.ok ? "verified" : verified.reason}`);
if (!verified.ok) {
  console.error("refusing to save a record that does not verify");
  process.exit(1);
}
if (status !== "completed") {
  console.error(`refusing to save a mission that ended as "${status}" rather than completing`);
  process.exit(1);
}

// Written with an explicit encoding. Letting the platform choose turns every em
// dash into mojibake on Windows, the JSON stays valid, and the damage only
// shows up on screen in front of whoever is watching the demo.
writeFileSync(OUT, JSON.stringify(saved, null, 2) + "\n", { encoding: "utf8" });
console.log(`saved ${OUT}`);
