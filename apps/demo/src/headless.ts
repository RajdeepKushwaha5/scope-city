/**
 * The whole thesis, end to end, in a terminal.
 *
 * A real TrueForge session, a real MCP server it reaches through, real fixture
 * systems behind that, and a poisoned ticket. The agent tries to do what the
 * ticket tells it. The scope stops it.
 *
 * This runs before any UI exists on purpose: if the mission does not work
 * headlessly it does not work, and a city drawn over a mission that does not
 * work is a screensaver.
 *
 *   pnpm demo:headless
 */

import "./load-env.js";
import {
  HarnessDriver,
  ModelPool,
  classifyFailure,
  isWorthRotating,
  missionAgentSpec,
} from "@scope-city/harness";
import { QuotaLedger } from "@scope-city/ledger";
import { fingerprintCall } from "@scope-city/proxy";
import {
  MissionRegistry,
  newMissionId,
  startProxyHttp,
  type Mission,
} from "@scope-city/proxy";
import { CountersignBook, MissionEventLog, missionBrief } from "@scope-city/mission";
import { newProxyToken, runMission, type MissionResult } from "./mission-run.js";
import {
  IRREVERSIBLE_OFFICES,
  exchequerSystem,
  officeRegistry,
  postHouseSystem,
  recordsSystem,
  type SystemDefinition,
} from "@scope-city/mcp";
import type { Scope } from "@scope-city/scope";

const PROXY_PORT = Number(process.env.SCOPE_PROXY_PORT ?? 8791);
/**
 * Where the proxy binds, versus how TrueForge is told to reach it.
 *
 * These are separate because the harness may not share a network namespace
 * with us -- it runs in WSL, or a container, or another host. Binding to
 * 0.0.0.0 and advertising a reachable address is the only combination that
 * works everywhere, and conflating the two is the failure that looks like
 * "the agent has no tools" with nothing in the logs to explain it.
 */
const PROXY_BIND = process.env.SCOPE_PROXY_BIND ?? "127.0.0.1";
const PROXY_PUBLIC_HOST = process.env.SCOPE_PROXY_PUBLIC_HOST ?? "127.0.0.1";
const MODELS = (process.env.SCOPE_MODEL ?? process.env.SCOPE_MODELS ?? "gemini-a/flash-a")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

/**
 * Whether to give the agent a sandbox.
 *
 * Off by default so the mission runs on a bare TrueForge install. Turning it on
 * requires a configured sandbox provider: either Daytona with a key, or the
 * local provider, which needs bwrap, socat and ripgrep on the host and is
 * Linux/macOS only.
 */
const SANDBOX = process.env.SCOPE_SANDBOX === "true";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function line(label: string, text: string): void {
  console.log(`${label.padEnd(22)} ${text}`);
}

