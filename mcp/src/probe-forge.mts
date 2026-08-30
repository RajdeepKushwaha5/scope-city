/**
 * The adapter, and only the adapter.
 *
 * This checks one thing: that `forgeSystem()` can start GitHub's MCP server,
 * agree on what it advertises, and read an issue back through the argument
 * mapping. It calls the office handler directly -- no scope, no mission, no
 * proxy -- so it proves nothing about the boundary. The three offices it prints
 * are the ones `forgeSystem` configures, which is a hard-coded allowlist in the
 * adapter and not a grant an evaluator enforced.
 *
 * The claim the project actually makes -- a scope decides what a TrueForge
 * agent can see and do over a foreign server -- needs the evaluator, the
 * projector, the ledger, the gate and a mission-specific `tools/list`. That is
 * `apps/demo/src/probe-forge-through-harness.ts`, which drives the whole chain
 * and asserts on the listing the boundary serves rather than on this one.
 *
 * Kept because when that probe fails, this is how you find out whether the
 * upstream or the boundary is the reason.
 */
import { forgeSystem } from "./systems/forge.js";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const forge = await forgeSystem({
    owner: process.env.FORGE_OWNER ?? "RajdeepKushwaha5",
    repo: process.env.FORGE_REPO ?? "scope-city",
    token,
  });

  console.log(`upstream advertises   ${forge.discovered.length} tools`);
  console.log(
    `the adapter configures ${forge.offices.length}: ${forge.offices.map((o) => o.office).join(", ")}`,
  );
  console.log("  (an allowlist in forge.ts, not a scope -- see probe:forge-harness)");

  const get = forge.offices.find((o) => o.office === "issue.get")!;
  const issue = (await get.call({ issue_number: process.env.FORGE_ISSUE ?? "102" })) as Record<
    string,
    unknown
  >;
  console.log(
    "issue.get ->",
    JSON.stringify({ number: issue.number, title: issue.title, state: issue.state }),
  );

  await forge.close();
}

main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
