import { resolverSafeFields, type OfficeRegistry, type OfficeSpec } from "@scope-city/scope";
import type { IntentEnvelope, Resolution } from "./envelope.js";

/**
 * Stage 2 of sealing: turning what the operator said into what the agent needs.
 *
 * "Refund order #184" has to become a concrete charge id and a concrete
 * recipient, and no amount of language processing can produce those from the
 * sentence -- they only exist in the systems. So something must be read before
 * the scope is granted, and the honest version of the security claim has to
 * survive that fact rather than pretend it away.
 *
 * What makes it survivable is *what* gets read. The resolver:
 *
 *   - calls only non-mutating offices, so a resolution cannot change the world;
 *   - reads only fields the office spec does not mark as free text, so an
 *     attacker's prose never reaches this stage at all;
 *   - keeps only values that look like the resource class being resolved,
 *     so a compromised system cannot smuggle an instruction through a field
 *     that is structured on paper.
 *
 * The invariant that comes out the other side, and the one worth saying on
 * camera: **no untrusted text is read before the scope is granted.** The
 * resolver sees `order_id` and `customer_email`. It never sees `body`.
 */

/** One lookup the resolver may perform: an office, and what it yields. */
export interface ResolverStep {
  readonly office: string;
  /** Resource class this step needs before it can run. */
  readonly needs: string;
  /** Response field -> resource class the value belongs to. */
  readonly yields: Readonly<Record<string, string>>;
}

/**
 * How a resolution proceeds.
 *
 * Declared as data rather than written as a chain of calls because it is a
 * policy statement -- "these lookups are permissible before a grant" -- and it
 * belongs somewhere a reviewer can read it in one screen.
 */
export const DEFAULT_RESOLVER_STEPS: readonly ResolverStep[] = [
  {
    office: "charge.find_by_order",
    needs: "order_ids",
    yields: { id: "charge_ids" },
  },
  {
    office: "ticket.get",
    needs: "ticket_ids",
    yields: { order_id: "order_ids", customer_email: "mail_to" },
  },
  {
    // The chain that makes "refund order #184 and notify its owner" work
    // without a ticket: order -> charge -> the address on that charge.
    //
    // `customer.email` is safe to read here and `customer.address` is not,
    // which is the free-text classification doing exactly the job it exists
    // for -- one field of the same object is a structured identifier and the
    // other is prose someone typed.
    office: "charge.get",
    needs: "charge_ids",
    yields: { "customer.email": "mail_to" },
  },
];

export interface ResolverIO {
  /**
   * Performs one lookup. The caller supplies this so the resolver stays pure
   * with respect to transport, and so tests can drive it with a table.
   *
   * Whatever this returns is filtered before use; an implementation that hands
   * back an entire ticket body cannot leak it into the envelope.
   */
  call(office: string, args: Record<string, string>): Promise<Record<string, unknown>>;
}

/** The single argument name an office takes for a given resource class. */
function argNameFor(spec: OfficeSpec, resourceClass: string): string | null {
  for (const [name, binding] of Object.entries(spec.args)) {
    if (binding.kind === "resource" && binding.resourceClass === resourceClass) return name;
  }
  return null;
}

/**
 * Whether a resolved value is plausibly an identifier rather than prose.
 *
 * The last line of defence, and it exists because "this field is structured" is
 * a claim about a system we do not control. A compromised or simply sloppy
 * upstream that returns a sentence in `order_id` gets that value dropped rather
 * than carried into the scope. Email addresses are permitted their `@`; nothing
 * is permitted whitespace.
 */
export function looksLikeIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  if (/\s/.test(value)) return false;
  return /^[A-Za-z0-9_.@+-]+$/.test(value);
}

/**
 * Reads a dotted field path out of a nested response.
 *
 * Office specs name response fields as paths (`customer.email`) while the
 * systems return them nested (`{ customer: { email } }`), the same convention
 * the projector walks. Reading `response["customer.email"]` finds nothing and
 * fails silently -- the resolver simply reports the class unresolved and the
 * office is pruned, so the symptom is a scope quietly missing an office rather
 * than an error anyone would look at.
 */
