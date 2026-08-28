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
const section = readme.slice(
  readme.indexOf("## Qodo Code Review Evidence"),
  readme.indexOf("## How this was built"),
);

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

  it("counts what is actually there", () => {
    // The count was "32 of 32" long after it had moved. A number in the
    // evidence section is a claim like any other.
    const claimed = /(\d+) of (\d+)/.exec(section);
    expect(claimed, "the section should state a count").not.toBeNull();
    expect(claimed![1]).toBe(claimed![2]);
    expect(Number(claimed![1])).toBeGreaterThanOrEqual(60);
  });
});
