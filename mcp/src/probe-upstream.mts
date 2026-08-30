import { upstreamMcpSystem } from "./systems/upstream-mcp.js";

async function main(): Promise<void> {
  const system = await upstreamMcpSystem({
    district: "proving-ground",
    title: "Everything (reference MCP server)",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", process.env.PROBE_SERVER ?? "@modelcontextprotocol/server-everything"],
    offices: process.env.PROBE_SERVER ? [] : [{ office: "echo.say", tool: "echo", argMap: { message: "message" } }],
  });
  console.log("discovered:", system.discovered.join(", "));
  const office = system.offices[0];
  if (office) {
    console.log("result:", JSON.stringify(await office.call({ message: "the boundary holds" })));
  }
  await system.close();
}
main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
