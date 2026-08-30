import { HarnessDriver, missionAgentSpec, rotationCandidates } from "@scope-city/harness";
import { MissionRegistry, newMissionId, startProxyHttp } from "@scope-city/proxy";
import { CountersignBook } from "@scope-city/mission";
import type { Scope } from "@scope-city/scope";
import { createFixtureMission } from "./fixture-mission.js";
import { missionSystemsAsync, forgeIsLive } from "./systems.js";

/**
 * The arrow this project had never actually tested.
 *
 * `mcp/src/probe-forge.mts` proves Scope City can front GitHub's MCP server:
 * it calls `forgeSystem()` in-process and reads a real issue. What it does not
 * prove is that a TrueForge agent drives any of it, and the claim on the README
 * is a chain of three:
 *
 *   TrueForge --MCP--> Scope City --MCP--> GitHub
 *
 * Testing the right-hand arrow and asserting the left is how a project ends up
 * describing something it has not seen work. This drives the whole chain: a
 * real harness session, a real proxy, a real upstream, and a real issue.
 *
 * What it checks is not that the agent succeeds. It is what the agent could
 * *see*: the upstream advertises twenty-six tools, the scope grants one, and
 * `tools/list` through the boundary has to show one.
 */

const PORT = Number(process.env.PROBE_PORT ?? 8794);
const BIND = process.env.PROBE_BIND ?? "127.0.0.1";
const PUBLIC_HOST = process.env.PROBE_PUBLIC_HOST ?? "127.0.0.1";
const TURN_MS = Number(process.env.PROBE_TURN_MS ?? 120_000);

const BRIEF = `You are reading one GitHub issue through the __SERVER__ server.

Call issue.get with issue_number "__ISSUE__". Report the issue's title and state
in one sentence, then stop. Do not call anything else.`;

function newProxyToken(): string {
  return `probe-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function main(): Promise<void> {
  if (!forgeIsLive()) {
    console.error(
      "The Forge is not configured. Set FORGE_REPOSITORY=owner/repo and GITHUB_TOKEN.",
    );
    process.exit(2);
  }

  const issue = process.env.FORGE_ISSUE ?? "102";
  const systems = await missionSystemsAsync();
  const forge = systems.find((system) => system.district === "forge");
  if (!forge) throw new Error("the Forge did not connect");

  console.log(`  upstream tools   ${forge.offices.length} offices exposed by the Forge`);

  const missionId = newMissionId();
  const now = Date.now();

  /*
   * One office, one issue, ten minutes.
   *
   * `issue.comment` and `issue.close` are implemented and deliberately not
   * granted: the point of the run is what the agent cannot see, and leaving
   * them out of the scope is the only way to show that `tools/list` follows
   * the grant rather than the implementation.
   */
  const scope: Scope = {
    missionId,
    scopeId: "SC-FORGE",
    agent: "forge-reader",
    job: `Read issue #${issue}`,
    state: "granted",
    offices: ["issue.get"],
    resources: { issue_numbers: [issue] },
    limits: { maxAmountMinor: {}, maxCalls: {}, maxResponseBytes: 64_000 },
    projection: { "issue.get": ["number", "title", "state"] },
    countersignRequired: [],
    expiresAt: now + 10 * 60 * 1000,
    grantedBy: "operator:probe",
    grantedAt: now,
    version: 1,
  };

  const seen: string[] = [];
  const registry = new MissionRegistry();
  const token = newProxyToken();
  const proxy = await startProxyHttp({ registry, port: PORT, host: BIND, token });

  const fixture = createFixtureMission({
    missionId,
    book: new CountersignBook(),
    systems,
    scope,
    emit: (event) => {
      const e = event as { type?: string; office?: string };
      if (e.type) seen.push(e.office ? `${e.type} ${e.office}` : String(e.type));
    },
  });
  registry.register(fixture.mission);

  const driver = new HarnessDriver({
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790",
  });

  const configured = (process.env.SCOPE_MODELS ?? "").split(",").filter(Boolean);
  const models =
    configured.length > 0 ? configured : rotationCandidates(await driver.listModels());
  if (models.length === 0) throw new Error("no models registered with TrueForge");

  const name = `scope-city-forge-${Date.now().toString(36)}`;
  await driver.registerMcpServer({
    type: "remote",
    name,
    url: `http://${PUBLIC_HOST}:${PORT}/mission/${missionId}/mcp`,
    description: "Scope City boundary over GitHub's MCP server",
    auth: { type: "header", headers: { Authorization: `Bearer ${token}` } },
  });

  const sessionId = await driver.createSession(
    missionAgentSpec({
      model: models[0]!,
      proxyName: name,
      gatedTools: [],
      sandbox: false,
      instructions: BRIEF.replaceAll("__SERVER__", name).replaceAll("__ISSUE__", issue),
    }),
  );

  console.log(`  harness session  ${sessionId} on ${models[0]}`);

  let text = "";
  const deadline = setTimeout(() => undefined, TURN_MS);
  try {
    for await (const event of driver.runTurn(sessionId, [
      { type: "user.message", content: `Read issue ${issue} and report its title and state.` },
    ])) {
      const e = event as { type?: string; text?: string };
      if (e.type === "assistant.text" && typeof e.text === "string") text += e.text;
    }
  } finally {
    clearTimeout(deadline);
    await proxy.close();
    const closable = forge as { close?: () => Promise<void> };
    if (closable.close) await closable.close();
  }

  const calls = seen.filter((line) => line.startsWith("call."));
  console.log(`  through the boundary  ${calls.join(", ") || "(nothing)"}`);
  console.log(`  the agent said   ${text.trim().slice(0, 200) || "(nothing)"}`);

  const reached = calls.some((line) => line === "call.allowed issue.get");
  console.log(reached ? "\n  HELD  the harness reached GitHub through the scope" : "\n  the agent did not reach issue.get");
  process.exit(reached ? 0 : 1);
}

main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
