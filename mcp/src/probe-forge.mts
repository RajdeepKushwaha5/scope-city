import { forgeSystem } from "./systems/forge.js";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const forge = await forgeSystem({
    owner: process.env.FORGE_OWNER ?? "RajdeepKushwaha5",
    repo: process.env.FORGE_REPO ?? "scope-city",
    token,
  });

  console.log(`upstream advertises ${forge.discovered.length} tools`);
  console.log(`the scope grants   ${forge.offices.length}: ${forge.offices.map((o) => o.office).join(", ")}`);

  const get = forge.offices.find((o) => o.office === "issue.get")!;
  const issue = (await get.call({ issue_number: process.env.FORGE_ISSUE ?? "102" })) as Record<string, unknown>;
  console.log("issue.get ->", JSON.stringify({ number: issue.number, title: issue.title, state: issue.state }));

  await forge.close();
}

main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
