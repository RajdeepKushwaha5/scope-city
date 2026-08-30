#!/usr/bin/env node
/**
 * Whether every merged pull request was reviewed by Qodo before it merged.
 *
 * The check this replaces counted inline review comments, which is not the same
 * question. Ten pull requests have none, and every one of them was reviewed --
 * Qodo posted a review and had nothing to flag. Counting comments reported them
 * as unreviewed, and the README said so for a day.
 *
 * A review is the summary Qodo posts as an issue comment on the pull request.
 * That is what exists whether or not there were findings, so that is what this
 * reads, and it compares the timestamp to the merge: a review that lands after
 * the merge did not inform it.
 *
 *   node scripts/audit-qodo.mjs            # the summary
 *   node scripts/audit-qodo.mjs --verbose  # one line per pull request
 *
 * Needs `gh` authenticated. Read-only.
 */
import { execFileSync } from "node:child_process";

const REPO = process.env.AUDIT_REPO ?? "RajdeepKushwaha5/scope-city";
const BOT = "qodo-code-review[bot]";
const verbose = process.argv.includes("--verbose");

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const merged = gh([
  "pr", "list", "--repo", REPO, "--state", "merged", "--limit", "300",
  "--json", "number,mergedAt",
]).sort((a, b) => a.number - b.number);

const unreviewed = [];
const afterMerge = [];
const noFindings = [];
let findings = 0;

for (const pr of merged) {
  const reviews = gh([
    "api", `repos/${REPO}/issues/${pr.number}/comments`, "--paginate",
  ]).filter((c) => c.user.login === BOT);
  const inline = gh([
    "api", `repos/${REPO}/pulls/${pr.number}/comments`, "--paginate",
  ]).filter((c) => c.user.login === BOT && !c.in_reply_to_id);

  findings += inline.length;
  const first = reviews[0]?.created_at;

  if (!first) unreviewed.push(pr.number);
  else if (first > pr.mergedAt) afterMerge.push(pr.number);
  if (inline.length === 0) noFindings.push(pr.number);

  if (verbose) {
    const when = first ? `reviewed ${first}` : "NO REVIEW";
    console.log(`#${pr.number}  merged ${pr.mergedAt}  ${when}  ${inline.length} findings`);
  }
}

console.log(`
  merged pull requests   ${merged.length}`);
console.log(`  reviewed before merge  ${merged.length - unreviewed.length - afterMerge.length}`);
console.log(`  inline findings        ${findings}`);
console.log(`  reviewed, no findings  ${noFindings.length}: ${noFindings.join(", ")}`);

if (unreviewed.length > 0) console.log(`  NOT REVIEWED           ${unreviewed.join(", ")}`);
if (afterMerge.length > 0) console.log(`  REVIEWED AFTER MERGE   ${afterMerge.join(", ")}`);

// A non-zero exit is the point: the README's claim is that both of those lists
// are empty, and this is what would say otherwise.
process.exit(unreviewed.length + afterMerge.length === 0 ? 0 : 1);
