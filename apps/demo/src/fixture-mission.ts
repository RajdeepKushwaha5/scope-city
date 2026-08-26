import { QuotaLedger } from "@scope-city/ledger";
import {
  IRREVERSIBLE_OFFICES,
  exchequerSystem,
  officeRegistry,
  postHouseSystem,
  recordsSystem,
  type SystemDefinition,
} from "@scope-city/mcp";
import { missionSystems } from "./systems.js";
import { fingerprintCall, type Mission } from "@scope-city/proxy";
import type { CountersignBook } from "@scope-city/mission";
import type { EmitProxyEvent } from "@scope-city/proxy";
import type { Scope } from "@scope-city/scope";

export interface FixtureMission {
  readonly mission: Mission;
  readonly scope: Scope;
  readonly systems: readonly SystemDefinition[];
}

/**
 * The deterministic poisoned-ticket world used by local and CI demos.
 * Integrations are injected behind Mission.upstream, so replacing these with
 * Stripe test mode and Mailpit does not touch policy, proxy, or UI code.
 */
export function createFixtureMission(params: {
  missionId: string;
  book: CountersignBook;
  emit: EmitProxyEvent;
  now?: number;
  /**
   * A scope derived from the operator's own sentence.
   *
   * When absent this falls back to the hand-written SC-184 below, which is what
   * the offline replays and the CI headless run need: a world that is identical
   * every time. A live mission always passes one, because a scope that ignores
   * what the operator typed is the thing the derivation pipeline exists to stop.
   */
  scope?: Scope;
}): FixtureMission {
  const now = params.now ?? Date.now();
  const systems = missionSystems();
  const handlers = new Map(
    systems.flatMap((system) => system.offices.map((office) => [office.office, office] as const)),
  );

  const scope: Scope = params.scope ?? {
    missionId: params.missionId,
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184 and notify its owner",
    state: "granted",
    offices: ["ticket.get", "charge.find_by_order", "charge.get", "charge.refund", "mail.send"],
    resources: {
      ticket_ids: ["tkt_184"],
      order_ids: ["ord_184"],
      charge_ids: ["ch_184"],
      mail_to: ["customer@example.test"],
    },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1, "mail.send": 1 },
      maxResponseBytes: 64_000,
    },
    projection: {
      "ticket.get": ["id", "subject", "body", "order_id", "customer_email"],
      "charge.find_by_order": ["id", "amount", "order_id"],
      "charge.get": ["id", "amount", "refunded", "customer.email"],
      "charge.refund": ["id", "charge_id", "amount", "status"],
      "mail.send": ["id", "to"],
    },
    countersignRequired: [...IRREVERSIBLE_OFFICES],
    expiresAt: now + 10 * 60 * 1000,
    grantedBy: "operator:scope-city",
    grantedAt: now,
    version: 1,
  };

  const mission: Mission = {
    id: params.missionId,
    scope,
    registry: officeRegistry(),
    ledger: new QuotaLedger(),
    upstream: async (call, context) => {
      const handler = handlers.get(call.office);
      if (!handler) throw new Error(`no system implements ${call.office}`);
      // The proxy's key is passed through untouched. It is the only identifier
      // that distinguishes a retry from a second, legitimate, identical action.
      return handler.call(call.args, context);
    },
    countersign: async (request) => {
      const fingerprint = fingerprintCall({
        scope,
        call: { office: request.office, args: request.args, attemptedAt: Date.now() },
      });
      const verdict = params.book.consumeFingerprint(fingerprint);
      return { approved: verdict.approved, fingerprint };
    },
    emit: params.emit,
    createdAt: now,
  };

  return { mission, scope, systems };
}
