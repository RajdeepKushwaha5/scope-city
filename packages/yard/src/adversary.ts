import { evaluate, type OfficeRegistry, type Scope } from "@scope-city/scope";
import type { Probe } from "./boundary.js";
import type { AdversaryAttempt, AdversaryReport, Finding } from "./findings.js";

/**
 * The probes a grammar cannot write.
 *
 * `probesFor` perturbs one dimension of the scope at a time -- a neighbouring
 * id, a penny over a ceiling, a moment after expiry -- and that is its strength:
 * it is deterministic, it is exhaustive over the shapes it knows, and a clean
 * report from it is a fact rather than a sample.
 *
 * It is also everything it can ever be. The perturbation grammar has no notion
 * of what the *job* said, and no notion of the ticket text sitting in the
 * mission. An attacker has both. The interesting attempt on a refund scope is
 * not "the charge next door", which the grammar already covers; it is the call
 * suggested by the sentence somebody wrote into the ticket body, aimed at an
 * office the operator granted for an unrelated reason.
 *
 * So a model writes probes too. Three things keep that honest:
 *
 * **The model proposes and the evaluator disposes.** Nothing here trusts the
 * model's opinion about whether an attack works. Every probe it writes is run
 * through the same pure `evaluate` the proxy uses, and a probe is a finding only
 * when the evaluator *allows* it. A model that hallucinates a devastating
 * exploit produces a refusal like any other bad guess.
 *
 * **Nothing is called.** These are evaluations, not requests. The Yard runs
 * before the grant, which is the only moment its answer can still change the
 * decision, and it can only run there because proposing a refund of a
 * neighbouring charge refunds nobody.
 *
 * **What it is given cannot leave the building.** To write the interesting
 * probe, the adversary has to read the attacker-controlled prose -- the ticket
 * body, the issue text -- which is customer data with an injected instruction
 * somewhere in it, on a good day. Sending that to a hosted model to ask "how
 * would you attack this?" would be the project arguing against itself. The
 * adversary is local or it does not run: see `isLocalEndpoint`.
 */

/** What the adversary is shown. Everything here is already inside the mission. */
export interface AdversaryRequest {
  /** The operator's sentence. What the scope is supposed to be *for*. */
  readonly job: string;
  /** The offices it may name, with the arguments each one takes. */
  readonly offices: readonly {
    readonly office: string;
    readonly args: readonly string[];
    readonly description?: string;
  }[];
  /** The resource ids the scope grants, by class. */
  readonly resources: Readonly<Record<string, readonly string[]>>;
  /**
   * Attacker-controlled prose already in play: ticket bodies, issue text.
   *
   * The reason this whole step is local. It is the only input that makes the
   * adversary better than the grammar, and the only one that must not leave.
   */
  readonly evidence: readonly string[];
}

/** One attack the adversary proposes. Unvalidated: it came from a model. */
export interface ProposedProbe {
  readonly office: string;
  readonly args: Record<string, unknown>;
  readonly why: string;
}

export interface AdversaryResult {
  /** For the report, so an operator knows what wrote these. */
  readonly model: string;
  readonly probes: readonly ProposedProbe[];
}

/**
 * A local model, or nothing.
 *
 * Injected rather than constructed here so this package stays pure and
 * testable: the Yard has never made a network call and does not start now.
 */
export type Adversary = (request: AdversaryRequest) => Promise<AdversaryResult>;

/**
 * A hard ceiling on how much a model can ask the Yard to do.
 *
 * The adversary is a model, and a model can return a thousand probes as easily
 * as ten -- through a loop that runs before a human has granted anything, on a
 * request an operator is waiting on. The grammar's probe count is bounded by
 * the scope; this one has to be bounded on purpose.
 */
export const MAX_ADVERSARY_PROBES = 24;

/** Arguments are values, not structures. A nested object is not a call. */
function isFlatValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

/**
 * The probes that are actually callable, from whatever the model returned.
 *
 * Fails closed on every axis. An office the registry does not have is dropped
 * rather than probed, because "the model named `admin.sudo` and the evaluator
 * refused it" is not evidence about anything -- the office does not exist, so
 * the refusal is free and the finding it would produce is noise. Arguments the
 * office does not declare go the same way: the evaluator refuses undeclared
 * arguments, so keeping them would manufacture clean results out of malformed
 * ones.
 *
 * This is the boundary between model output and the rest of the system, and it
 * is written the way the office adapters are: named things pass, everything
 * else does not.
 */
