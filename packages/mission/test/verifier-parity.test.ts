import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonical } from "../src/canonical.js";

/**
 * The standalone verifier duplicates this package's hashing on purpose, so that
 * a record can be checked without the code that produced it. Independence is
 * the point: a verifier sharing a canonicaliser with the writer would cancel
 * out a bug in it and pass a record nobody else could reproduce.
 *
 * The hazard `canonical.ts` warns about is real all the same -- two
 * canonicalisers that drift apart make a chain check that quietly accepts
 * altered records, which is worse than no check. So the copies are pinned to
 * each other here: independent at runtime, and unable to diverge in silence.
 */

const script = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-record.mjs", import.meta.url)),
  "utf8",
);

/** The script's own canonicaliser, lifted out and run against this one. */
async function scriptCanonical(): Promise<(value: unknown) => string> {
  const source = script.slice(
    script.indexOf("function canonical(value) {"),
    script.indexOf("const sha256 ="),
  );
  expect(source, "canonical() not found in verify-record.mjs").toContain("sort");

  const module = await import(
    `data:text/javascript,${encodeURIComponent(`${source}\nexport { canonical };`)}`
  );
  return module.canonical as (value: unknown) => string;
}

describe("the standalone verifier hashes the same way this package does", () => {
  it("agrees on every shape a record entry can hold", async () => {
    const theirs = await scriptCanonical();

    const cases: unknown[] = [
      null,
      0,
      -1,
      1.5,
      "",
      "a string",
      true,
      false,
      [],
      {},
      [1, "two", null, { b: 1, a: 2 }],
      // Key order is the whole reason canonicalisation exists: these two must
      // produce identical output.
      { a: 1, b: 2 },
      { b: 2, a: 1 },
      { nested: { z: [1, 2], a: { deep: "value" } } },
      { undefinedIsDropped: undefined, kept: 1 },
      { "key with spaces": 1, "quote\"inside": 2 },
      { unicode: "café · 🛰️" },
      { at: 1_787_712_200_936, sequence: 12, event: { type: "world" } },
    ];

    for (const value of cases) {
      expect(theirs(value), `disagreed on ${JSON.stringify(value)}`).toBe(canonical(value));
    }
  });

  it("produces the same chain hash for a real entry", async () => {
    const theirs = await scriptCanonical();
    const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

    const entry = {
      previous: "a".repeat(64),
      sequence: 7,
      at: 1_787_712_200_936,
      event: { type: "world", event: { type: "gate.raised", office: "charge.refund" } },
    };

    expect(sha256(theirs(entry))).toBe(sha256(canonical(entry)));
  });
});

/**
 * The failure paths, exercised rather than read.
 *
 * These used to assert that certain strings appeared in the script's source,
 * which would have passed just as happily against validation that was broken,
 * unreachable, or commented out. The only way to know a verifier refuses a bad
 * record is to hand it one.
 */
describe("the verifier refuses records it should refuse", () => {
  const script = fileURLToPath(new URL("../../../scripts/verify-record.mjs", import.meta.url));

  function run(record: unknown): { code: number; out: string } {
    const file = join(mkdtempSync(join(tmpdir(), "scope-verify-")), "record.json");
    writeFileSync(file, JSON.stringify(record));
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
  }

  /** A minimal record whose chain actually checks out. */
  function sound() {
    const scope = { scopeId: "SC-1", job: "do the thing", offices: ["charge.get"] };
    const missionId = "m_" + "a".repeat(10);
    let previous = createHash("sha256")
      .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
      .digest("hex");

    const entries = [{ sequence: 1, at: 1, event: { type: "mission.status", status: "completed" } }].map(
      (entry) => {
        const hash = createHash("sha256")
          .update(canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }))
          .digest("hex");
        previous = hash;
        return { ...entry, hash };
      },
    );

    return { missionId, scopeId: scope.scopeId, job: scope.job, scope, entries, head: previous, algorithm: "sha256", lossy: false };
  }

  it("accepts a sound record", () => {
    const { code, out } = run(sound());
    expect(code, out).toBe(0);
    expect(out).toContain("chain intact");
  });

  it("rejects an altered entry and names it", () => {
    const record = sound();
    record.entries[0]!.event = { type: "mission.status", status: "failed" };

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("does not match the chain");
  });

  it("rejects a head that does not match, which is how truncation shows", () => {
    const record = sound();
    record.head = "0".repeat(64);

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("head does not match");
  });

  it("refuses a lossy record instead of calling an intact chain complete", () => {
    const record = sound();
    record.lossy = true;

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("not a complete history");
  });

  it("refuses an algorithm it does not implement rather than checking a different one", () => {
    const record = sound();
    record.algorithm = "sha512";

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("only checks sha256");
  });

  it("refuses a record with no entries", () => {
    const record = { ...sound(), entries: [] };

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("no entries");
  });

  it("reports the sealed job, not the loose one, and says when they differ", () => {
    // The top-level copy sits outside the chain. Printing it as though the
    // chain covered it would attest to a field nothing attests to.
    const record = sound();
    record.job = "something else entirely";

    const { code, out } = run(record);
    expect(code).toBe(0);
    expect(out).toContain("do the thing");
    expect(out).toContain("disagrees with the sealed scope");
  });

  it("counts a raised gate with no clear as unanswered", () => {
    // The explicit `gate.abandoned` event only exists in records written after
    // it did. A gate raised and never cleared is the same fact, structurally.
    const scope = { scopeId: "SC-1", job: "j", offices: [] };
    const missionId = "m_" + "b".repeat(10);
    let previous = createHash("sha256")
      .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
      .digest("hex");

    const raw = [
      { sequence: 1, at: 1, event: { type: "world", event: { type: "gate.raised", threadId: "main", toolCallId: "tc_1", office: "charge.refund", args: {}, at: 1 } } },
      { sequence: 2, at: 2, event: { type: "mission.status", status: "cancelled" } },
    ];
    const entries = raw.map((entry) => {
      const hash = createHash("sha256")
        .update(canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }))
        .digest("hex");
      previous = hash;
      return { ...entry, hash };
    });

    const { code, out } = run({ missionId, scopeId: scope.scopeId, job: scope.job, scope, entries, head: previous, algorithm: "sha256", lossy: false });

    expect(code, out).toBe(0);
    expect(out).toMatch(/left unanswered\s+1/);
  });
});
