/**
 * Registers the model providers Scope City rotates across.
 *
 * Free tiers are generous but small, and a demo that dies on a 429 halfway
 * through a refusal is worse than no demo. TrueForge lets the same provider
 * type be registered more than once under different names, so four free keys
 * become four independently-quota'd models the pool can fall between.
 *
 *   1. copy .env.example to .env and paste your keys
 *   2. pnpm demo:models
 *
 * Nothing here is Scope City specific -- it is only reachable configuration --
 * but it lives in the repo so a stranger can get a working demo without being
 * told a sequence of clicks.
 */

// Loads .env on import, before anything below reads the environment. The
// same loader the control plane uses -- this file had kept its own copy,
// which had never been given the precedence fix the shared one got.
import "./load-env.js";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { REASONING_EFFORTS } from "@scope-city/harness";

/**
 * The upstream Gemini model every slot points at.
 *
 * Configurable because TrueForge's catalogue is a suggestion, not a
 * restriction: `model_id` is passed through to the provider, so any id Google
 * currently serves works whether or not it appears in the catalogue. Free-tier
 * availability moves, and hard-coding a model here would mean editing source
 * to react to that.
 */
interface Slot {
  /** Provider name in TrueForge. Also the label the pool reports. */
  readonly provider: string;
  /** Model name agents reference. Distinct per slot, so the pool can pick one. */
  readonly model: string;
  readonly envKey: string;
  readonly contextLength: number;
  /**
   * Where the OpenAI-compatible endpoint lives. Defaults to Gemini's.
   *
   * A slot is not tied to a vendor -- it is a base URL, a key and a model id.
   * That is what lets a local Ollama join the same pool as a hosted key
   * without the proxy, the scope or the city knowing the difference.
   */
  readonly baseUrl?: string;
  /** The upstream model id, when it is not the shared Gemini one. */
  readonly modelId?: string;
  /**
   * Whether this model accepts a reasoning effort.
   *
   * Declared per slot because it is not a property of the harness. Gemini
   * takes one; a local Qwen answers `400 does not support thinking`, so
   * claiming support here would turn the operator's choice into a failed
   * launch rather than an ignored hint.
   */
  readonly reasoningEfforts?: readonly string[];
  /** Local endpoints need no credential, so the env key is not required. */
  readonly keyOptional?: boolean;
}

/**
 * Gemini's OpenAI-compatible endpoint.
 *
 * Registered as `custom` rather than `google-gemini` for one structural
 * reason: GoogleGeminiModelProvider has no `name`, so TrueForge holds exactly
 * one entry per provider type and four keys cannot coexist. CustomModelProvider
 * does take a name, and Gemini serves an OpenAI-shaped API including tool
 * calling, so four named custom providers give four independently-quota'd
 * models -- which is the whole point of rotating.
 */
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Four slots against the same upstream model.
 *
 * Same model deliberately: rotation is about which key pays for the call, not
 * about swapping capability mid-mission. An agent that becomes cleverer or
 * stupider when a quota runs out is a demo that cannot be reasoned about.
 */
const SLOTS: readonly Slot[] = [
  {
    provider: "gemini-a",
    model: "flash-a",
    envKey: "GEMINI_API_KEY_A",
    contextLength: 1_000_000,
  },
  {
    provider: "gemini-b",
    model: "flash-b",
    envKey: "GEMINI_API_KEY_B",
    contextLength: 1_000_000,
  },
  {
    provider: "gemini-c",
    model: "flash-c",
    envKey: "GEMINI_API_KEY_C",
    contextLength: 1_000_000,
  },
  {
    provider: "gemini-d",
    model: "flash-d",
    envKey: "GEMINI_API_KEY_D",
    contextLength: 1_000_000,
  },
];

/**
 * A local model, when one is running.
 *
 * The point is not that it is cheaper. It is that the boundary does not care
 * which model is behind it: the scope, the proxy, the ledger and the gate are
 * the same whether the agent is Gemini or a Qwen on this laptop. Being able to
 * swap the model and watch nothing about the enforcement change is the clearest
 * demonstration that enforcement does not depend on trusting the model.
 *
 * Off unless OLLAMA_HOST is set, because a fresh clone with nothing listening
 * on 11434 must not fail model discovery on a slot nobody asked for.
 *
 * No reasoning efforts declared: Ollama refuses one outright rather than
 * ignoring it, so claiming support would turn the operator's choice into a
 * failed launch.
 *
 * Built from the environment as a function, not read at module load. `.env` is
 * loaded by `main`, so a module-level read happens first and sees nothing --
 * which meant the documented way of configuring this was the one way that did
 * not work. It appeared to work only for someone who had already exported the
 * variable in their shell.
 */
