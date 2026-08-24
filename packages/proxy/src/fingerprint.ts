import { createHash } from "node:crypto";
import type { Call, Scope } from "@scope-city/scope";

/**
 * A countersign approves one exact call, not a category of call.
 *
 * Without this binding the flow has a gap: the operator reads "refund $49 to
 * ch_184", approves, and the model then submits `charge.refund(ch_185, 39900)`
 * against an approval that has already been granted. Binding the countersign to
 * a fingerprint of the normalised call closes it -- if anything drifted between
 * the screen and execution, the fingerprint no longer matches and we ask again.
 *
 * The scope version is included so that re-granting a scope invalidates every
 * countersign issued against the previous one.
 */
export function fingerprintCall(params: {
  scope: Scope;
  call: Call;
  /** Opaque version of the target resource, when the upstream gives us one. */
  resourceVersion?: string | null;
}): string {
  const { scope, call, resourceVersion } = params;

  const payload = JSON.stringify({
    missionId: scope.missionId,
    scopeId: scope.scopeId,
    scopeVersion: scope.version,
    office: call.office,
    args: normaliseArgs(call.args),
    resourceVersion: resourceVersion ?? null,
    expiresAt: scope.expiresAt,
  });

  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Key order must not change the fingerprint, or an approval would break on a
 * cosmetic difference. Nested objects are normalised too, since a tool argument
 * can be a structure.
 */
function normaliseArgs(args: Record<string, unknown>): unknown {
  return normalise(args);
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalise);

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return Object.fromEntries(entries.map(([k, v]) => [k, normalise(v)]));
}
