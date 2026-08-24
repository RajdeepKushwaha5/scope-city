import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMissionMcpServer, missionFromPath } from "./server.js";
import type { MissionRegistry } from "./mission.js";

/**
 * Serves the scope proxy over HTTP so TrueForge can connect to it.
 *
 * The route carries the mission id: /mission/{id}/mcp. That is what makes
 * isolation structural rather than a check -- there is no endpoint that serves
 * "the current mission", so two missions cannot be confused by a bug in session
 * handling. An unknown id is a 404, which is also what a forgotten mission
 * looks like, and the two should be indistinguishable.
 *
 * A fresh server and transport are built for every request. That is the
 * documented stateless pattern, and holding one transport open across requests
 * does not work: initialize succeeds and every later call returns 500, because
 * a stateless transport does not expect to be reused.
 *
 * It also happens to be the right shape here. All the state that matters --
 * the scope, the quota ledger, the pending countersigns -- lives on the
 * Mission, which outlives any request. The transport is genuinely disposable.
 */

export interface ProxyHttpOptions {
  readonly registry: MissionRegistry;
  readonly port: number;
  readonly host?: string;
  /**
   * Bearer token every MCP request must carry.
   *
   * The mission id in the path is a capability, but the proxy usually binds to
   * 0.0.0.0 so the harness can reach it from another network namespace -- which
   * means everything else on that network can reach it too. A URL that ends up
   * in a log should not be enough to spend a refund budget.
   *
   * Optional so a purely local run can skip it, but the demo sets one and
   * registers it with the harness as a header.
   */
  readonly token?: string;
  /** Somewhere to report faults. Defaults to stderr. */
  readonly onError?: (error: unknown, context: string) => void;
}

export interface ProxyHttp {
  readonly server: Server;
  readonly url: (missionId: string) => string;
  close: () => Promise<void>;
}

export async function startProxyHttp(options: ProxyHttpOptions): Promise<ProxyHttp> {
  const host = options.host ?? "127.0.0.1";
  const report =
    options.onError ??
    ((error: unknown, context: string) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`[scope-proxy] ${context}\n${detail}`);
    });

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // A transport fault must not be silent. The harness reports a failed
      // connection as "Error POSTing to endpoint" with no body, so if this end
      // does not say what went wrong, nothing does.
      report(error, `${req.method ?? "?"} ${req.url ?? "?"}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "proxy fault" }));
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, missions: options.registry.size }));
      return;
    }

    // Authenticate before resolving the mission, so a wrong token cannot be
    // used to probe which mission ids exist.
    if (options.token && !hasToken(req, options.token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorised" }));
      return;
    }

    const mission = missionFromPath(options.registry, url.pathname);
    if (!mission) {
      // Deliberately the same answer for "never existed" and "expired".
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no such mission" }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      // Stateless: the mission id in the path is already the session, and a
      // second identifier would only be somewhere for the two to disagree.
      sessionIdGenerator: undefined,
    });

    const mcp = createMissionMcpServer(mission);

    // Tie their lifetimes to the response. Without this every request leaks a
    // server and a transport, which a long-lived demo would notice.
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });

    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));

  return {
    server,
    url: (missionId: string) => `http://${host}:${options.port}/mission/${missionId}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Whether a request carries the expected bearer token.
 *
 * Compared with a length-check first and then a constant-time comparison, so a
 * caller cannot learn the token a byte at a time from response timings. That is
 * paranoid for a demo and correct anywhere else, and the cost is nothing.
 */
function hasToken(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;

  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (presented.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}
