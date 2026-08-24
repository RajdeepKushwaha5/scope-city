/**
 * Talks MCP to the scope proxy directly, without a harness in the way.
 *
 * When TrueForge reports "failed to connect to remote MCP server" the fault is
 * on one of two sides and the message does not say which. This exercises our
 * side alone: initialize, list tools, call one that is in scope and one that is
 * not. If this passes and the harness still cannot connect, the problem is
 * transport negotiation rather than the proxy.
 */

import { QuotaLedger } from "@scope-city/ledger";
import { MissionRegistry, newMissionId, startProxyHttp, type Mission } from "@scope-city/proxy";
import { exchequerSystem, officeRegistry, recordsSystem } from "@scope-city/mcp";
import type { Scope } from "@scope-city/scope";

const PORT = Number(process.env.SCOPE_PROXY_PORT ?? 8793);

async function rpc(url: string, body: unknown, sessionId?: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The spec requires a client to accept both; omitting either is a common
      // cause of a 406 that reads like a server fault.
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`  ${response.status} ${response.statusText}  ${text.slice(0, 300)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  // A streamable-http response may arrive as SSE even for a single reply.
  const jsonLine = text.startsWith("event:")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim()
    : text;

  return jsonLine ? JSON.parse(jsonLine) : null;
}

async function main(): Promise<void> {
  const missionId = newMissionId();
  const now = Date.now();

  const handlers = new Map(
    [recordsSystem(), exchequerSystem()].flatMap((s) =>
      s.offices.map((o) => [o.office, o] as const),
    ),
  );

  const scope: Scope = {
    missionId,
    scopeId: "SC-probe",
    agent: "probe",
    job: "probe",
    state: "granted",
    offices: ["ticket.get", "charge.get", "charge.refund"],
    resources: { ticket_ids: ["tkt_184"], charge_ids: ["ch_184"] },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1 },
      maxResponseBytes: 64_000,
    },
    projection: {
      "ticket.get": ["id", "subject"],
      "charge.get": ["id", "amount"],
      "charge.refund": ["id", "status"],
    },
    countersignRequired: [],
    expiresAt: now + 600_000,
    grantedBy: "probe",
    grantedAt: now,
    version: 1,
  };

  const mission: Mission = {
    id: missionId,
    scope,
    registry: officeRegistry(),
    ledger: new QuotaLedger(),
    upstream: async (call) => handlers.get(call.office)!.call(call.args),
    countersign: async (r) => ({ approved: true, fingerprint: r.fingerprint }),
    emit: (e) => console.log(`  event: ${e.type} ${"office" in e ? e.office : ""}`),
    createdAt: now,
  };

  const registry = new MissionRegistry();
  registry.register(mission);

  const http = await startProxyHttp({ registry, port: PORT, host: "127.0.0.1" });
  const url = http.url(missionId);
  console.log(`\n  proxy at ${url}\n`);

  try {
    console.log("  1. initialize");
    const init = (await rpc(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "probe", version: "0" },
      },
    })) as { result?: unknown };
    console.log(`     ${JSON.stringify(init?.result ?? init).slice(0, 200)}\n`);

    console.log("  2. tools/list");
    const list = (await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result?: { tools?: { name: string }[] };
    };
    console.log(`     ${(list?.result?.tools ?? []).map((t) => t.name).join(", ")}\n`);

    console.log("  3. tools/call charge.get ch_184  (in scope)");
    await rpc(url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "charge.get", arguments: { charge_id: "ch_184" } },
    });

    console.log("\n  4. tools/call charge.refund ch_185  (out of scope)");
    await rpc(url, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "charge.refund", arguments: { charge_id: "ch_185", amount: 39_900 } },
    });

    console.log("\n  proxy speaks MCP correctly.\n");
  } finally {
    await http.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\n  probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
