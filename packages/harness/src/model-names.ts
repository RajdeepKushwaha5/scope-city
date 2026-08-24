/**
 * Reading qualified model names out of a harness models listing.
 *
 * Pure and separate from the driver on purpose. The driver is the one place
 * that talks to a server and is deliberately untested; this is the only part of
 * `listModels` that can be wrong in an interesting way, so it lives where a
 * test can reach it without a network.
 */

export interface ModelListEntry {
  readonly name?: string;
  readonly id?: string;
  readonly model_id?: string;
}

/**
 * The fully-qualified `provider/model` identifiers in a models listing.
 *
 * `name` first, `id` second, and the order is not arbitrary. The standalone
 * harness this project targets returns the qualified identifier under `name`,
 * verified against a running instance rather than inferred:
 *
 *   {"data":[{"name":"gemini-a/flash-a","model_id":"gemini-2.5-flash",
 *             "provider":{"name":"gemini-a"}}, ...]}
 *
 * TrueFoundry's hosted API documents the qualified identifier under `id`, so
 * `id` is accepted as a fallback: pointing this at a hosted control plane
 * should degrade to a working pool rather than an empty one.
 *
 * `model_id` is deliberately never read. It is the *underlying* model and is
 * not provider-qualified, so three keys registered against the same Gemini
 * model would yield three indistinguishable "gemini-2.5-flash" entries -- a
 * pool that looks healthy and rotates onto the same rate-limited credential
 * every time.
 *
 * Anything without a slash is dropped rather than repaired. An unqualified name
 * is rejected by the harness at session creation, and failing at launch with
 * "no models" is a better outcome than failing mid-mission on the first turn.
 */
export function qualifiedModelNames(entries: readonly ModelListEntry[]): readonly string[] {
  return entries
    .map((entry) => entry.name ?? entry.id)
    .filter((name): name is string => typeof name === "string" && name.includes("/"));
}
