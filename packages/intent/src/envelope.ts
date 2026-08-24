import { z } from "zod";
import { OfficeIdSchema } from "@scope-city/scope";

/**
 * Stage 1 of sealing: what the operator asked for, and nothing else.
 *
 * An intent envelope is derived from the operator's own sentence in a turn with
 * **no tool access at all**. That constraint is the entire point. If derivation
 * could read a ticket, an attacker who controls that ticket controls the shape
 * of the authority that gets proposed -- and every guarantee downstream is
 * decoration.
 *
 * So the envelope deals in what a human said, which means it deals in *symbolic*
 * references. The operator can say "order #184", so `order_ids: ["ord_184"]` is
 * derivable. They did not say "ch_9f2a", and no amount of language processing
 * can invent it, so `charge_ids` is necessarily empty here and gets filled in by
 * the resolver in stage 2.
 *
 * The distinction is load-bearing rather than pedantic: a field this stage
 * cannot fill is a field an injected instruction cannot reach.
 */

/** A resource class the operator named directly, e.g. `order_ids: ["ord_184"]`. */
export const NamedResourcesSchema = z.record(z.string().min(1), z.array(z.string().min(1)));

export const IntentEnvelopeSchema = z.object({
  /** The operator's sentence, verbatim. Displayed back to them before granting. */
  job: z.string().min(1),

  /**
   * The offices the job needs. Derived from the request, then intersected with
   * the registry -- a model that hallucinates `database.drop` gets it dropped
   * rather than proposed, because an office nobody declared cannot be policed.
   */
  offices: z.array(OfficeIdSchema).readonly(),

  /** Resource ids the operator named. Never anything requiring a lookup. */
  named: NamedResourcesSchema,

  /**
   * Resource classes this job will need but which only a lookup can fill.
   * Recorded so the resolver knows what it is being asked to find, and so the
   * UI can show "pending resolution" rather than an empty box.
   */
  unresolved: z.array(z.string().min(1)).readonly(),

  /** Ceiling on a monetary argument, integer minor units, per office. */
  maxAmountMinor: z.record(OfficeIdSchema, z.number().int().nonnegative()),

  /** How many times each office may be called. */
  maxCalls: z.record(OfficeIdSchema, z.number().int().positive()),

  /** How long the authority should live, in milliseconds. */
  ttlMs: z.number().int().positive(),

  /** Offices that must stop for a human before executing. */
  countersignRequired: z.array(OfficeIdSchema).readonly(),
});

export type IntentEnvelope = z.infer<typeof IntentEnvelopeSchema>;

/**
 * What the resolver found, in stage 2.
 *
 * Kept separate from the envelope rather than merged into it so that "what a
 * human asked for" and "what a lookup discovered" stay distinguishable all the
 * way to the grant screen. The operator is entitled to see which is which
 * before they approve: `ord_184` came from their sentence, `ch_184` did not.
 */
export const ResolutionSchema = z.object({
  resolved: NamedResourcesSchema,
  /** One line per lookup, for the record and the grant screen. */
  trace: z
    .array(
      z.object({
        office: OfficeIdSchema,
        found: z.record(z.string().min(1), z.array(z.string().min(1))),
      }),
    )
    .readonly(),
});

export type Resolution = z.infer<typeof ResolutionSchema>;
