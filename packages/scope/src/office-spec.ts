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
