import type { Scope } from "./schema.js";
import type { OfficeRegistry } from "./office-spec.js";

/**
 * Filtering which tools may be called is only half the job. An allowed
 * `charge.get` can legitimately return the customer's entire payment history,
 * so a scope that polices requests but not responses leaks exactly the data it
 * claimed to fence off.
 *
 * Projection is a subtraction from the office's declared response fields, and
 * anything not explicitly granted is dropped. A missing projection entry means
 * nothing passes -- adding a tool without thinking about its response is a
 * denial, not a leak.
 */

export interface ProjectionResult {
  readonly value: unknown;
  /** Field paths removed, for the map to render as a plugged leak. */
  readonly redacted: readonly string[];
  /** True when the response was cut short by the byte ceiling. */
  readonly truncated: boolean;
  /** Fields the office can return that this scope never allowed. */
  readonly overReach: readonly string[];
}

export function project(params: {
  scope: Scope;
  office: string;
  registry: OfficeRegistry;
  response: unknown;
}): ProjectionResult {
  const { scope, office, registry, response } = params;

  const allowed = scope.projection[office] ?? [];
  const spec = registry.get(office);
  const declared = spec?.responseFields ?? [];
  const overReach = declared.filter((field) => !allowed.includes(field));

  const redacted: string[] = [];
  const value = prune(response, allowed, "", redacted);

  const encoded = JSON.stringify(value) ?? "";
  const truncated = encoded.length > scope.limits.maxResponseBytes;

  return {
    value: truncated ? { _truncated: true, _bytes: encoded.length } : value,
    redacted,
    truncated,
    overReach,
  };
}

/**
 * Walks the response keeping only allowed paths. Arrays keep their shape so the
 * agent still sees "three charges" rather than a mangled object, but each
 * element is pruned to the same allowlist.
 */
function prune(
  node: unknown,
  allowed: readonly string[],
  path: string,
  redacted: string[],
): unknown {
  if (node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => prune(item, allowed, path, redacted));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;

    // A field passes if it is allowed outright, or is a prefix on the way to an
    // allowed leaf (so `customer.email` keeps `customer` without keeping
    // everything else under it).
    const exact = allowed.includes(childPath);
    const onPath = allowed.some((a) => a.startsWith(`${childPath}.`));

    if (exact) {
      out[key] = value;
    } else if (onPath) {
      out[key] = prune(value, allowed, childPath, redacted);
    } else {
      redacted.push(childPath);
    }
  }
  return out;
}

/**
 * Tool output is data, never instruction -- but a model reading it does not
 * reliably make that distinction. We flag responses that look like they are
 * addressing the agent so the map can mark the district and the operator can
 * see an injection attempt arriving through a legitimate channel.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i,
  /disregard\s+(your|all|the)\s+(instructions|rules|scope)/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*/i,
  /\bnew\s+instructions?\b/i,
  /</i,
  /\bact\s+as\b/i,
];

export function detectInjection(value: unknown): readonly string[] {
  const hits: string[] = [];
  walkStrings(value, (text) => {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        hits.push(text.slice(0, 200));
        return;
      }
    }
  });
  return hits;
}

function walkStrings(node: unknown, visit: (text: string) => void): void {
  if (typeof node === "string") {
    visit(node);
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, visit);
    return;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    walkStrings(value, visit);
  }
}
