import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { enforceCall, visibleOffices } from "./enforce.js";
import type { Mission, MissionRegistry } from "./mission.js";

/**
 * The MCP face of the proxy. TrueForge connects here and nowhere else, so this
 * is the only surface the agent can reach -- Stripe, the mail server and the
 * ticket system are behind it and hold their own credentials.
 *
 * One MCP server instance per mission. That is what keeps two concurrent
 * missions from ever seeing each other's tools: the tool list is not filtered
 * per request, it is built from the mission's own scope.
 */
export function createMissionMcpServer(mission: Mission): Server {
  const server = new Server(
    { name: "scope-city", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Offices outside the scope are absent, not disabled. A model cannot be
    // talked into calling a tool it was never told exists.
    const offices = visibleOffices(mission.scope, mission.registry);

    return {
      tools: offices.map((office) => {
        const spec = mission.registry.get(office);
        return {
          name: office,
          description: describe(mission, office),
          inputSchema: inputSchemaFor(spec?.args ?? {}),
        };
      }),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const office = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const now = Date.now();

    const result = await enforceCall({
      scope: mission.scope,
      call: { office, args, attemptedAt: now },
      registry: mission.registry,
      ledger: mission.ledger,
      upstream: mission.upstream,
      countersign: mission.countersign,
      emit: mission.emit,
      // A nonce identifies this physical submission; the idempotency key
      // identifies the logical operation, so a retry of the same refund is
      // recognised rather than performed twice.
      nonce: randomUUID(),
      idempotencyKey: idempotencyKeyFor(office, args),
      now,
    });

    if (result.outcome === "refused") {
      // Refusals come back as a tool error rather than a transport error: the
      // agent should see "you cannot do that" and carry on, not crash.
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Refused: ${result.reason}. ${result.detail}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.value) }],
    };
  });

  return server;
}

function describe(mission: Mission, office: string): string {
  const spec = mission.registry.get(office);
  const parts = [`${office} in ${spec?.district ?? "an unknown district"}.`];

  if (mission.scope.countersignRequired.includes(office)) {
    parts.push("Irreversible: a human must countersign before it runs.");
  }

  const ceiling = mission.scope.limits.maxCalls[office];
  if (ceiling !== undefined) {
    const used = mission.ledger.consumed(mission.id)[office] ?? 0;
    parts.push(`Budget: ${used}/${ceiling} used.`);
  }

  return parts.join(" ");
}

/** Builds a JSON Schema from the office spec so the model knows what to send. */
/**
 * The arguments an office takes, said in the schema the model reads.
 *
 * `additionalProperties: false` because the evaluator refuses a call carrying
 * anything the office does not declare. Without it the boundary would enforce a
 * rule the tool description never stated, and an agent would meet a refusal it
 * had no way to anticipate -- which is the kind of surprise that turns into a
 * retry loop rather than a correction.
 *
 * Telling the model is not the enforcement. The enforcement is in `evaluate`,
 * and it holds whether or not anything read this.
 */
function inputSchemaFor(
  args: Record<string, { kind: string; required?: boolean }>,
): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, binding] of Object.entries(args)) {
    properties[name] =
      binding.kind === "amount_minor"
        ? { type: "integer", description: "Amount in minor units, e.g. cents." }
        : { type: "string" };
    if (binding.required !== false) required.push(name);
  }

  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * Two identical calls are the same logical operation. Deriving the key from the
 * call rather than generating one means a model that retries a refund verbatim
 * gets the original result instead of a second refund.
 *
 * The canonicalisation has to reach all the way down. Sorting only the top
 * level would give `{a: {x: 1, y: 2}}` and `{a: {y: 2, x: 1}}` different keys,
 * so the same refund submitted with its nested fields in a different order
 * would look like a new operation and be performed twice.
 */
function idempotencyKeyFor(office: string, args: Record<string, unknown>): string {
  return `${office}:${JSON.stringify(canonicalise(args))}`;
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return Object.fromEntries(entries.map(([k, v]) => [k, canonicalise(v)]));
}

/** Looks a mission up by the id embedded in the proxy URL path. */
export function missionFromPath(
  registry: MissionRegistry,
  pathname: string,
): Mission | undefined {
  const match = /\/mission\/(m_[0-9a-f]{48})(?:\/|$)/.exec(pathname);
  if (!match?.[1]) return undefined;
  return registry.get(match[1]);
}