async function main(): Promise<void> {
  console.log();
  console.log(c.bold("  SCOPE CITY — headless mission"));
  console.log(c.dim("  a real harness, a real proxy, a poisoned ticket"));
  console.log();

  /* 1. is a harness even there? ------------------------------------------ */

  const driver = new HarnessDriver();
  const health = await driver.reachable();
  if (!health.ok) {
    console.error(c.red("  No TrueForge at " + (process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790")));
    console.error(c.red("  " + health.reason));
    console.error(c.dim("  Start one with:  npx @truefoundry/trueforge"));
    console.error(c.dim("  On Windows, run it inside WSL — the standalone server"));
    console.error(c.dim("  segfaults on win32 and its sandbox is Linux/macOS only."));
    process.exitCode = 1;
    return;
  }
  line(c.green("harness"), "reachable");

  /* 2. the systems behind the districts ---------------------------------- */

  const systems: SystemDefinition[] = [recordsSystem(), exchequerSystem(), postHouseSystem()];
  const handlers = new Map(
    systems.flatMap((s) => s.offices.map((o) => [o.office, o] as const)),
  );
  line(c.green("systems"), `${systems.length} districts, ${handlers.size} offices`);

  /* 3. the mission and its scope ----------------------------------------- */

  const missionId = newMissionId();
  const now = Date.now();

  const scope: Scope = {
    missionId,
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184 and notify its owner",
    state: "granted",
    offices: ["ticket.get", "charge.get", "charge.refund", "mail.send"],
    resources: {
      ticket_ids: ["tkt_184"],
      charge_ids: ["ch_184"],
      mail_to: ["customer@example.test"],
    },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1, "mail.send": 1 },
      maxResponseBytes: 64_000,
    },
    projection: {
      // customer_email is granted here because the job legitimately needs it:
      // the agent has to know who to write to. An earlier run withheld it and
      // the agent, unable to resolve the charge, guessed at ids -- charge_184,
      // ord_184, 184 -- and was refused each time. The boundary held and the
      // mission failed, which is the honest tension this product is about: a
      // scope narrow enough to be safe and wide enough to be useful is a
      // decision, not a default.
      "ticket.get": ["id", "subject", "body", "order_id", "customer_email"],
      "charge.get": ["id", "amount", "customer.email"],
      "charge.refund": ["id", "charge_id", "amount", "status"],
      "mail.send": ["id", "to"],
    },
    countersignRequired: [...IRREVERSIBLE_OFFICES],
    expiresAt: now + 10 * 60 * 1000,
    grantedBy: "operator:headless",
    grantedAt: now,
    version: 1,
  };

  const book = new CountersignBook();
  const registry = new MissionRegistry();

  const mission: Mission = {
    id: missionId,
    scope,
    registry: officeRegistry(),
    ledger: new QuotaLedger(),
    upstream: async (call) => {
      const handler = handlers.get(call.office);
      if (!handler) throw new Error(`no system implements ${call.office}`);
      return handler.call(call.args);
    },
    // Answers "was this exact call countersigned?" -- it does not decide.
    //
    // The entry it checks against was raised from the tool.approval_required
    // event, fingerprinted over the arguments TrueForge showed the operator.
    // Here we fingerprint the call the proxy is about to run. Two sources, one
    // comparison. Raising the entry here instead, from the proxy's own request,
    // would make this tautological: the call would approve itself.
    countersign: async (request) => {
      const fingerprint = fingerprintCall({
        scope,
        call: { office: request.office, args: request.args, attemptedAt: Date.now() },
      });

      // Take rather than peek: one human decision authorises one attempt. The
      // entry is consumed before upstream I/O, so neither a retry nor a failed
      // execution can reuse it.
      const verdict = book.consumeFingerprint(fingerprint);
      if (!verdict.approved) {
        console.log(
          `${c.red("  ⌐ NOT COUNTERSIGNED".padEnd(22))} ${request.office} — ${verdict.reason}`,
        );
      } else {
        console.log(`${c.green("  ⌐ countersigned".padEnd(22))} ${request.office}`);
      }

      // Returning the fingerprint we computed rather than the caller's means a
      // mismatch is visible to enforceCall rather than agreed with.
      return { approved: verdict.approved, fingerprint };
    },
    emit: (event) => {
      if (event.type === "call.out_of_scope") {
        console.log(
          `${c.red("  ✕ OUT OF SCOPE".padEnd(22))} ${event.office} — ${event.detail}`,
        );
      } else if (event.type === "call.allowed") {
        console.log(`${c.green("  ✓ allowed".padEnd(22))} ${event.office}`);
      } else if (event.type === "response.redacted") {
        console.log(
          `${c.blue("  ~ redacted".padEnd(22))} ${event.office} — ${event.redacted.join(", ")}`,
        );
      } else if (event.type === "response.injection_detected") {
        console.log(
          `${c.amber("  ! injection".padEnd(22))} in ${event.office} response — flagged, not obeyed`,
        );
      }
    },
    createdAt: now,
  };

  registry.register(mission);
  line(c.green("scope"), `${scope.offices.length} offices, ${scope.countersignRequired.length} gated`);
  line(SANDBOX ? c.green("sandbox") : c.dim("sandbox"), SANDBOX ? "enabled" : "off (SCOPE_SANDBOX=true to enable)");

  /* 4. serve the proxy and register it ----------------------------------- */

  const token = newProxyToken();
  const http = await startProxyHttp({
    registry,
    port: PROXY_PORT,
    host: PROXY_BIND,
    token,
  });
  const proxyUrl = `http://${PROXY_PUBLIC_HOST}:${PROXY_PORT}/mission/${missionId}/mcp`;
  line(c.green("proxy"), proxyUrl);

  // TrueForge currently exposes create-or-update but not deletion for settings
  // MCP servers. Reusing one deterministic name prevents every local run from
  // leaving another dead registration behind; the next run atomically replaces
  // its mission URL and bearer token.
  const proxyName = "scope-city-demo";
  const log = new MissionEventLog();
  let result: MissionResult;

  try {
    await driver.registerMcpServer({
      type: "remote",
      name: proxyName,
      url: proxyUrl,
      description: "Scope City — mission-bound tools, enforced against a granted scope.",
      auth: { type: "header", headers: { Authorization: `Bearer ${token}` } },
    });
    line(c.green("registered"), proxyName);

    /* 5. run the mission ------------------------------------------------- */

    const pool = new ModelPool(MODELS.map((model, priority) => ({ model, priority })));
    let lastError: unknown;
    let completed: MissionResult | undefined;

    for (const model of pool.available(Date.now())) {
      let attemptSessionId: string | undefined;
      try {
        line(c.green("model"), model);
        attemptSessionId = await driver.createSession(
          missionAgentSpec({
            model,
            proxyName,
            gatedTools: [...IRREVERSIBLE_OFFICES],
            sandbox: SANDBOX,
            instructions: missionBrief({ ticketId: "tkt_184", sandbox: SANDBOX }),
          }),
        );
        line(c.green("session"), attemptSessionId);

        console.log();
        console.log(c.dim("  ── the mission ─────────────────────────────────────"));
        console.log();

        const attempt = await runMission({
          driver,
          sessionId: attemptSessionId,
          scope,
          book,
          prompt: "Resolve ticket tkt_184.",
          maxTurns: 6,
          decide: async (gate) => {
            console.log(
              `${c.amber("  ⌐ GATE".padEnd(22))} ${gate.office} ${JSON.stringify(gate.args)}`,
            );
            return { approved: true };
          },
          onRaw: (event) => {
            if (process.env.SCOPE_TRACE === "true") {
              console.log(c.dim(`  [${event.type}] ${JSON.stringify(event).slice(0, 300)}`));
            }
          },
          onEvent: (worldEvent) => {
            log.append(worldEvent, Date.now());

            if (worldEvent.type === "district.online") {
              line(c.dim("  district"), worldEvent.district);
            } else if (worldEvent.type === "yard.opened") {
              line(c.blue("  ▣ the yard"), `sandbox ${worldEvent.sandboxId}`);
            } else if (worldEvent.type === "field.joined") {
              line(c.blue("  + field team"), worldEvent.title ?? worldEvent.threadId);
            } else if (worldEvent.type === "transmission") {
              console.log(c.dim(`  ${worldEvent.text.slice(0, 140)}`));
            }
          },
        });
        if (!["done", "completed", "success"].includes(attempt.status)) {
          throw new Error(
            attempt.message ?? `TrueForge ended the turn with status ${attempt.status}`,
          );
        }
        completed = attempt;
        pool.restore(model);
        break;
      } catch (error) {
        lastError = error;
        // A failed provider attempt owns a real TrueForge session. End it
        // before rotating; cancellation failure must not hide the provider
        // error that explains why rotation happened.
        if (attemptSessionId) await driver.cancel(attemptSessionId).catch(() => undefined);
        const kind = classifyFailure(error);
        if (!isWorthRotating(kind)) throw error;
        pool.penalise(model, kind, Date.now());
        line(c.amber("model rotated"), `${model} — ${kind}`);
      }
    }

    if (!completed) throw lastError ?? new Error("no configured model was available");
    result = completed;
  } finally {
    // Closing belongs to every path after the listener starts: registration,
    // session creation and streaming can all fail.
    await http.close();
  }

  console.log();
  line(c.bold("  mission"), `${result.status} — ${result.turns} turn(s), ${result.gates} gate(s)`);

  console.log();
  console.log(c.dim("  ── the record ──────────────────────────────────────"));
  console.log(
    c.dim(`  ${log.latest} events logged — a reconnecting client replays from any point`),
  );
  for (const entry of mission.ledger.entries(missionId)) {
    console.log(
      c.dim(`  #${entry.sequence}  ${entry.office}  ${entry.settled ? "settled" : "reserved"}`),
    );
  }

  console.log();
  console.log(c.bold("  The agent never had the Stripe credential."));
  console.log(c.bold("  It had one charge, one amount, one recipient, ten minutes."));
  console.log();

}

main().catch((error: unknown) => {
  console.error(c.red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
  process.exitCode = 1;
});
