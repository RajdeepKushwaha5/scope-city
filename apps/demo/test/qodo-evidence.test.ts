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

  it("links to replies inside review threads, not only to the PRs", () => {
    // The hackathon says a thread where a finding was answered reads better
    // than a clean run nobody replied to, and it asks for dismissals to be
    // recorded in the thread specifically. This section claimed a dismissal was
    // "recorded in the review thread" while every thread in the repository had
    // zero human replies -- true of the stylesheet, false of the thread.
    // The three replies, by URL, rather than a count of anything that looks
    // like one. Counting `#discussion_r<digits>` accepted plain text, a
    // malformed URL, or a link to the bot's own comment -- so the clickable
    // human replies could be swapped out while the test stayed green, which is
    // the failure this test exists to prevent, one level up.
    //
    // The list moved when the section did. It named three replies chosen
    // because they were the only three that existed; it names five now, chosen
    // because each is a different kind of answer -- a fix, a contradiction
    // between two findings, a security bug in the security code, a design safe
    // against one attack and not another, and a decline with its trade written
    // down.
    //
    // Every one of these is the anchor of a *reply*, not of the finding it
    // answers. The first attempt at this update used the finding anchors, which
    // are the bot's own comments -- the test passed and the README linked
    // readers at the questions rather than the answers, which is the precise
    // substitution it exists to prevent. Checked by asking the API which
    // comments have an `in_reply_to_id`; a `#discussion_r` in a URL says
    // nothing about who wrote it.
    const REPLIES = [
      "https://github.com/RajdeepKushwaha5/scope-city/pull/27#discussion_r3885951235",
      "https://github.com/RajdeepKushwaha5/scope-city/pull/60#discussion_r3885956166",
      "https://github.com/RajdeepKushwaha5/scope-city/pull/44#discussion_r3885954296",
      "https://github.com/RajdeepKushwaha5/scope-city/pull/48#discussion_r3885957729",
      "https://github.com/RajdeepKushwaha5/scope-city/pull/33#discussion_r3885957801",
    ];

    for (const url of REPLIES) {
      // As a markdown link, so it is clickable rather than merely present.
      expect(section, `should link ${url}`).toContain(`(${url})`);
    }
  });

  it("owns the three commits that predate the workflow", () => {
    // They are the scope evaluator, the ledger and the proxy -- the most
    // important code in the project. A judge running `git log` finds them in a
    // minute, and finding them unmentioned is worse than reading about them.
    expect(section).toMatch(/predate the workflow/i);
  });

  it("does not claim a coverage it has not counted", () => {
    /*
     * This test used to require the sentence "every merged pull request carries
     * a Qodo review", and that sentence was false: nine of the eighty-five did
     * not, because they were merged inside the five minutes Qodo takes to post.
     * So the test was holding an untrue claim in place, which is worse than not
     * having tested it -- a reader would find the assertion and take it as
     * evidence the claim had been checked.
     *
     * What is checkable from here is whether the section overstates. An
     * unqualified "every ... carries a Qodo review" is the shape that went
     * wrong, and naming the exceptions is what makes the rest believable. The
     * count itself is verified against GitHub, not against this file, which is
     * the whole reason the PR list is linked.
     */
    const total = section.slice(section.indexOf("### The record"));

    expect(
      total,
      "an unqualified coverage claim is the thing that went stale",
    ).not.toMatch(/every merged pull request carries a Qodo review/i);
    expect(total, "the exceptions have to be named to be checkable").toMatch(
      /pull\/28|pull\/97/,
    );
    expect(total, "and the list is how a reader checks the rest").toContain("is%3Amerged");
  });

  it("fails when the section is missing rather than reading the whole file", () => {
    // The slice used to fail open. Proven against a README with the heading
    // renamed: the helper must reject it instead of returning 500 lines of
    // unrelated prose that happens to satisfy every other assertion here.
    expect(() => evidenceSection(readme.replace("## Qodo Code Review Evidence", "## Gone"))).toThrow();
    expect(() => evidenceSection(readme.replace("## How this was built", "## Gone"))).toThrow();
  });
});
