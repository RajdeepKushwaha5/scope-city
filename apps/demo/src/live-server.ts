import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  HarnessDriver,
  ModelPool,
  classifyFailure,
  isWorthRotating,
  missionAgentSpec,
} from "@scope-city/harness";
import { IRREVERSIBLE_OFFICES } from "@scope-city/mcp";
import { CountersignBook, missionBrief, type CityFeedEvent } from "@scope-city/mission";
import { MissionRegistry, newMissionId, startProxyHttp } from "@scope-city/proxy";
import { createFixtureMission } from "./fixture-mission.js";
import { MissionFeed, OperatorGateQueue } from "./live-feed.js";
import { newProxyToken, runMission, type GateRequest } from "./mission-run.js";

const CONTROL_PORT = Number(process.env.SCOPE_CONTROL_PORT ?? 8787);
const PROXY_PORT = Number(process.env.SCOPE_PROXY_PORT ?? 8791);
const PROXY_BIND = process.env.SCOPE_PROXY_BIND ?? "0.0.0.0";
const PROXY_PUBLIC_HOST = process.env.SCOPE_PROXY_PUBLIC_HOST ?? "127.0.0.1";
const SANDBOX = process.env.SCOPE_SANDBOX === "true";
const MODELS = (process.env.SCOPE_MODEL ?? process.env.SCOPE_MODELS ?? "gemini-a/flash-a")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

type MissionStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

interface LiveMission {
  readonly id: string;
  readonly feed: MissionFeed;
  readonly gates: OperatorGateQueue;
  readonly scope: ReturnType<typeof createFixtureMission>["scope"];
  status: MissionStatus;
  sessionId?: string;
  expiryTimer?: NodeJS.Timeout;
}

