import {
  detectInjection,
  evaluate,
  project,
  type Call,
  type OfficeRegistry,
  type Scope,
} from "@scope-city/scope";
import type { QuotaLedger } from "@scope-city/ledger";
import type { EmitProxyEvent } from "./events.js";
import { fingerprintCall } from "./fingerprint.js";

/** A call into a real MCP server. Injected so the pipeline stays testable. */
/**
 * Performs the real call, behind the boundary.
 *
 * The context carries the proxy's idempotency key, which is the only identifier
 * that means "one intended action" across retries. A system talking to an API
 * that supports idempotent writes needs exactly this: deriving a key from the
 * arguments instead collides two legitimate identical actions, and generating
 * one per attempt makes every retry a new action. Only the caller knows which
 * of those a given request is.
 */
export type UpstreamCall = (
  call: Call,
  context: { readonly idempotencyKey: string },
) => Promise<unknown>;

/** Asks the operator and resolves once they decide. Injected for the same reason. */
export type CountersignGate = (request: {
  missionId: string;
  office: string;
  args: Record<string, unknown>;
  fingerprint: string;
}) => Promise<{ approved: boolean; fingerprint: string }>;

export type EnforceResult =
  | { readonly outcome: "allowed"; readonly value: unknown }
  | {
      readonly outcome: "refused";
      readonly reason: string;
      readonly detail: string;
    };

/**
 * Every call from the agent passes through here. The order of the steps is the
 * security design, so it is worth stating:
 *
 *  1. decide       -- is this call inside the scope at all?
 *  2. claim        -- take the quota atomically, before doing anything real
 *  3. countersign  -- ask the operator, bound to this exact call
 *  4. execute      -- only now does anything touch a real system
 *  5. project      -- cut the response down to what was granted
 *
 * Claiming before asking (2 before 3) is deliberate: it stops two subagents
 * both reaching a human with the same request. If the human then says no, or
 * the upstream fails, the claim is released so an unauthorised call never
 * burns the budget.
 */
export async function enforceCall(params: {
  scope: Scope;
  call: Call;
  registry: OfficeRegistry;
  ledger: QuotaLedger;
  upstream: UpstreamCall;
  countersign: CountersignGate;
  emit: EmitProxyEvent;
  nonce: string;
  idempotencyKey: string;
  now: number;
}): Promise<EnforceResult> {
  const { scope, call, registry, ledger, upstream, countersign, emit, nonce, idempotencyKey, now } =
    params;

  const spec = registry.get(call.office);
  const district = spec?.district ?? null;

  // 0. answer a retry before applying policy.
  //
  // An operation that already completed is a matter of record, not a decision
  // to make again -- and re-deciding it would refuse it for having spent the
  // very quota it spent itself. A retry that is still in flight is refused
  // rather than queued, so two concurrent submissions cannot both land.
  const existing = ledger.lookup(scope.missionId, idempotencyKey);
  if (existing) {
    if (existing.settled) {
      return { outcome: "allowed", value: existing.result };
    }
    return {
      outcome: "refused",
      reason: "call_in_flight",
      detail: `an identical ${call.office} call is already in progress`,
    };
  }

  // 1. decide
  const decision = evaluate({
    scope,
    call,
    registry,
    consumed: ledger.consumed(scope.missionId),
    now,
  });

  if (!decision.allowed) {
    emit({
      type: "call.out_of_scope",
      missionId: scope.missionId,
      office: call.office,
      district,
      reason: decision.reason,
      detail: decision.detail,
      at: now,
    });
    return { outcome: "refused", reason: decision.reason, detail: decision.detail };
  }

  // 2. claim -- only mutating offices are metered
  const mutating = spec?.mutating ?? true;
  let claimed = false;

  if (mutating) {
    const outcome = takeQuota({
      scope,
      call,
      district,
      ledger,
      emit,
      idempotencyKey,
      nonce,
      now,
    });
    if (outcome.kind !== "claimed") return outcome.result;
    claimed = true;
  }

  const release = (): void => {
    if (claimed) {
      ledger.release({ missionId: scope.missionId, office: call.office, idempotencyKey });
      claimed = false;
    }
  };

  // 3. countersign, bound to this exact call
  if (decision.countersignRequired && district) {
    const fingerprint = fingerprintCall({ scope, call });

    emit({
      type: "call.countersign_required",
      missionId: scope.missionId,
      office: call.office,
      district,
      fingerprint,
      at: now,
    });

    const verdict = await countersign({
      missionId: scope.missionId,
      office: call.office,
      args: call.args,
      fingerprint,
    });

    if (!verdict.approved) {
      release();
      return { outcome: "refused", reason: "countersign_denied", detail: "the operator refused" };
    }

    // The approval must belong to the call we are about to make. If the call
    // drifted after the operator read it, the approval is void.
    if (verdict.fingerprint !== fingerprint) {
      release();
      emit({
        type: "call.out_of_scope",
        missionId: scope.missionId,
        office: call.office,
        district,
        reason: "resource_not_in_scope",
        detail: "the approved call is not the call being made",
        at: now,
      });
      return {
        outcome: "refused",
        reason: "countersign_mismatch",
        detail: "the approved call is not the call being made",
      };
    }
  }

  // 4. execute
  let raw: unknown;
  try {
    raw = await upstream(call, { idempotencyKey });
  } catch (error) {
    release();
    const message = error instanceof Error ? error.message : String(error);
    emit({
      type: "upstream.failed",
      missionId: scope.missionId,
      office: call.office,
      message,
      at: now,
    });
    return { outcome: "refused", reason: "upstream_failed", detail: message };
  }

  // 5. project -- an allowed call can still overshare
  const projected = project({ scope, office: call.office, registry, response: raw });

  // The world has changed, so the claim stops being a reservation and becomes a
  // fact: it can no longer be released, and a retry gets this result back
  // instead of running again.
  if (claimed) {
    ledger.settle({
      missionId: scope.missionId,
      idempotencyKey,
      result: projected.value,
    });
    claimed = false;
  }

  if (projected.redacted.length > 0 || projected.truncated) {
    emit({
      type: "response.redacted",
      missionId: scope.missionId,
      office: call.office,
      redacted: projected.redacted,
      truncated: projected.truncated,
      at: now,
    });
  }

  // Injection is detected against the projected value: text the agent will
  // never see cannot steer it, so flagging it would be noise.
  const injections = detectInjection(projected.value);
  if (injections.length > 0) {
    emit({
      type: "response.injection_detected",
      missionId: scope.missionId,
      office: call.office,
      samples: injections,
      at: now,
    });
  }

  if (district) {
    emit({
      type: "call.allowed",
      missionId: scope.missionId,
      office: call.office,
      district,
      sequence: ledger.entries(scope.missionId).length,
      at: now,
    });
  }

  return { outcome: "allowed", value: projected.value };
}

