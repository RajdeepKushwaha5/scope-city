import { describe, expect, it } from "vitest";
import {
  githubIssueNumber,
  resolveGitHubTicketMetadata,
  validateGitHubIssueBoundary,
} from "./github-ticket.js";

describe("GitHub ticket boundary", () => {
  it("denies malformed and unsafe ticket identifiers", () => {
    expect(githubIssueNumber("issue-7")).toBeNull();
    expect(githubIssueNumber("tkt_0")).toBeNull();
    expect(githubIssueNumber("tkt_999999999999999999999")).toBeNull();
  });

  it("denies missing, empty, and duplicate authority labels", () => {
    expect(resolveGitHubTicketMetadata([])).toEqual({ ok: false, reason: "ambiguous_metadata" });
    expect(resolveGitHubTicketMetadata([
      "scope-city:order:",
      "scope-city:email:owner@example.test",
    ])).toEqual({ ok: false, reason: "ambiguous_metadata" });
    expect(resolveGitHubTicketMetadata([
      "scope-city:order:ord_184",
      "scope-city:order:ord_999",
      "scope-city:email:owner@example.test",
    ])).toEqual({ ok: false, reason: "ambiguous_metadata" });
  });

  it("denies pull requests and malformed envelopes", () => {
    expect(validateGitHubIssueBoundary({ number: 7, title: "PR", pullRequest: {} })).toEqual({
      ok: false,
      reason: "pull_request",
    });
    expect(validateGitHubIssueBoundary({ number: "7", title: "Issue" })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("accepts one exact identifier and one value for each authority label", () => {
    expect(githubIssueNumber("tkt_7")).toBe(7);
    expect(resolveGitHubTicketMetadata([
      "unrelated",
      "scope-city:email:owner@example.test",
      "scope-city:order:ord_184",
    ])).toEqual({ ok: true, orderId: "ord_184", customerEmail: "owner@example.test" });
    expect(validateGitHubIssueBoundary({ number: 7, title: "Issue" })).toEqual({ ok: true });
  });
});
