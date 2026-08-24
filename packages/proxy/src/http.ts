import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMissionMcpServer, missionFromPath } from "./server.js";
import type { MissionRegistry } from "./mission.js";


/**
 * Serves the scope proxy over HTTP so TrueForge can connect to it.
 *
 * The route carries the mission id: /mission/{id}/mcp. That is what makes
 * isolation structural rather than a check -- there is no endpoint that serves
 * "the current mission", so two missions cannot be confused for one another by
 * a bug in session handling. An unknown id is a 404, which is also what a
 * forgotten mission looks like, and the two should be indistinguishable.
 */

export interface ProxyHttpOptions {
  readonly registry: MissionRegistry;
  readonly port: number;
  readonly host?: string;
}

export interface ProxyHttp {
  readonly server: Server;
  readonly url: (missionId: string) => string;
  close: () => Promise<void>;
}

export async function startProxyHttp(options: ProxyHttpOptions): Promise<ProxyHttp> {
  const host = options.host ?? "127.0.0.1";

  // One transport per mission, kept alive across requests: MCP is a session
  // protocol, and tearing the transport down between calls would lose the
  // initialize handshake.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, missions: options.registry.size }));
      return;
    }

    const mission = missionFromPath(options.registry, url.pathname);
    if (!mission) {
      // Deliberately the same answer for "never existed" and "expired".
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no such mission" }));
      return;
    }

    let transport = transports.get(mission.id);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        // Stateless from the transport's point of view: the mission id in the
        // path is already the session, so a second identifier would only add a
        // way for the two to disagree.
        sessionIdGenerator: undefined,
      });
      const mcp = createMissionMcpServer(mission);
      await mcp.connect(transport);
      transports.set(mission.id, transport);
    }

    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));

  return {
    server,
    url: (missionId: string) => `http://${host}:${options.port}/mission/${missionId}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