type QuotaOutcome =
  | { readonly kind: "claimed" }
  | { readonly kind: "settled"; readonly result: EnforceResult }
  | { readonly kind: "refused"; readonly result: EnforceResult };

/**
 * Takes one unit of quota, or explains why it could not.
 *
 * Split out of `enforceCall` because the concurrency cases here -- exhausted,
 * replayed nonce, replay of a settled call, replay of one still in flight --
 * are the fiddliest part of the pipeline and deserve to be read on their own.
 */
function takeQuota(params: {
  scope: Scope;
  call: Call;
  district: string | null;
  ledger: QuotaLedger;
  emit: EmitProxyEvent;
  idempotencyKey: string;
  nonce: string;
  now: number;
}): QuotaOutcome {
  const { scope, call, district, ledger, emit, idempotencyKey, nonce, now } = params;
  const ceiling = scope.limits.maxCalls[call.office];

  const claim = ledger.claim({
    missionId: scope.missionId,
    office: call.office,
    ceiling,
    idempotencyKey,
    nonce,
    now,
  });

  if (!claim.won) {
    const exhausted = claim.reason === "exhausted";
    emit({
      type: "call.out_of_scope",
      missionId: scope.missionId,
      office: call.office,
      district,
      reason: "call_count_exhausted",
      detail: exhausted
        ? `${call.office} budget is spent`
        : `${call.office} call was already submitted`,
      at: now,
    });
    return {
      kind: "refused",
      result: {
        outcome: "refused",
        reason: exhausted ? "call_count_exhausted" : "replayed_call",
        detail: `${call.office} refused by the ledger`,
      },
    };
  }

  // A replay reaching here means two identical calls raced past the
  // short-circuit in enforceCall. Whichever lost must not proceed: calling
  // upstream again would perform an irreversible action twice.
  if ("replayOf" in claim) {
    return claim.settled
      ? { kind: "settled", result: { outcome: "allowed", value: claim.result } }
      : {
          kind: "refused",
          result: {
            outcome: "refused",
            reason: "call_in_flight",
            detail: `an identical ${call.office} call is already in progress`,
          },
        };
  }

  emit({
    type: "quota.consumed",
    missionId: scope.missionId,
    office: call.office,
    used: claim.used,
    ceiling,
    at: now,
  });

  return { kind: "claimed" };
}

/**
 * What the agent is allowed to see in tools/list.
 *
 * An office outside the scope is not listed as forbidden -- it is absent. The
 * model cannot want what it cannot see, and a tool it never learned about is
 * one it cannot be talked into calling.
 */
export function visibleOffices(scope: Scope, registry: OfficeRegistry): readonly string[] {
  return scope.offices.filter((office) => registry.has(office));
}
