import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyRecord } from "@scope-city/mission";
import { verifyRecording } from "./verify.js";
import type { RecordedMission } from "./recorded.js";

/**
 * Two implementations of one chain, held together here.
 *
 * The server hashes with `node:crypto` synchronously; the browser cannot, so it
 * hashes with Web Crypto asynchronously. That duplication is a genuine hazard:
 * two hash functions that disagree either reject good records or -- much worse
 * -- accept altered ones. Nothing but this file stops them drifting apart.
 */
const recording = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/replays/refund-184.json", import.meta.url)), "utf8"),
) as RecordedMission;

describe("browser verification agrees with the server", () => {
  it("accepts the shipped recording, as the server does", async () => {
    const browser = await verifyRecording(recording);
    const server = verifyRecord(recording as never);

    expect(browser.ok).toBe(true);
    expect(server.ok).toBe(true);
    if (browser.ok && server.ok) expect(browser.entries).toBe(server.entries);
  });

  it("rejects an altered event at the same entry the server does", async () => {
    const tampered = {
      ...recording,
      entries: recording.entries.map((e, i) =>
        i === 3 ? { ...e, event: { type: "mission.status", status: "completed" } } : e,
      ),
    } as RecordedMission;

    const browser = await verifyRecording(tampered);
    const server = verifyRecord(tampered as never);

    expect(browser.ok).toBe(false);
    expect(server.ok).toBe(false);
    if (!browser.ok && !server.ok) expect(browser.brokenAt).toBe(server.brokenAt);
  });

  it("rejects a truncated tail, which leaves every remaining hash valid", async () => {
    const truncated = { ...recording, entries: recording.entries.slice(0, -1) } as RecordedMission;
    const verdict = await verifyRecording(truncated);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("head");
  });

  it("rejects a record re-presented under a wider scope", async () => {
    // Genesis binds the chain to the authority the events were taken under.
    const relabelled = {
      ...recording,
      scope: { ...recording.scope, offices: [...recording.scope.offices, "customer.list"] },
    } as RecordedMission;
    expect((await verifyRecording(relabelled)).ok).toBe(false);
  });

  it("refuses an incomplete recording outright", async () => {
    const lossy = { ...recording, lossy: true } as RecordedMission;
    const verdict = await verifyRecording(lossy);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("incomplete");
  });
});