export function admissibleProbes(
  proposed: readonly ProposedProbe[],
  registry: OfficeRegistry,
  now: number,
): readonly Probe[] {
  const probes: Probe[] = [];

  for (const raw of proposed.slice(0, MAX_ADVERSARY_PROBES)) {
    if (typeof raw?.office !== "string") continue;
    const spec = registry.get(raw.office);
    if (!spec) continue;
    if (
      typeof raw.args !== "object" ||
      raw.args === null ||
      Array.isArray(raw.args)
    )
      continue;

    const args: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(raw.args)) {
      if (!(name in spec.args)) continue;
      if (!isFlatValue(value)) continue;
      args[name] = value;
    }

    probes.push({
      office: raw.office,
      args,
      // The model's stated reason, trimmed, because it lands in an operator's
      // report and a paragraph there is a paragraph nobody reads.
      why:
        typeof raw.why === "string"
          ? raw.why.trim().slice(0, 160)
          : `${raw.office}`,
      at: now,
    });
  }

  return probes;
}

/**
 * Whether an endpoint is on this machine.
 *
 * The one property that makes the adversarial step defensible rather than
 * reckless: it is handed the ticket body and asked how to attack the customer
 * it belongs to. That prompt is not going over the internet.
 *
 * Written as an allowlist of loopback forms rather than a check for suspicious
 * hosts, for the usual reason -- a denylist is a list of the attacks somebody
 * thought of. `host.docker.internal` is deliberately *not* here: it resolves to
 * the host, which is local in the colloquial sense and not in the sense that
 * matters, because the value is decided by the container's DNS rather than by
 * this code.
 */
export function isLocalEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

/**
 * Runs the adversary's probes and reports the ones the scope failed to refuse.
 *
 * Deliberately shaped like `runBoundaryProbes`, and deliberately reporting the
 * same `boundary_hole` kind: a hole is a hole regardless of what wrote the call
 * that found it, and giving model-written findings their own severity would
 * invite reading them as softer. What differs is `probesRun` and the
 * `AdversaryReport`, so an operator can see how the number was reached.
 *
 * An adversary that throws is not an error. It is a model that was not
 * reachable, and the mechanical probes have already run: the report says the
 * adversary declined and the grant decision proceeds on what is known. A Yard
 * that refuses to produce a report because a model is down is a Yard that
 * teaches operators to skip it.
 */
export async function runAdversary(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
  readonly job: string;
  readonly evidence: readonly string[];
  readonly adversary: Adversary;
  readonly now: number;
}): Promise<{
  readonly findings: readonly Finding[];
  readonly probesRun: number;
  readonly report: AdversaryReport;
}> {
  const { scope, registry, job, evidence, adversary, now } = params;

  const offices = scope.offices.flatMap((office) => {
    const spec = registry.get(office);
    return spec ? [{ office, args: Object.keys(spec.args) }] : [];
  });

  let result: AdversaryResult;
  try {
    result = await adversary({
      job,
      offices,
      resources: scope.resources,
      evidence,
    });
  } catch (error) {
    return {
      findings: [],
      probesRun: 0,
      report: {
        model: "none",
        wrote: 0,
        admitted: 0,
        holes: 0,
        attempts: [],
        declined: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const probes = admissibleProbes(result.probes, registry, now);
  const findings: Finding[] = [];
  const attempts: AdversaryAttempt[] = [];

  for (const probe of probes) {
    const decision = evaluate({
      scope,
      call: { office: probe.office, args: probe.args, attemptedAt: probe.at },
      registry,
      now: probe.at,
      consumed: {},
    });

    attempts.push({
      office: probe.office,
      why: probe.why,
      refused: !decision.allowed,
      ...(decision.allowed ? {} : { reason: decision.reason }),
    });

    if (decision.allowed) {
      findings.push({
        kind: "boundary_hole",
        severity: "critical",
        office: probe.office,
        summary: `The scope permits ${probe.why}`,
        detail: [JSON.stringify(probe.args)],
        remedy: `Narrow ${probe.office} before granting.`,
      });
    }
  }

  return {
    findings,
    probesRun: probes.length,
    report: {
      model: result.model,
      wrote: result.probes.length,
      admitted: probes.length,
      holes: findings.length,
      attempts,
    },
  };
}
