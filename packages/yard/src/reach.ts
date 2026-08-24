import { resolverSafeFields, type OfficeRegistry, type Scope } from "@scope-city/scope";
import type { Finding, Severity } from "./findings.js";

/**
 * Response-reach analysis: what an *allowed* call hands back.
 *
 * This is the finding worth having. Refusing a call the scope never permitted
 * is table stakes and any allowlist does it. The interesting question is the
 * one nobody asks until the postmortem:
 *
 *   "You approved `charge.get` on ch_184 -- but that response embeds the
 *    customer's entire payment history. The scope leaks more than you granted."
 *
 * A human cannot do this by hand at grant time. It needs the office's declared
 * response surface compared against the scope's projection, per field, for
 * every granted office -- which is mechanical, and therefore exactly the kind
 * of thing to run automatically before a human is asked to approve anything.
 *
 * Entirely static. No call is made: the registry already declares what each
 * office can return, so the leak is visible before the office is ever touched.
 */

/**
 * Fields worth telling an operator about, and how loudly.
 *
 * Severity is per category rather than uniform, because a warning that fires on
 * everything trains the reader to grant through it. An email address on a job
 * that says "notify its owner" is expected and gets a note; a customer's
 * payment history is never expected and gets a warning; a credential in a
 * response is a different kind of event entirely.
 */
const SENSITIVE: readonly {
  readonly match: RegExp;
  readonly why: string;
  readonly severity: Severity;
}[] = [
  { match: /token|secret|key|password/i, why: "a credential", severity: "critical" },
  {
    match: /card|iban|account_number|routing/i,
    why: "payment instrument details",
    severity: "critical",
  },
  { match: /history/i, why: "prior transactions", severity: "warning" },
  { match: /customers?$|customer_list/i, why: "other customers", severity: "warning" },
  { match: /address/i, why: "a postal address", severity: "warning" },
  // Commonly the point of the job. Still surfaced, never as an alarm.
  { match: /email/i, why: "an email address", severity: "note" },
  { match: /phone|mobile|tel/i, why: "a phone number", severity: "note" },
];

function classify(field: string): { why: string; severity: Severity } | null {
  for (const entry of SENSITIVE) {
    if (entry.match.test(field)) return { why: entry.why, severity: entry.severity };
  }
  return null;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, note: 2 };

export function runReachAnalysis(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
}): { readonly findings: readonly Finding[]; readonly probesRun: number } {
  const findings: Finding[] = [];
  let probesRun = 0;

  for (const office of params.scope.offices) {
    const spec = params.registry.get(office);
    if (!spec) continue;

    const allowed = params.scope.projection[office] ?? [];
    probesRun += spec.responseFields.length;

    const exposed = spec.responseFields.filter((field) => allowed.includes(field));
    const blocked = spec.responseFields.filter((field) => !allowed.includes(field));

    // What gets through, grouped so one office produces one finding at the
    // severity of its worst field rather than a wall of near-identical lines.
    const sensitive = exposed
      .map((field) => ({ field, ...(classify(field) ?? { why: "", severity: "note" as Severity }) }))
      .filter((entry) => entry.why !== "");

    if (sensitive.length > 0) {
      const worst = sensitive.reduce((a, b) => (RANK[a.severity] <= RANK[b.severity] ? a : b));
      findings.push({
        kind: "response_over_reach",
        severity: worst.severity,
        office,
        summary: `${office} may return ${[...new Set(sensitive.map((s) => s.why))].join(", ")}.`,
        detail: sensitive.map((s) => s.field),
        remedy: `Drop ${sensitive.map((s) => s.field).join(", ")} from ${office}'s projection if the job does not need it.`,
      });
    }

    // And what does not get through.
    //
    // Reported deliberately, because it is the half of the story that is
    // otherwise invisible: `charge.get` can return a customer's entire payment
    // history, and the only reason this scope does not leak it is that
    // projection is subtracting it on every response. An operator who cannot
    // see that has no way to tell a scope that is safe from one that simply has
    // not been asked for anything interesting yet.
    const blockedSensitive = blocked
      .map((field) => ({ field, entry: classify(field) }))
      .filter((e): e is { field: string; entry: { why: string; severity: Severity } } =>
        e.entry !== null && e.entry.severity !== "note",
      );

    if (blockedSensitive.length > 0) {
      findings.push({
        kind: "response_over_reach",
        severity: "note",
        office,
        summary:
          `${office} can return ${[...new Set(blockedSensitive.map((b) => b.entry.why))].join(", ")}, ` +
          `and projection is stopping it.`,
        detail: blockedSensitive.map((b) => b.field),
        remedy: "No action — this is the response filter doing its job.",
      });
    }

    // A projection wider than the resolver's own safe surface means free text
    // is reaching the agent. That is not a leak of data so much as an inbound
    // channel: prose in a response is where an injected instruction arrives.
    const safe = new Set(resolverSafeFields(spec));
    const prose = exposed.filter((field) => !safe.has(field));
    if (prose.length > 0) {
      findings.push({
        kind: "injection_surface",
        severity: "warning",
        office,
        summary: `${office} can return free text the agent will read.`,
        detail: prose,
        remedy:
          `Keep ${prose.join(", ")} only if the job genuinely needs the prose; ` +
          `it is where an injected instruction arrives.`,
      });
    }
  }

  return { findings, probesRun };
}

/**
 * Grants the job did not ask for.
 *
 * Not a leak, and deliberately only a note -- but a granted office nobody uses
 * is authority held for no reason, and the operator is the only one who can say
 * whether it was intended.
 */
export function runUnusedGrantAnalysis(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
}): readonly Finding[] {
  const findings: Finding[] = [];

  for (const office of params.scope.offices) {
    const spec = params.registry.get(office);
    if (!spec) continue;

    // An office with no resource argument cannot be narrowed by id at all: it
    // is granted wholesale or withheld. Worth saying out loud, because it is
    // the one kind of grant whose blast radius does not shrink with a tighter
    // resource list.
    const narrowable = Object.values(spec.args).some((b) => b.kind === "resource");
    if (!narrowable) {
      findings.push({
        kind: "unused_grant",
        severity: "warning",
        office,
        summary: `${office} takes no record id, so it cannot be narrowed — only granted or withheld.`,
        remedy: `Withhold ${office} unless the job truly needs all of it.`,
      });
    }
  }

  return findings;
}
