import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The hackathon asks for a public record that Qodo reviewed the work, and this
 * section is that record. It is also the section a judge is most likely to
 * check line by line, so a stale number or an overstated claim in it costs more
 * than the same mistake anywhere else in the README.
 *
 * It has already drifted once: it counted "32 of 32" long after the count had
 * moved, and it said follow-up reviews were requested with a slash command that
 * never actually reached GitHub -- the shell mangled the leading slash into a
 * path, so every request was posted as `D:/Git/agentic_review` and ignored.
 * Qodo re-reviews on push, which is why the process worked anyway. Claiming a
 * mechanism that was not the one operating is exactly the kind of small
 * untruth this project spends the rest of its README arguing against.
 */
const readme = readFileSync(
  fileURLToPath(new URL("../../../README.md", import.meta.url)),
  "utf8",
);
/**
 * Sliced only after both headings are found.
 *
 * `indexOf` returns -1 for a heading that has been renamed, and `slice(n, -1)`
 * then quietly hands back almost the whole README -- so every assertion below
 * would go on passing against unrelated prose further down the file. A test
 * that cannot tell the section is missing is worse than no test, because it
 * reports the section as healthy.
 */
function evidenceSection(text: string): string {
  const start = text.indexOf("## Qodo Code Review Evidence");
  const end = text.indexOf("## How this was built");

  expect(start, "the evidence heading must exist").toBeGreaterThan(-1);
  expect(end, "the heading after it must exist, to bound the slice").toBeGreaterThan(start);

  return text.slice(start, end);
}

const section = evidenceSection(readme);

describe("the Qodo evidence section", () => {
  it("exists, and is where the hackathon says to put it", () => {
    expect(readme).toContain("## Qodo Code Review Evidence");
    expect(section.length).toBeGreaterThan(1_000);
  });

  it("links merged pull requests rather than describing them", () => {
    // The public PR link is the required proof; prose about a review is not.
    const links = section.match(/pull\/\d+/g) ?? [];
    expect(new Set(links).size).toBeGreaterThanOrEqual(5);
  });

  it("shows follow-up rounds, not just a first pass", () => {
    // "Qodo was part of the process, not a one-time step" is the thing being
    // evidenced, and second rounds on the same PR are what show it.
    expect(section).toMatch(/follow-up|second and third rounds|same PR/i);
  });

  it("does not claim reviews were requested by a command that never worked", () => {
    // Posted through a Windows shell, `/agentic_review` reached GitHub as
    // `D:/Git/agentic_review`. Qodo reviews on push; say that instead.
    expect(section).not.toMatch(/requested with\s*\n?\s*`?\/agentic_review`?/);
    expect(section).toMatch(/automatically on each push/i);
  });

  it("owns the three commits that predate the workflow", () => {
    // They are the scope evaluator, the ledger and the proxy -- the most
    // important code in the project. A judge running `git log` finds them in a
    // minute, and finding them unmentioned is worse than reading about them.
    expect(section).toMatch(/predate the workflow/i);
  });

  it("does not state a total that goes stale on the next merge", () => {
    // It said "32 of 32" long after it had moved, and "60 of 60" would have
    // been wrong the moment the PR writing it merged. The durable claim is the
    // invariant -- every merged PR has a review -- with the PR list as the
    // proof, which is what the hackathon asks for anyway.
    const total = section.slice(section.indexOf("### The record"));

    expect(total).not.toMatch(/\d+ of \d+/);
    expect(total).toMatch(/every merged pull request carries a Qodo review/i);
    expect(total).toContain("is%3Amerged");
  });

  it("fails when the section is missing rather than reading the whole file", () => {
    // The slice used to fail open. Proven against a README with the heading
    // renamed: the helper must reject it instead of returning 500 lines of
    // unrelated prose that happens to satisfy every other assertion here.
    expect(() => evidenceSection(readme.replace("## Qodo Code Review Evidence", "## Gone"))).toThrow();
    expect(() => evidenceSection(readme.replace("## How this was built", "## Gone"))).toThrow();
  });
});
