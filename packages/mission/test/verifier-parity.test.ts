import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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

  it("checks the algorithm the record names rather than assuming one", () => {
    // A record naming an algorithm the script does not implement must not be
    // reported as verified against a different one.
    expect(script).toContain('record.algorithm !== "sha256"');
  });

  it("refuses a lossy record instead of calling an intact chain complete", () => {
    // The chain over a truncated history verifies perfectly. Reporting that as
    // verified is the most misleading thing the script could print.
    expect(script).toContain("record.lossy");
  });

  it("exits non-zero when a record does not verify", () => {
    // It is meant to be usable in a pipeline, where a verdict nobody can act on
    // is not a verdict.
    expect(script).toContain("process.exit(1)");
  });
});
