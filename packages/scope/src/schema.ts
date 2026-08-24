import { z } from "zod";

/**
 * A Scope is the whole product in one object: the exact authority an agent
 * holds for one job. It is issued by a human, held server-side, and consulted
 * on every single call.
 *
 * Money is always integer minor units (paise/cents). Never floats -- a scope
 * that says "at most $49.00" must not be defeated by 49.000000000000004.
 */

export const OfficeIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, "office ids look like 'charge.refund'");

/** Resources the scope may touch, keyed by resource class. */
export const ResourceGrantSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).readonly(),
);

export const LimitsSchema = z.object({
  /** Per-office ceiling on a monetary argument, in integer minor units. */
  maxAmountMinor: z.record(OfficeIdSchema, z.number().int().nonnegative()).default({}),
  /** Per-office ceiling on how many times it may be called. */
  maxCalls: z.record(OfficeIdSchema, z.number().int().positive()).default({}),
  /** Ceiling on bytes returned by any single call, after projection. */
  maxResponseBytes: z.number().int().positive().default(64_000),
});

/**
 * Which response fields survive projection, per office. A missing entry means
 * "nothing passes" -- deny by default, so adding a tool without thinking about
 * its response cannot leak.
 */
export const ProjectionSchema = z.record(
  OfficeIdSchema,
  z.array(z.string().min(1)).readonly(),
);

export const ScopeStateSchema = z.enum([
  "drafted",
  "proposed",
  "granted",
  "active",
  "expiring",
  "expired",
  "revoked",
  "denied",
]);

export const ScopeSchema = z.object({
  /** Unguessable. This is the only handle to the scope; it never reaches the model. */
  missionId: z.string().min(16),
  scopeId: z.string().min(1),
  agent: z.string().min(1),
  job: z.string().min(1),
  state: ScopeStateSchema,

  offices: z.array(OfficeIdSchema).readonly(),
  resources: ResourceGrantSchema,
  limits: LimitsSchema,
  projection: ProjectionSchema,

  /** Offices whose calls stop for a human countersign before executing. */
  countersignRequired: z.array(OfficeIdSchema).readonly(),

  /** Epoch millis. Absolute, not a duration -- clock skew is the caller's problem. */
  expiresAt: z.number().int().positive(),
  grantedBy: z.string().min(1).nullable(),
  grantedAt: z.number().int().positive().nullable(),

  /** Bumped on every mutation. A countersign is bound to one version. */
  version: z.number().int().nonnegative(),
});

export type Scope = z.infer<typeof ScopeSchema>;
export type ScopeState = z.infer<typeof ScopeStateSchema>;
export type Limits = z.infer<typeof LimitsSchema>;

/** A single attempted tool call, normalised before it reaches the evaluator. */
export const CallSchema = z.object({
  office: OfficeIdSchema,
  args: z.record(z.string(), z.unknown()),
  /** Set by the proxy, never by the model. */
  attemptedAt: z.number().int().positive(),
});

export type Call = z.infer<typeof CallSchema>;

/**
 * Why a call was refused. These are the strings the map animates, so they are
 * part of the contract rather than debug text.
 */
export const DenialReasonSchema = z.enum([
  "office_not_in_scope",
  "resource_not_in_scope",
  "amount_over_limit",
  "call_count_exhausted",
  "scope_expired",
  "scope_not_active",
  "amount_not_integer",
  "missing_required_argument",
]);

export type DenialReason = z.infer<typeof DenialReasonSchema>;

export type Decision =
  | { allowed: true; countersignRequired: boolean }
  | { allowed: false; reason: DenialReason; detail: string };