function readPath(response: Record<string, unknown>, path: string): unknown {
  let node: unknown = response;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Values from a response, restricted to fields the resolver may read. */
function readSafely(
  spec: OfficeSpec,
  response: Record<string, unknown>,
  yields: Readonly<Record<string, string>>,
): Record<string, string[]> {
  const safe = new Set(resolverSafeFields(spec));
  const found: Record<string, string[]> = {};

  for (const [field, cls] of Object.entries(yields)) {
    // A yield naming a free-text field is a bug in the step table, and it fails
    // closed here rather than being trusted because someone wrote it down.
    if (!safe.has(field)) continue;

    const raw = readPath(response, field);
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is string => typeof v === "string",
    );
    const kept = values.filter(looksLikeIdentifier);
    if (kept.length > 0) found[cls] = [...new Set([...(found[cls] ?? []), ...kept])];
  }

  return found;
}

/**
 * Resolves everything the envelope left pending.
 *
 * Runs steps repeatedly until nothing new appears, so a chain (`ticket ->
 * order -> charge`) completes without the order of the step table mattering.
 * The loop is bounded by the number of steps: each pass must discover a new
 * resource class or it stops, so a cycle in the table cannot spin.
 */
export async function resolve(params: {
  readonly envelope: IntentEnvelope;
  readonly registry: OfficeRegistry;
  readonly io: ResolverIO;
  readonly steps?: readonly ResolverStep[];
}): Promise<Resolution> {
  const steps = params.steps ?? DEFAULT_RESOLVER_STEPS;
  const known: Record<string, string[]> = {};
  for (const [cls, ids] of Object.entries(params.envelope.named)) known[cls] = [...ids];

  // Steps are merged by the call they imply, not left one-to-one.
  //
  // Two steps can describe the same lookup and want different things from it --
  // `ticket.get` yields an order id for one purpose and a recipient for
  // another. Treating them separately means either calling the office twice, or
  // (worse, and the bug this replaced) deduplicating the second call away and
  // silently losing everything it was going to read. Merging the yields first
  // gives exactly one call per distinct lookup with nothing dropped.
  const merged = new Map<string, { office: string; needs: string; yields: Record<string, string> }>();
  for (const step of steps) {
    const key = `${step.office}:${step.needs}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { office: step.office, needs: step.needs, yields: { ...step.yields } });
      continue;
    }

    // Two steps mapping the same response field to different resource classes
    // is a contradiction in the step table, not something to resolve by
    // whichever was declared last. Keeping the first and ignoring the second
    // would make the table order-dependent in a way nobody reading it would
    // expect, so the conflict is refused outright.
    for (const [field, cls] of Object.entries(step.yields)) {
      const already = existing.yields[field];
      if (already !== undefined && already !== cls) {
        throw new Error(
          `resolver step table conflict: ${step.office}.${field} is mapped to ` +
            `both ${already} and ${cls}`,
        );
      }
      existing.yields[field] = cls;
    }
  }
  const plan = [...merged.values()];

  const trace: { office: string; found: Record<string, string[]> }[] = [];
  const done = new Set<string>();

  for (let pass = 0; pass < plan.length + 1; pass += 1) {
    let progressed = false;

    for (const step of plan) {
      const spec = params.registry.get(step.office);
      if (!spec) continue;

      // Never a mutating office. A pre-grant lookup that changes something has
      // performed an unauthorised action to decide what to authorise.
      if (spec.mutating) continue;

      const inputs = known[step.needs] ?? [];
      const argName = argNameFor(spec, step.needs);
      if (inputs.length === 0 || argName === null) continue;

      for (const input of inputs) {
        const key = `${step.office}:${step.needs}:${input}`;
        if (done.has(key)) continue;
        done.add(key);

        const response = await params.io.call(step.office, { [argName]: input });
        const found = readSafely(spec, response, step.yields);
        if (Object.keys(found).length === 0) continue;

        trace.push({ office: step.office, found });
        for (const [cls, values] of Object.entries(found)) {
          const before = new Set(known[cls] ?? []);
          const after = new Set([...before, ...values]);
          if (after.size > before.size) progressed = true;
          known[cls] = [...after].sort();
        }
      }
    }

    if (!progressed) break;
  }

  return { resolved: known, trace };
}
