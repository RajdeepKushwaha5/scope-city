import {
  NotFoundError,
  requireString,
  type OfficeHandler,
  type SystemDefinition,
} from "./types.js";
import {
  githubIssueNumber,
  resolveGitHubTicketMetadata,
  validateGitHubIssueBoundary,
} from "@scope-city/scope";

export interface GitHubRecordsOptions {
  readonly token: string;
  /** `owner/repository`, for example `acme/support-demo`. */
  readonly repository: string;
  readonly fetchImpl?: typeof fetch;
}

export class GitHubRecordsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubRecordsError";
  }
}

interface GitHubLabel {
  readonly name?: unknown;
}

interface GitHubIssue {
  readonly id?: unknown;
  readonly number?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly state?: unknown;
  readonly labels?: unknown;
  readonly pull_request?: unknown;
}

interface GitHubComment {
  readonly id?: unknown;
  readonly body?: unknown;
}

const API_VERSION = "2022-11-28";
function issueNumber(ticketId: string): number {
  const value = githubIssueNumber(ticketId);
  if (value === null) throw new TypeError("The requested ticket operation could not be completed");
  return value;
}

function labelsOf(issue: GitHubIssue): string[] {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    if (typeof label !== "object" || label === null) return [];
    const name = (label as GitHubLabel).name;
    return typeof name === "string" ? [name] : [];
  });
}

function metadata(labels: readonly string[]): { orderId: string; customerEmail: string } {
  // These labels are repository-maintainer metadata. They deliberately live
  // outside the customer-controlled issue body, because the pre-grant resolver
  // may read structured identifiers and must never read the poisoned prose.
  const result = resolveGitHubTicketMetadata(labels);
  if (!result.ok) {
    throw new GitHubRecordsError(422, "The requested ticket operation could not be completed");
  }
  return result;
}

function retryMarker(idempotencyKey: string): string {
  // The proxy generates this key, but treating it as opaque keeps this adapter
  // safe if another caller supplies one later. Percent-encoding also prevents
  // a crafted key from terminating the hidden comment early.
  return `<!-- scope-city-operation:${encodeURIComponent(idempotencyKey)} -->`;
}

function responseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GitHubRecordsError(502, "The requested ticket operation could not be completed");
  }
  return value as Record<string, unknown>;
}

export function githubRecordsSystem(options: GitHubRecordsOptions): SystemDefinition {
  const repository = options.repository.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new TypeError("GitHub repository must look like owner/repository");
  }
  if (options.token.trim() === "") throw new TypeError("GitHub token is required");

  const doFetch = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await doFetch(`https://api.github.com/repos/${repository}/${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "scope-city",
        ...(init.headers ?? {}),
      },
    });

    const body = await response.json().catch(() => null);
    if (response.status === 404) throw new NotFoundError("ticket");
    if (!response.ok) {
      throw new GitHubRecordsError(response.status, "The requested ticket operation could not be completed");
    }
    return body;
  }

  async function read(ticketId: string): Promise<GitHubIssue> {
    const issue = responseObject(
      await request(`issues/${issueNumber(ticketId)}`),
    ) as GitHubIssue;
    const boundary = validateGitHubIssueBoundary({
      number: issue.number,
      title: issue.title,
      pullRequest: issue.pull_request,
    });
    if (!boundary.ok) {
      throw new GitHubRecordsError(
        boundary.reason === "pull_request" ? 422 : 502,
        "The requested ticket operation could not be completed",
      );
    }
    return issue;
  }

  const get: OfficeHandler = {
    office: "ticket.get",
    description: "Read a support request from a GitHub issue by ticket id.",
    inputSchema: {
      type: "object",
      properties: { ticket_id: { type: "string", pattern: "^tkt_[1-9][0-9]*$" } },
      required: ["ticket_id"],
    },
    async call(args) {
      const ticketId = requireString(args, "ticket_id");
      const issue = await read(ticketId);
      const { orderId, customerEmail } = metadata(labelsOf(issue));
      return {
        id: ticketId,
        subject: issue.title,
        body: typeof issue.body === "string" ? issue.body : "",
        order_id: orderId,
        customer_email: customerEmail,
        status: issue.state === "closed" ? "closed" : "open",
      };
    },
  };

  const reply: OfficeHandler = {
    office: "ticket.reply",
    description: "Post a comment on the GitHub issue behind a support ticket.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", pattern: "^tkt_[1-9][0-9]*$" },
        body: { type: "string" },
      },
      required: ["ticket_id", "body"],
    },
    async call(args, context) {
      const ticketId = requireString(args, "ticket_id");
      const body = requireString(args, "body");
      await read(ticketId);

      const marker = context?.idempotencyKey ? retryMarker(context.idempotencyKey) : null;
      if (marker) {
        let prior: GitHubComment | undefined;
        for (let page = 1; !prior; page += 1) {
          const comments = await request(
            `issues/${issueNumber(ticketId)}/comments?per_page=100&page=${page}`,
          );
          if (!Array.isArray(comments)) {
            throw new GitHubRecordsError(502, "The requested ticket operation could not be completed");
          }
          prior = (comments as GitHubComment[]).find(
            (comment) => typeof comment.body === "string" && comment.body.includes(marker),
          );
          if (comments.length < 100) break;
        }
        if (prior && typeof prior.id === "number") {
          return { id: ticketId, replies: 1, comment_id: prior.id, replayed: true };
        }
      }

      const comment = responseObject(await request(`issues/${issueNumber(ticketId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: marker ? `${body}\n\n${marker}` : body }),
      })) as { id?: unknown };
      if (typeof comment.id !== "number") {
        throw new GitHubRecordsError(502, "The requested ticket operation could not be completed");
      }
      return { id: ticketId, replies: 1, comment_id: comment.id };
    },
  };

  const close: OfficeHandler = {
    office: "ticket.close",
    description: "Close the GitHub issue behind a support ticket.",
    inputSchema: {
      type: "object",
      properties: { ticket_id: { type: "string", pattern: "^tkt_[1-9][0-9]*$" } },
      required: ["ticket_id"],
    },
    async call(args) {
      const ticketId = requireString(args, "ticket_id");
      await read(ticketId);
      const issue = responseObject(await request(`issues/${issueNumber(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      })) as GitHubIssue;
      if (issue.state !== "closed") {
        throw new GitHubRecordsError(502, "The requested ticket operation could not be completed");
      }
      return { id: ticketId, status: "closed" };
    },
  };

  return { district: "records", title: "Records · GitHub", offices: [get, reply, close] };
}
