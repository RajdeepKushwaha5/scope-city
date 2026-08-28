import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The README prints what the verifier says about the shipped recording. Nothing
 * checked that it still did.
 *
 * It had drifted: the README showed 49 entries and a head of 455e7a3c against a
 * recording with 71 and a different head, because replacing the recording is a
 * change to one JSON file and remembering to restate its output is a thing a
 * person does or does not do. A reader who ran the command got different numbers
 * from the ones printed a line above it -- which is exactly the kind of small
 * wrongness that makes someone doubt the parts they cannot check.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const readme = readFileSync(`${root}README.md`, "utf8");

const verifier = execFileSync(
  process.execPath,
  ["scripts/verify-record.mjs", "apps/city/public/replays/refund-184.json"],
  { cwd: root, encoding: "utf8" },
);

/** The lines of the README's sample output, as printed. */
const sample = (() => {
  const at = readme.indexOf("node scripts/verify-record.mjs");
  const open = readme.indexOf("```", readme.indexOf("```", at) + 3);
  const close = readme.indexOf("```", open + 3);
  return readme.slice(open + 3, close);
})();

/** Trimmed and internally collapsed, empties dropped, so a reflow is not drift. */
const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length > 0);

describe("the README shows what the verifier actually says", () => {
  it("agrees on every line it prints, in order", () => {
    // Whole lines, not substrings, and in sequence.
    //
    // Matching each claim against the whole output as a substring let a wrong
    // claim pass on a prefix: "entries 7" is contained in "entries 71", so the
    // number most likely to drift was the one least likely to be caught. It
    // also promised "line by line" while checking nothing about order, so a
    // sample listing the lease before the offices would have read as correct.
    const claimed = linesOf(sample);
    const actual = linesOf(verifier);

    expect(claimed.length).toBeGreaterThan(5);

    let from = 0;
    for (const line of claimed) {
      const at = actual.indexOf(line, from);
      // Named individually so a failure points at the line that drifted rather
      // than printing two blocks and leaving the reader to diff them.
      expect(at, `README claims: ${line}`).toBeGreaterThan(-1);
      from = at + 1;
    }
  });

  it("shows a recording that verifies", () => {
    expect(verifier).toContain("chain intact");
  });

  it("shows the delegated recording, which is the one that was shipped", () => {
    // The claim that survived longest after it stopped being true was that the
    // recording had to be single-threaded because a delegated mission could not
    // finish. It can, and this is it.
    expect(verifier).toMatch(/threads\s+\d+ \(subagents ran\)/);
    expect(readme).not.toContain("single-threaded");
  });
});
