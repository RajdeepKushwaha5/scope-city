/**
 * The three demo systems behind Scope City's districts.
 *
 * Each is defined once as a set of offices with a real implementation and a
 * fixture implementation. The fixture is not a lesser mode: it is what makes
 * `SCOPE_FIXTURES=true` run the entire demo with no Stripe key and no accounts,
 * which is what "a stranger could clone, understand, and extend" requires.
 */

export interface OfficeHandler {
  /** Matches the office id the scope evaluator polices, e.g. "charge.refund". */
  readonly office: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments, served through MCP tools/list. */
  readonly inputSchema: Record<string, unknown>;
  readonly call: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SystemDefinition {
  readonly district: string;
  readonly title: string;
  readonly offices: readonly OfficeHandler[];
}

/** Thrown when a call is well-formed but the underlying record does not exist. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * Money is integer minor units everywhere it crosses a boundary, and strictly
 * positive.
 *
 * The positivity check is not redundant with the scope evaluator's. A negative
 * amount runs the downstream arithmetic backwards -- `refundedMinor += -1000`
 * restores refundable headroom -- so a system that trusts its caller here is
 * one scope misconfiguration away from having no ceiling at all. Each layer
 * defends itself.
 */
export function assertMinorUnits(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${field} must be an integer in minor units`);
  }
  if (value <= 0) {
    throw new RangeError(`${field} must be greater than zero, got ${value}`);
  }
  return value;
}

export function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}
