import type { OfficeRegistry, Scope } from "@scope-city/scope";
import type { Finding } from "./findings.js";

/**
 * Composition probes: what two allowed offices reach together.
 *
 * Each office in a scope is checked against the resources that scope grants,
 * one call at a time. That check is sound per call and blind across calls: if
 * office A returns an identifier, and office B accepts that class of
 * identifier, then A and B together reach records the operator never listed --
 * and every individual call was permitted.
 *
 * This is the same chaining the resolver uses on purpose in stage 2. There it
 * runs under the operator's eye before a grant; here we are asking what the
 * *agent* could do with the same links afterwards.
 *
 * The check is a reachability walk over declared shapes, not a set of calls.
 * Nothing is executed -- the registry already says which office yields which
 * resource class, which is all the walk needs.
 */

/**
 * Which resource classes an office can hand back.
 *
 * Derived from field names against the class names the scope already uses, so
 * a new office is covered the moment it declares its response fields. The
 * matching is deliberately loose -- `id`, `charge_id` and `customer.email` all
 * have to land on the right class -- and loose matching here fails toward
 * *reporting* a chain that may not exist, which is the right direction for a
 * warning shown to a human before they grant.
 */
export function classesYieldedBy(
  office: string,
  registry: OfficeRegistry,
  classes: readonly string[],
): readonly string[] {
  const spec = registry.get(office);
  if (!spec) return [];

  const out = new Set<string>();
  for (const field of spec.responseFields) {
    const leaf = field.split(".").pop() ?? field;
    for (const cls of classes) {
      // `charge_ids` -> `charge`; matches `id` on charge.get, `charge_id`
      // elsewhere, and `customer.email` against `mail_to` via its own rule.
      const stem = cls.replace(/_ids$/, "").replace(/s$/, "");
      if (leaf === "id" && office.startsWith(`${stem}.`)) out.add(cls);
      else if (leaf === `${stem}_id`) out.add(cls);
      else if (cls === "mail_to" && /email/i.test(leaf)) out.add(cls);
    }
  }
  return [...out];
}

/** Which resource classes an office consumes as arguments. */
export function classesConsumedBy(office: string, registry: OfficeRegistry): readonly string[] {
  const spec = registry.get(office);
  if (!spec) return [];
  const out = new Set<string>();
  for (const binding of Object.values(spec.args)) {
    if (binding.kind === "resource") out.add(binding.resourceClass);
  }
  return [...out];
}

export function runCompositionProbes(params: {
  readonly scope: Scope;
  readonly registry: OfficeRegistry;
}): { readonly findings: readonly Finding[]; readonly probesRun: number } {
  const { scope, registry } = params;
  const classes = Object.keys(scope.resources);
  const findings: Finding[] = [];
  let probesRun = 0;

  for (const source of scope.offices) {
    const yielded = classesYieldedBy(source, registry, classes);

    for (const sink of scope.offices) {
      if (sink === source) continue;
      probesRun += 1;

      const consumed = classesConsumedBy(sink, registry);
      const shared = yielded.filter((cls) => consumed.includes(cls));
      if (shared.length === 0) continue;

      // A chain is only interesting when the sink changes something. Two
      // lookups feeding each other reach no further than the ids the scope
      // already granted, because the evaluator still checks every one of them
      // against that same list.
      const sinkSpec = registry.get(sink);
      if (!sinkSpec?.mutating) continue;

      findings.push({
        kind: "composition_reach",
        severity: "note",
        office: sink,
        summary:
          `${source} yields ${shared.join(", ")}, which ${sink} accepts — ` +
          `the pair is a path to act on whatever ${source} returns.`,
        detail: shared,
        remedy:
          `Held by the resource list: ${sink} is still checked against the ` +
          `granted ids, so this is a path, not a hole.`,
      });
    }
  }

  return { findings, probesRun };
}
