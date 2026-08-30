import "./load-env.js";
import { officeRegistry } from "@scope-city/mcp";
import { backtest, runAdversary, withAdversary } from "@scope-city/yard";
import { adversaryStatus, evidenceFor, localAdversary } from "./adversary.js";
import { deriveScopeFromJob } from "./derive-scope.js";
import { missionSystems } from "./systems.js";

/**
 * The Yard with a local adversary in it, end to end, without a browser.
 *
 * Prints both halves so the difference is visible: how many probes the
 * perturbation grammar generated, and how many a local model wrote after
 * reading the job and the ticket. The second number is the point of the
 * feature; the findings are the point of the Yard.
 *
 *   pnpm --filter @scope-city/demo probe:adversary
 *   pnpm --filter @scope-city/demo probe:adversary "Refund order 184"
 */

async function main(): Promise<void> {
  const job =
    process.argv[2] ?? "Refund order 184 and email the customer about it";

  const status = adversaryStatus();
  console.log(
    `  adversary        ${status.live ? status.reason : `off (${status.reason})`}`,
  );

  const systems = missionSystems();
  const offices = officeRegistry();
  const derived = await deriveScopeFromJob({
    job,
    missionId: "probe-adversary-0001",
    systems,
  });
  const proposed = { ...derived.scope, state: "granted" as const };

  console.log(`  scope            ${derived.scope.offices.join(", ")}`);
  console.log(
    `  resources        ${
      Object.entries(derived.scope.resources)
        .map(([k, v]) => `${k}=${v.join("/")}`)
        .join("  ") || "(none)"
    }`,
  );

  const mechanical = backtest({
    scope: proposed,
    registry: offices,
    now: Date.now(),
  });
  console.log(
    `\n  grammar          ${mechanical.probesRun} probes, ${mechanical.findings.length} findings`,
  );

  const evidence = await evidenceFor({
    scope: proposed,
    registry: offices,
    systems,
  });
  console.log(
    `  outside text     ${evidence.length} field(s) the agent will read`,
  );
  for (const text of evidence)
    console.log(`      "${text.replace(/\s+/g, " ").slice(0, 100)}"`);

  const started = Date.now();
  const extra = await runAdversary({
    scope: proposed,
    registry: offices,
    job,
    evidence,
    adversary: localAdversary(),
    now: Date.now(),
  });
  const report = withAdversary(mechanical, extra);
  const took = ((Date.now() - started) / 1000).toFixed(1);

  const a = report.adversary!;
  if (a.declined) {
    console.log(`\n  adversary declined  ${a.declined}`);
  } else {
    console.log(
      `\n  ${a.model}   wrote ${a.wrote}, admitted ${a.admitted}, holes ${a.holes}  (${took}s, local)`,
    );
  }

  console.log(`\n  what it tried`);
  for (const attempt of a.attempts) {
    console.log(
      `      ${attempt.refused ? "REFUSED" : "ALLOWED"}  ${attempt.office.padEnd(22)}` +
        `${(attempt.reason ?? "").padEnd(24)}  ${attempt.why}`,
    );
  }

  console.log(
    `\n  report           ${report.probesRun} probes, ${report.findings.length} findings`,
  );
  for (const finding of report.findings) {
    console.log(
      `      ${finding.severity.padEnd(8)} ${finding.office.padEnd(20)} ${finding.summary}`,
    );
  }
  console.log(
    `\n  ${report.clean ? "CLEAN  nothing above a note" : "NOT CLEAN  narrow before granting"}`,
  );
}

main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
