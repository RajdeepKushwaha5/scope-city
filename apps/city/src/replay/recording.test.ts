import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RecordedMission } from "./recorded.js";

/**
 * The shipped recording is an asset that renders straight into the HUD.
 *
 * It is also the one file in this repo that is produced by a tool rather than
 * written by hand, which makes it the one most likely to be quietly corrupted:
 * a read without an explicit encoding turns every em dash into `â€"` on
 * Windows, the JSON stays valid, and the damage only shows up on screen in
 * front of whoever is watching the demo.
 *
 * Checking the bytes rather than the rendered output matters here. A console
 * that double-decodes mojibake prints it back as the character it should have
 * been, so eyeballing it is not a check at all -- which is exactly how this
 * shipped in the first place.
 */
const recordingPath = fileURLToPath(new URL("../../public/replays/refund-184.json", import.meta.url));
const raw = readFileSync(recordingPath, "utf8");
const record = JSON.parse(raw) as RecordedMission;

describe("the shipped recording", () => {
  it("carries no mojibake", () => {
    // U+00E2 U+20AC U+201D is a UTF-8 em dash misread as cp1252.
    expect(raw).not.toContain("\u00e2\u20ac");
    expect(raw).not.toContain("\u00c3");
  });

  it("is a completed mission, not a stalled one", () => {
    const last = record.entries.at(-1)?.event;
    expect(JSON.stringify(last)).toContain("completed");
  });

  it("shows the sandbox opening before the gate is raised", () => {
    // The ordering is the claim: verification runs *before* a human is asked
    // to approve anything, which is what makes the sandbox the step that earns
    // the approval rather than a checkbox.
    const flat = record.entries.map((e) => JSON.stringify(e.event));
    const sandbox = flat.findIndex((line) => line.includes("yard.opened"));
    const gate = flat.findIndex((line) => line.includes("gate.raised"));

    expect(sandbox).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(sandbox).toBeLessThan(gate);
  });

  it("shows the response layer redacting an allowed call", () => {
    const flat = raw;
    expect(flat).toContain("response.redacted");
    expect(flat).toContain("customer.history");
  });

  it("shows a countersign being required and the call then allowed", () => {
    expect(raw).toContain("call.countersign_required");
    expect(raw).toContain("gate.cleared");
  });

  it("is complete, so the replay is not a partial history", () => {
    expect(record.lossy).toBe(false);
    expect(record.entries.length).toBeGreaterThan(20);
  });
});
