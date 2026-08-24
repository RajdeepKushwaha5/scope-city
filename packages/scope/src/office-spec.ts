import { z } from "zod";
import { OfficeIdSchema } from "./schema.js";

/**
 * What the evaluator needs to know about a tool in order to police it.
 *
 * Without this the evaluator would have to guess which argument is a charge id
 * and which is a free-text note, and guessing is how scoped systems leak. Every
 * office we proxy must be declared here; an undeclared office is unreachable.
 */

export const ArgBindingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resource"),
    /** Which resource class in the scope's grant this argument is checked against. */
    resourceClass: z.string().min(1),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("amount_minor"),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("opaque"),
    required: z.boolean().default(false),
  }),
]);

export const OfficeSpecSchema = z.object({
  office: OfficeIdSchema,
  /** The district this office sits in -- drives where it renders on the map. */
  district: z.string().min(1),
  /** Whether calling it changes state. Mutating offices consume quota. */
  mutating: z.boolean(),
  /** argument name -> how to police it */
  args: z.record(z.string().min(1), ArgBindingSchema),
  /**
   * Every field the underlying tool can return, so projection is a subtraction
   * from a known set rather than a hopeful allowlist over an unknown one.
   */
  responseFields: z.array(z.string().min(1)).readonly(),

  /**
   * Which of those fields carry text an attacker can write.
   *
   * This is the field that makes two-stage sealing enforceable rather than
   * aspirational. The pre-grant resolver has to read *something* -- "refund
   * order #184" only becomes a charge id by looking it up -- and if it reads a
   * ticket body while doing so, the injected instruction has reached the
   * derivation and the whole invariant is gone.
   *
   * Declaring it here means the resolver's safe surface is computed by
   * subtraction (`resolverSafeFields`) instead of maintained as a second list
   * that can silently drift out of step with this one. A new free-text field
   * that nobody classifies is the dangerous case, so the default is the
   * cautious direction: unlisted fields are treated as structured, and the
   * registry test asserts every known prose field is declared.
   */
  freeTextFields: z.array(z.string().min(1)).readonly().default([]),
});

export type OfficeSpec = z.infer<typeof OfficeSpecSchema>;
export type ArgBinding = z.infer<typeof ArgBindingSchema>;

export type OfficeRegistry = ReadonlyMap<string, OfficeSpec>;

export function buildRegistry(specs: readonly OfficeSpec[]): OfficeRegistry {
  const map = new Map<string, OfficeSpec>();
  for (const spec of specs) {
    if (map.has(spec.office)) {
      throw new Error(`duplicate office spec: ${spec.office}`);
    }
    map.set(spec.office, spec);
  }
  return map;
}

/**
 * The fields of an office's response that the pre-grant resolver may read.
 *
 * Everything the office can return, minus everything an attacker can write
 * into. Computed rather than declared so it cannot drift from the office spec
 * it describes.
 *
 * This is what stage 2 of sealing is allowed to see. `ticket.get` keeps its
 * `order_id` and `customer_email` -- which is precisely what "refund order
 * #184" needs to become a concrete charge and recipient -- and loses `subject`
 * and `body`, which is where the injected instruction lives.
 */
export function resolverSafeFields(spec: OfficeSpec): readonly string[] {
  const unsafe = new Set(spec.freeTextFields);
  return spec.responseFields.filter((field) => !unsafe.has(field));
}
