/**
 * Rotation across several models, so a free-tier quota does not end a demo.
 *
 * Open-source TrueForge has no fallback chain of its own -- that lives in
 * TrueFoundry's hosted AI Gateway -- so this is ours. Several keys on independent free
 * tiers behave like one workable allowance, provided something notices a 429
 * and moves on.
 *
 * Pure and clock-injected, like the rest of the substrate: `now` is an argument
 * so cooldown behaviour is testable without waiting for real minutes to pass.
 */

export interface PoolEntry {
  /** The model name as registered in TrueForge, e.g. "flash-a". */
  readonly model: string;
  /** Lower is tried first. Ties are broken by declaration order. */
  readonly priority: number;
}

export type FailureKind =
  | "rate_limited"
  | "quota_exhausted"
  | "credential_rejected"
  | "unavailable"
  | "other";

interface Cooling {
  readonly until: number;
  readonly kind: FailureKind;
  /**
   * When the penalty was recorded.
   *
   * Needed because one pool now serves every mission, so a success and a
   * failure on the same model can be reported out of order: an attempt that
   * started earlier and finished later would otherwise clear a cooldown set
   * after it, handing the next mission a key that was rate-limited seconds ago.
   */
  readonly at: number;
}

/** How long a model sits out after each kind of refusal. */
const COOLDOWN_MS: Record<FailureKind, number> = {
  // A rate limit is usually a short window; retry soon rather than burning the
  // whole pool on one busy minute.
  rate_limited: 60_000,
  // A daily quota will not come back within a demo, so effectively retire it.
  quota_exhausted: 6 * 60 * 60 * 1000,
  // Credentials belong to one pool entry, not to the request. Retire the bad
  // entry for the demo but keep trying independently configured providers.
  credential_rejected: 6 * 60 * 60 * 1000,
  unavailable: 120_000,
  other: 30_000,
};

export class ModelPool {
  readonly #entries: readonly PoolEntry[];
  readonly #cooling = new Map<string, Cooling>();

  constructor(entries: readonly PoolEntry[]) {
    if (entries.length === 0) throw new Error("a model pool needs at least one model");
    this.#entries = [...entries].sort((a, b) => a.priority - b.priority);
  }

  /**
   * The best model available now, or undefined when every one is cooling.
   *
   * Undefined rather than "the least-cooling one": handing back a model that is
   * known to be rate-limited produces a confusing failure a layer further down,
   * where the caller can no longer explain it.
   */
  next(now: number): string | undefined {
    for (const entry of this.#entries) {
      const cooling = this.#cooling.get(entry.model);
      if (!cooling || cooling.until <= now) return entry.model;
    }
    return undefined;
  }

  /** Every model that could be tried now, best first. */
  available(now: number): readonly string[] {
    return this.#entries
      .filter((e) => {
        const cooling = this.#cooling.get(e.model);
        return !cooling || cooling.until <= now;
      })
      .map((e) => e.model);
  }

  /** Sidelines a model for a while, according to how it failed. */
  penalise(model: string, kind: FailureKind, now: number): void {
    this.#cooling.set(model, { until: now + COOLDOWN_MS[kind], kind, at: now });
  }

  /**
   * Clears a cooldown the success is entitled to clear.
   *
   * `succeededAt` is when the successful attempt *began*, not when it was
   * reported. With one pool serving every mission, a slow attempt can finish
   * after a later one has already failed and penalised the same model -- and
   * clearing that newer cooldown would hand the next mission a key known to be
   * rate-limited, which is the memory this pool exists to keep.
   *
   * So a success only forgives a penalty older than itself. A newer one stands
   * on the evidence that produced it.
   */
  restore(model: string, succeededAt: number = Number.POSITIVE_INFINITY): void {
    const cooling = this.#cooling.get(model);
    if (cooling && cooling.at > succeededAt) return;
    this.#cooling.delete(model);
  }

  /** When the pool will next have something, or undefined if it already does. */
  nextAvailableAt(now: number): number | undefined {
    if (this.next(now) !== undefined) return undefined;
    const times = [...this.#cooling.values()].map((c) => c.until);
    return times.length > 0 ? Math.min(...times) : undefined;
  }

  get size(): number {
    return this.#entries.length;
  }
}

/**
 * Reads a provider's refusal and decides what kind it was.
 *
 * Providers disagree about status codes and wording, so this looks at both and
 * errs toward the shorter cooldown: mistaking a rate limit for an exhausted
 * quota retires a working key for six hours, which is much worse during a demo
 * than retrying one too early.
 */
export function classifyFailure(error: unknown): FailureKind {
  const status = (error as { statusCode?: number })?.statusCode;
  const text = [
    error instanceof Error ? error.message : "",
    JSON.stringify((error as { body?: unknown })?.body ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  if (/quota|billing|exceeded your current quota|insufficient_quota/.test(text)) {
    return "quota_exhausted";
  }
  if (status === 429 || /rate.?limit|too many requests|resource_exhausted/.test(text)) {
    return "rate_limited";
  }
  if (status === 401 || status === 403 || /\((401|403)\).*\b(unauthorized|forbidden)\b/.test(text)) {
    return "credential_rejected";
  }
  if (status === 503 || status === 502 || /overloaded|unavailable|capacity/.test(text)) {
    return "unavailable";
  }
  return "other";
}

/** True when a failure is worth trying a different model for. */
export function isWorthRotating(kind: FailureKind): boolean {
  // "other" covers bad requests and malformed specs, which will fail identically
  // on every model. Rotating through the pool on those just multiplies the noise.
  return kind !== "other";
}