async function main(): Promise<void> {
  const driver = new HarnessDriver();
  const registry = new MissionRegistry();
  const proxyToken = newProxyToken();
  const missions = new Map<string, LiveMission>();

  const proxy = await startProxyHttp({
    registry,
    port: PROXY_PORT,
    host: PROXY_BIND,
    token: proxyToken,
  });

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) json(res, 500, { error: detail });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      const harness = await driver.reachable();
      json(res, harness.ok ? 200 : 503, {
        ok: harness.ok,
        harness,
        activeMissions: [...missions.values()].filter((mission) => mission.status === "running").length,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/missions") {
      const active = [...missions.values()].find(
        (mission) => mission.status === "starting" || mission.status === "running",
      );
      if (active) {
        json(res, 409, { error: "a mission is already active", missionId: active.id });
        return;
      }

      const health = await driver.reachable();
      if (!health.ok) {
        json(res, 503, { error: "TrueForge is not reachable", detail: health.reason });
        return;
      }

      const id = newMissionId();
      const feed = new MissionFeed();
      const gates = new OperatorGateQueue();
      const book = new CountersignBook();
      const fixture = createFixtureMission({
        missionId: id,
        book,
        emit: (event) => feed.append({ type: "proxy", event }),
      });
      registry.register(fixture.mission);

      const live: LiveMission = {
        id,
        feed,
        gates,
        scope: fixture.scope,
        status: "starting",
      };
      missions.set(id, live);
      live.expiryTimer = setTimeout(() => {
        const expired = { ...live.scope, state: "expired" as const };
        registry.updateScope(live.id, expired);
        live.gates.cancelAll("scope expired");
        live.feed.append({ type: "scope.expired", at: Date.now() });
      }, Math.max(0, live.scope.expiresAt - Date.now()));
      feed.append({ type: "mission.status", status: "starting" });
      void runLiveMission(live, book).catch(() => undefined);

      json(res, 202, {
        missionId: id,
        status: live.status,
        scope: fixture.scope,
        eventUrl: `/api/missions/${id}/events`,
      });
      return;
    }

    const match = url.pathname.match(/^\/api\/missions\/([^/]+)\/(events|decisions|cancel)$/);
    if (!match) {
      json(res, 404, { error: "not found" });
      return;
    }

    const mission = missions.get(match[1]!);
    if (!mission) {
      json(res, 404, { error: "no such mission" });
      return;
    }

    if (req.method === "GET" && match[2] === "events") {
      streamEvents(req, res, mission, url);
      return;
    }

    if (req.method === "POST" && match[2] === "decisions") {
      const body = await readJson(req);
      const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId : "";
      const approved = body.approved === true;
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      if (!toolCallId) {
        json(res, 400, { error: "toolCallId is required" });
        return;
      }
      if (!mission.gates.decide(toolCallId, { approved, ...(reason ? { reason } : {}) })) {
        json(res, 409, { error: "that gate is not waiting" });
        return;
      }
      mission.feed.append({
        type: "world",
        event: { type: "gate.cleared", toolCallId, approved, at: Date.now() },
      });
      json(res, 200, { accepted: true });
      return;
    }

    if (req.method === "POST" && match[2] === "cancel") {
      mission.gates.cancelAll();
      if (mission.expiryTimer) clearTimeout(mission.expiryTimer);
      if (mission.sessionId) await driver.cancel(mission.sessionId);
      setStatus(mission, "cancelled");
      registry.forget(mission.id);
      json(res, 200, { cancelled: true });
      return;
    }

    json(res, 405, { error: "method not allowed" });
  }

  async function runLiveMission(live: LiveMission, book: CountersignBook): Promise<void> {
    const proxyName = "scope-city-live";
    const proxyUrl = `http://${PROXY_PUBLIC_HOST}:${PROXY_PORT}/mission/${live.id}/mcp`;
    try {
      await driver.registerMcpServer({
        type: "remote",
        name: proxyName,
        url: proxyUrl,
        description: "Scope City live mission boundary",
        auth: { type: "header", headers: { Authorization: `Bearer ${proxyToken}` } },
      });

      const pool = new ModelPool(MODELS.map((model, priority) => ({ model, priority })));
      let lastError: unknown;
      for (const model of pool.available(Date.now())) {
        let attemptSessionId: string | undefined;
        try {
          attemptSessionId = await driver.createSession(
            missionAgentSpec({
              model,
              proxyName,
              gatedTools: [...IRREVERSIBLE_OFFICES],
              sandbox: SANDBOX,
              instructions: missionBrief({ ticketId: "tkt_184", sandbox: SANDBOX }),
            }),
          );
          live.sessionId = attemptSessionId;
          setStatus(live, "running", model);
          const result = await runMission({
            driver,
            sessionId: live.sessionId,
            scope: live.scope,
            book,
            prompt: "Resolve ticket tkt_184.",
            maxTurns: 8,
            decide: (gate: GateRequest) => live.gates.wait(gate),
            onRaw: (event) => {
              if (process.env.SCOPE_TRACE === "true") {
                console.log(`[trueforge:${event.type}] ${JSON.stringify(event).slice(0, 1_000)}`);
              }
            },
            onEvent: (event) => {
              // Arm the decision before publishing the visible gate. A very
              // fast operator must never beat the stream consumer to `decide`.
              if (event.type === "gate.raised") {
                void live.gates.wait({
                  threadId: event.threadId,
                  toolCallId: event.toolCallId,
                  office: event.office,
                  args: (event.args ?? {}) as Record<string, unknown>,
                });
              }
              live.feed.append({ type: "world", event });
            },
          });
          if (!["done", "completed", "success"].includes(result.status)) {
            throw new Error(
              result.message ?? `TrueForge ended the turn with status ${result.status}`,
            );
          }
          pool.restore(model);
          setStatus(live, "completed");
          return;
        } catch (error) {
          lastError = error;
          if (attemptSessionId) {
            await driver.cancel(attemptSessionId).catch(() => undefined);
            if (live.sessionId === attemptSessionId) live.sessionId = undefined;
          }
          const kind = classifyFailure(error);
          if (!isWorthRotating(kind)) throw error;
          pool.penalise(model, kind, Date.now());
          live.feed.append({
            type: "mission.status",
            status: "starting",
            detail: `${model} unavailable; rotating (${kind})`,
          });
        }
      }
      throw lastError ?? new Error("no configured model was available");
    } catch (error) {
      live.gates.cancelAll("mission failed");
      setStatus(live, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  await new Promise<void>((resolve) => server.listen(CONTROL_PORT, "127.0.0.1", resolve));
  console.log(`Scope City control plane: http://127.0.0.1:${CONTROL_PORT}`);

  const close = async () => {
    for (const mission of missions.values()) {
      mission.gates.cancelAll("server stopped");
      if (mission.expiryTimer) clearTimeout(mission.expiryTimer);
    }
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
      proxy.close(),
    ]);
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
}

function setStatus(mission: LiveMission, status: MissionStatus, detail?: string): void {
  if (mission.status === "cancelled" && status !== "cancelled") return;
  mission.status = status;
  mission.feed.append({ type: "mission.status", status, ...(detail ? { detail } : {}) });
}

function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  mission: LiveMission,
  url: URL,
): void {
  const requested = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
  const cursor = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();

  const replay = mission.feed.since(cursor);
  if (replay.truncated) {
    writeSse(res, replay.cursor, {
      type: "mission.status",
      status: "failed",
      detail: "event history was truncated; reload the mission snapshot",
    });
  }
  for (const entry of replay.events) writeSse(res, entry.sequence, entry.event);
  const unsubscribe = mission.feed.subscribe((entry) => writeSse(res, entry.sequence, entry.event));
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSse(res: ServerResponse, id: number, event: CityFeedEvent): void {
  res.write(`id: ${id}\nevent: mission\ndata: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