function localSlots(): readonly Slot[] {
  const host = process.env.OLLAMA_HOST ?? "";
  if (!host) return [];

  return [
    {
      provider: "local",
      model: "qwen",
      // The credential, not the endpoint. Naming OLLAMA_HOST here passed the
      // URL itself as the API key and made the fallback below unreachable --
      // harmless against Ollama, which ignores it, and wrong for any other
      // OpenAI-compatible endpoint, which would be handed a URL where its
      // token should be and reject every call.
      envKey: "OLLAMA_API_KEY",
      keyOptional: true,
      contextLength: 32_768,
      baseUrl: `${host.replace(/\/+$/, "")}/v1`,
      modelId: process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
      reasoningEfforts: [],
    },
  ];
}

async function main(): Promise<void> {
  const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
  const sharedModelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const client = new TrueForge({ baseUrl, timeoutInSeconds: 60 });
  const configured: string[] = [];
  const skipped: string[] = [];

  for (const slot of [...SLOTS, ...localSlots()]) {
    const apiKey = process.env[slot.envKey];
    // A local endpoint usually has no credential to present. Requiring one
    // would skip the slot for lacking something it does not need -- but the
    // key is still read, so an endpoint that does want one gets it.
    if (!apiKey && !slot.keyOptional) {
      skipped.push(slot.envKey);
      continue;
    }

    const efforts = slot.reasoningEfforts ?? REASONING_EFFORTS;

    // Note the camelCase. The SDK's TypeScript surface is camelCase and it
    // converts to snake_case on the wire; the OpenAPI document shows the wire
    // format. Passing snake_case here is accepted silently and then dropped,
    // which surfaces much later as "the agent has no tools".
    await client.settings.modelProviders.createOrUpdate({
      manifest: {
        type: "custom",
        name: slot.provider,
        baseUrl: slot.baseUrl ?? GEMINI_OPENAI_BASE_URL,
        // Ollama ignores the credential; sending an empty one is what its
        // OpenAI-compatible endpoint expects rather than omitting the field.
        auth: { apiKey: apiKey ?? "local" },
        models: [
          {
            modelId: slot.modelId ?? sharedModelId,
            name: slot.model,
            properties: {
              contextLength: slot.contextLength,
              maxOutputTokens: 8192,
              // Declared, or the effort is refused rather than ignored.
              //
              // TrueForge validates `model.params.reasoningEffort` against what
              // the registered model says it supports, and a model that
              // declares nothing rejects every effort with a 422 reading
              // "does not support configurable reasoning effort". Registering
              // the levels is what makes the operator's choice reach the
              // provider instead of being an unused control.
              // Per slot, not global, and omitted rather than empty.
              //
              // TrueForge refuses `reasoning_efforts: []` outright -- the field
              // must have at least one entry or not be there at all. Absent is
              // the honest encoding for a model that takes no effort: the
              // harness then refuses any effort sent to it, which is exactly
              // the behaviour wanted. See the note on `Slot.reasoningEfforts`.
              ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
            },
          },
        ],
      },
    } as never);

    // TrueForge addresses a model as "provider/model" -- the model name alone
    // is ambiguous once the same model is registered under several providers,
    // which is exactly what rotation does.
    configured.push(`${slot.provider}/${slot.model}`);
  }

  if (configured.length === 0) {
    console.error("\n  No keys found. Copy .env.example to .env and paste at least one.\n");
    console.error("  Free Gemini keys: https://aistudio.google.com/apikey\n");
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Configured ${configured.length} model(s): ${configured.join(", ")}`);
  if (skipped.length > 0) {
    console.log(`  Not set: ${skipped.join(", ")}`);
    console.log("  One key works. More independent keys make the live demo resilient to rate limits.");
  }
  console.log(`\n  SCOPE_MODELS=${configured.join(",")}\n`);
  console.log("  Leave SCOPE_MODELS empty to discover these automatically, or copy the line above to pin the order.\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const body = (error as { body?: unknown })?.body;
  console.error(`\n  Failed: ${message}`);
  if (body) console.error(`  ${JSON.stringify(body).slice(0, 300)}`);
  console.error(
    `\n  Is TrueForge running at ${process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790"}?\n`,
  );
  process.exitCode = 1;
});
