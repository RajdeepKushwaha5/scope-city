import { upstreamMcpSystem, type UpstreamSystem } from "./upstream-mcp.js";

/**
 * The Forge: a district behind GitHub's own MCP server.
 *
 * Every other district here is code in this repository. This one is not: the
 * server is `@modelcontextprotocol/server-github`, Scope City writes none of
 * it, and the boundary is enforced over it unchanged. That is the difference
 * between an enforcement layer and three carefully written systems.
 *
 * The server advertises twenty-six tools. Among them are `merge_pull_request`,
 * `push_files`, `create_or_update_file` and `create_repository` -- every one of
 * them reachable by anything holding the token. A scope here grants three, and
 * the other twenty-three are not refused to the agent: they are absent from
 * `tools/list`, so there is nothing for an injected instruction to name.
 *
 * `owner` and `repo` are fixed by the office rather than passed by the agent,
 * which is where most of the authority lives. A token reaches every repository
 * its holder can see; an office that supplies its own owner and repo reduces
 * the agent's entire say to an issue number the scope has already granted.
 */

export interface ForgeOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
}

export const FORGE_DISTRICT = "forge";

/**
 * Which offices the Forge implements, as data.
 *
 * Separate from `forgeSystem` because the registry's consistency test asserts
 * that every policed office is implemented by something, and it cannot start a
 * subprocess or hold a token to find out. A district that can only answer that
 * question by connecting is a district the invariant quietly stops covering.
 */
export const FORGE_OFFICES: readonly string[] = ["issue.get", "issue.comment", "issue.close"];

export async function forgeSystem(options: ForgeOptions): Promise<UpstreamSystem> {
  const pinned = { owner: options.owner, repo: options.repo };

  return upstreamMcpSystem({
    district: FORGE_DISTRICT,
    title: `The Forge (github.com/${options.owner}/${options.repo})`,
    // `npx.cmd` on Windows: the shell resolves `npx`, and a spawned process
    // does not have one.
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: options.token },
    offices: [
      {
        office: "issue.get",
        tool: "get_issue",
        description: "Read one issue in the granted repository.",
        argMap: { issue_number: "issue_number" },
        numericArgs: ["issue_number"],
        fixedArgs: pinned,
      },
      {
        office: "issue.comment",
        tool: "add_issue_comment",
        description: "Comment on one issue in the granted repository.",
        argMap: { issue_number: "issue_number", body: "body" },
        numericArgs: ["issue_number"],
        fixedArgs: pinned,
      },
      {
        office: "issue.close",
        tool: "update_issue",
        description: "Close one issue in the granted repository.",
        argMap: { issue_number: "issue_number" },
        numericArgs: ["issue_number"],
        /*
         * `state: "closed"` is fixed, and that is the whole office.
         *
         * `update_issue` can also retitle, relabel, reassign, and reopen. An
         * office that let the agent choose the state would be a scope over
         * "change this issue however you like" wearing the name of one that
         * closes it -- and reopening is how an agent undoes a human's decision
         * with an office that sounds harmless.
         */
        fixedArgs: { ...pinned, state: "closed" },
      },
    ],
  });
}
