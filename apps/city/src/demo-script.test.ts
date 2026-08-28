import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The running order quotes the city back to itself.
 *
 * A demo script full of lines the product no longer prints is worse than none:
 * it gets read once, believed, and then contradicted live. The log lines in
 * `docs/DEMO.md` are the ones the scenarios actually emit, and this keeps them
 * that way -- the scenarios are edited far more often than the script is
 * reread.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = readFileSync(`${root}docs/DEMO.md`, "utf8");
const scenarios = readFileSync(`${root}apps/city/src/useMission.ts`, "utf8");

/** Lines the script puts on screen and reads aloud. */
const QUOTED = [
  "Injected instruction obeyed — nothing to stop it",
  "charge.refund ch_185 $399.00 — SUCCEEDED",
  "customer.list — 3 records exfiltrated",
  "mail.send attacker@example.test — SENT",
  "Mission ended. Three irreversible actions, none authorised.",
  "Ticket body contains an injected instruction — flagged, not obeyed",
  "charge.get ch_184 — history redacted by projection",
  "not a granted charge",
];

describe("the demo script quotes lines the city still prints", () => {
  for (const line of QUOTED) {
    it(`still emits: ${line.slice(0, 46)}`, () => {
      expect(script, "the script should quote it").toContain(line);
      expect(scenarios, "the scenario should emit it").toContain(line);
    });
  }
});

describe("the script tells you to press what the buttons say", () => {
  const order = readFileSync(`${root}apps/city/src/hud/MissionOrder.tsx`, "utf8");

  it("names both buttons exactly", () => {
    for (const label of ["1 · Without a scope", "2 · With a scope"]) {
      expect(script, `script names ${label}`).toContain(label);
      expect(order, `button says ${label}`).toContain(label);
    }
  });

  it("runs commands the workspace actually defines", () => {
    // A demo that opens on a command-not-found is over before it starts.
    const demoPkg = readFileSync(`${root}apps/demo/package.json`, "utf8");
    const cityPkg = readFileSync(`${root}apps/city/package.json`, "utf8");

    expect(script).toContain("probe:code-mode");
    expect(demoPkg).toContain('"probe:code-mode"');
    expect(script).toContain("scripts/verify-record.mjs");
    expect(cityPkg).toContain('"dev"');
  });
});

describe("the script keeps the comparison first", () => {
  it("reaches the two-run comparison before any other replay", () => {
    // The whole reason the script exists. If the Yard or the recorded run
    // creeps above it, the demo has drifted back into a feature tour.
    // Matched on single words, because the prose is hard-wrapped and a phrase
    // that spans a line break is a test that fails on reflow rather than on
    // drift.
    const comparison = script.indexOf("The same ticket, twice");
    const yard = script.indexOf("over-reach");
    const recorded = script.indexOf("verify-record.mjs");

    expect(comparison).toBeGreaterThan(-1);
    expect(yard).toBeGreaterThan(comparison);
    expect(recorded).toBeGreaterThan(comparison);
  });

  it("refuses to let the verifier be cut", () => {
    expect(script).toMatch(/Never cut.*comparison or the verifier/i);
  });
});
