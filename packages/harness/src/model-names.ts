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
  readonly properties?: {
    readonly reasoning_efforts?: readonly string[];
    readonly reasoningEfforts?: readonly string[];
  };
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
 * not provider-qualified, so several keys registered against the same Gemini
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

/**
 * Which models will accept a reasoning effort, by qualified name.
 *
 * Needed because not every model does, and the ones that do not reject the
 * request rather than ignoring it. A local Qwen behind Ollama answers a
 * reasoning effort with `400 "qwen2.5:3b" does not support thinking`, so
 * sending one on the operator's behalf turns a working mission into a failed
 * launch.
 *
 * Read from what each model declares rather than guessed from its name: the
 * harness already validates an effort against this list, and the control plane
 * should agree with it instead of finding out at session creation.
 *
 * Both spellings are accepted. The wire format is snake_case and the SDK
 * converts to camelCase, and which one arrives depends on the path a listing
 * took to get here.
 */
export function reasoningEffortsByModel(
  entries: readonly ModelListEntry[],
): ReadonlyMap<string, readonly string[]> {
  const byModel = new Map<string, readonly string[]>();

  for (const entry of entries) {
    const name = entry.name ?? entry.id;
    if (typeof name !== "string" || !name.includes("/")) continue;

    const efforts = entry.properties?.reasoning_efforts ?? entry.properties?.reasoningEfforts ?? [];
    byModel.set(name, efforts);
  }

  return byModel;
}

/**
 * Providers a mission will never rotate onto unless it was asked to by name.
 *
 * Just the local one today. A model running on the operator's own machine is
 * there to prove a point -- that the scope, the proxy and the gate do not care
 * which model is behind them -- and it earns its place in the pool by being
 * selectable, not by being a fallback.
 */
const OPT_IN_PROVIDERS = new Set(["local"]);

/**
 * The models discovery may pick on its own.
 *
 * Rotation exists to survive a cooling key, and it treats every registered
 * model as interchangeable. That is true of four Gemini keys and false of a 7B
 * on a laptop: when the hosted keys rate-limited, a mission rotated onto the
 * local model and effectively stopped, because a model that takes minutes per
 * turn is worse for a demo than waiting sixty seconds for a key to come back.
 *
 * The failure is quiet, which is the worst part -- nothing is broken, the run
 * simply becomes something nobody would want to watch, and the only warning is
 * a line of log naming a model the operator never chose.
 *
 * So an opt-in provider is reachable through `SCOPE_MODELS`, where naming it is
 * a decision, and invisible to automatic discovery, where it would be an
 * accident. Filtered here rather than left out of the registry, because it must
 * stay registered to be selectable at all.
 */
export function rotationCandidates(names: readonly string[]): readonly string[] {
  return names.filter((name) => !OPT_IN_PROVIDERS.has(name.split("/")[0] ?? ""));
}
