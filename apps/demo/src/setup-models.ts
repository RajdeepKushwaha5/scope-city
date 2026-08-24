/**
 * Registers the model providers Scope City rotates across.
 *
 * Free tiers are generous but small, and a demo that dies on a 429 halfway
 * through a refusal is worse than no demo. TrueForge lets the same provider
 * type be registered more than once under different names, so three free keys
 * become three independently-quota'd models the pool can fall between.
 *
 *   1. copy .env.example to .env and paste your keys
 *   2. pnpm demo:models
 *
 * Nothing here is Scope City specific -- it is only reachable configuration --
 * but it lives in the repo so a stranger can get a working demo without being
 * told a sequence of clicks.
 */

import { readFileSync } from "node:fs";
import { TrueForge } from "@truefoundry/trueforge-sdk";

/**
 * The upstream Gemini model every slot points at.
 *
 * Configurable because TrueForge's catalogue is a suggestion, not a
 * restriction: `model_id` is passed through to the provider, so any id Google
 * currently serves works whether or not it appears in the catalogue. Free-tier
 * availability moves, and hard-coding a model here would mean editing source
 * to react to that.
 */
/** Load .env without a dependency: this runs once, by hand, before anything else. */
function loadEnv(): void {
  try {
    const text = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // No .env is fine; the variables may already be exported.
  }
}

interface Slot {
  /** Provider name in TrueForge. Also the label the pool reports. */
  readonly provider: string;
  /** Model name agents reference. Distinct per slot, so the pool can pick one. */
  readonly model: string;
  readonly envKey: string;
  readonly contextLength: number;
}

/**
 * Gemini's OpenAI-compatible endpoint.
 *
 * Registered as `custom` rather than `google-gemini` for one structural
 * reason: GoogleGeminiModelProvider has no `name`, so TrueForge holds exactly
 * one entry per provider type and three keys cannot coexist. CustomModelProvider
 * does take a name, and Gemini serves an OpenAI-shaped API including tool
 * calling, so three named custom providers give three independently-quota'd
 * models -- which is the whole point of rotating.
 */
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Three slots against the same upstream model.
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
];

async function main(): Promise<void> {
  loadEnv();

  const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const client = new TrueForge({ baseUrl, timeoutInSeconds: 60 });
  const configured: string[] = [];
  const skipped: string[] = [];

  for (const slot of SLOTS) {
    const apiKey = process.env[slot.envKey];
    if (!apiKey) {
      skipped.push(slot.envKey);
      continue;
    }

    // Note the camelCase. The SDK's TypeScript surface is camelCase and it
    // converts to snake_case on the wire; the OpenAPI document shows the wire
    // format. Passing snake_case here is accepted silently and then dropped,
    // which surfaces much later as "the agent has no tools".
    await client.settings.modelProviders.createOrUpdate({
      manifest: {
        type: "custom",
        name: slot.provider,
        baseUrl: GEMINI_OPENAI_BASE_URL,
        auth: { apiKey },
        models: [
          {
            modelId,
            name: slot.model,
            properties: {
              contextLength: slot.contextLength,
              maxOutputTokens: 8192,
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
    console.log("  One key works. Three means a rate limit does not end the demo.");
  }
  console.log(`\n  SCOPE_MODELS=${configured.join(",")}\n`);
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
