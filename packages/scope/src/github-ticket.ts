export type TicketMetadataResult =
  | { readonly ok: true; readonly orderId: string; readonly customerEmail: string }
  | { readonly ok: false; readonly reason: "ambiguous_metadata" };

/** Parse the only ticket identifier shape that may cross the GitHub boundary. */
export function githubIssueNumber(ticketId: string): number | null {
  const match = /^tkt_([1-9][0-9]*)$/.exec(ticketId);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Resolve authority-bearing labels without depending on their order.
 * Missing, empty, duplicated, or conflicting values all fail closed.
 */
export function resolveGitHubTicketMetadata(
  labels: readonly string[],
  orderPrefix = "scope-city:order:",
  emailPrefix = "scope-city:email:",
): TicketMetadataResult {
  const orders = labels
    .filter((label) => label.startsWith(orderPrefix))
    .map((label) => label.slice(orderPrefix.length))
    .filter(Boolean);
  const emails = labels
    .filter((label) => label.startsWith(emailPrefix))
    .map((label) => label.slice(emailPrefix.length))
    .filter(Boolean);

  if (orders.length !== 1 || emails.length !== 1) {
    return { ok: false, reason: "ambiguous_metadata" };
  }
  return { ok: true, orderId: orders[0]!, customerEmail: emails[0]! };
}

export type GitHubIssueBoundaryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "pull_request" | "malformed" };

/** Validate the minimum trusted issue envelope before its contents are used. */
export function validateGitHubIssueBoundary(issue: {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly pullRequest?: unknown;
}): GitHubIssueBoundaryResult {
  if (issue.pullRequest !== undefined) return { ok: false, reason: "pull_request" };
  if (typeof issue.number !== "number" || typeof issue.title !== "string") {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true };
}
