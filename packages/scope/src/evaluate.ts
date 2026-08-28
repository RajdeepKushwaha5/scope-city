import type { Call, Decision, Scope } from "./schema.js";
import type { OfficeRegistry } from "./office-spec.js";

/**
 * The whole safety claim lives in this function, which is why it is pure: no
 * clock, no network, no database. `now` and `consumed` are arguments so every
 * branch is reachable from a test.
 *
 * Deny by default. Every `return` below is either an explicit allow at the very
 * end, or a refusal -- there is no path that falls through to permitted.
 */
export function evaluate(params: {
  scope: Scope;
  call: Call;
  registry: OfficeRegistry;
  /** office id -> calls already consumed against this scope. */
  consumed: Readonly<Record<string, number>>;
  now: number;
}): Decision {
  const { scope, call, registry, consumed, now } = params;

  // A scope that is not live cannot authorise anything, whatever it contains.
  if (scope.state !== "granted" && scope.state !== "active" && scope.state !== "expiring") {
    return {
      allowed: false,
      reason: "scope_not_active",
      detail: `scope is ${scope.state}`,
    };
  }

  if (now >= scope.expiresAt) {
    return {
      allowed: false,
      reason: "scope_expired",
      detail: `expired at ${new Date(scope.expiresAt).toISOString()}`,
    };
  }

  // An office outside the scope should never have been visible in tools/list.
  // Reaching here means the model invented it or replayed an older listing.
  if (!scope.offices.includes(call.office)) {
    return {
      allowed: false,
      reason: "office_not_in_scope",
      detail: `${call.office} is not in this scope`,
    };
  }

  const spec = registry.get(call.office);
  if (!spec) {
    // Undeclared office: we cannot police its arguments, so we cannot allow it.
    return {
      allowed: false,
      reason: "office_not_in_scope",
      detail: `${call.office} has no office spec`,
    };
  }

  /*
   * An argument the spec does not declare cannot be policed, so it is refused.
   *
   * The loop below checks what the office declares -- resource ids against the
   * granted set, amounts against the ceiling. It says nothing about anything
   * else in `call.args`, and the whole object is handed to the upstream
   * handler afterwards. Every handler shipped here picks its fields by name,
   * so nothing reaches Stripe that the handler did not ask for; the protection
   * was that the authors happened to be careful.
   *
   * That is the shape of defence this project exists to argue against. This
   * function's own comment promises there is no path that falls through to
   * permitted, and an undeclared argument was one -- an office written as
   * `call(args) { return api.post(args) }` would forward a refund reason, a
   * transfer reversal, or an application-fee flag, and the boundary would not
   * notice it had happened.
   *
   * Refused rather than stripped. Removing it silently leaves the agent unable
   * to tell why its argument had no effect, and an agent that cannot see the
   * boundary reason guesses -- which is how a retry loop starts.
   */
  const declared = new Set(Object.keys(spec.args));
  const undeclared = Object.keys(call.args).filter((name) => !declared.has(name));
  if (undeclared.length > 0) {
    return {
      allowed: false,
      reason: "argument_not_declared",
      detail: `${call.office} does not declare ${undeclared.sort().join(", ")}`,
    };
  }

  for (const [argName, binding] of Object.entries(spec.args)) {
    const value = call.args[argName];
    const present = value !== undefined && value !== null;

    if (!present) {
      if (binding.required) {
        return {
          allowed: false,
          reason: "missing_required_argument",
          detail: `${call.office} requires ${argName}`,
        };
      }
      continue;
    }

    if (binding.kind === "resource") {
      const granted = scope.resources[binding.resourceClass] ?? [];
      const asString = String(value);
      if (!granted.includes(asString)) {
        return {
          allowed: false,
          reason: "resource_not_in_scope",
          detail: `${asString} is not a granted ${binding.resourceClass}`,
        };
      }
    }

    if (binding.kind === "amount_minor") {
      // Reject anything that is not already an integer in minor units. A float
      // here means the caller is doing currency maths we cannot verify.
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          allowed: false,
          reason: "amount_not_integer",
          detail: `${argName} must be an integer in minor units, got ${String(value)}`,
        };
      }

      // A ceiling alone does not bound an amount: -1000 is comfortably under
      // 4900, and a negative refund runs backwards through the downstream
      // system, restoring refundable headroom. Repeat that and the ceiling
      // means nothing. The range has to be closed at both ends.
      if (value <= 0) {
        return {
          allowed: false,
          reason: "amount_not_positive",
          detail: `${argName} must be greater than zero, got ${value}`,
        };
      }

      const ceiling = scope.limits.maxAmountMinor[call.office];
      if (ceiling === undefined || value > ceiling) {
        return {
          allowed: false,
          reason: "amount_over_limit",
          detail:
            ceiling === undefined
              ? `${call.office} has no amount ceiling in this scope`
              : `${value} exceeds ceiling ${ceiling}`,
        };
      }
    }
  }

  // Quota is checked here so a caller can see the refusal coming, but the
  // authoritative claim is atomic and lives in the ledger. Two subagents can
  // both pass this check; only one of them will win the claim.
  const ceiling = scope.limits.maxCalls[call.office];
  if (ceiling !== undefined) {
    const used = consumed[call.office] ?? 0;
    if (used >= ceiling) {
      return {
        allowed: false,
        reason: "call_count_exhausted",
        detail: `${call.office} allows ${ceiling} call(s), ${used} used`,
      };
    }
  }

  return {
    allowed: true,
    countersignRequired: scope.countersignRequired.includes(call.office),
  };
}
