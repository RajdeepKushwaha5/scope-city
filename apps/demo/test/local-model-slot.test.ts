import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A local model in the pool is the clearest demonstration that enforcement does
 * not depend on trusting the model: the scope, the proxy, the ledger and the
 * gate are identical whether the agent is Gemini or a Qwen on a laptop.
 *
 * It only works if the differences between them are handled honestly.
 */
const setup = readFileSync(
  fileURLToPath(new URL("../src/setup-models.ts", import.meta.url)),
  "utf8",
);
const server = readFileSync(
  fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
  "utf8",
);

describe("the local slot", () => {
  it("is off unless a host is configured", () => {
    // A fresh clone with nothing listening on 11434 must not fail model
    // discovery on a slot nobody asked for.
    expect(setup).toContain("const OLLAMA_HOST = process.env.OLLAMA_HOST");
    expect(setup).toMatch(/OLLAMA_HOST\s*\?\s*\[/);
  });

  it("does not require a credential a local endpoint has no use for", () => {
    expect(setup).toContain("keyOptional");
    expect(setup).toContain("!apiKey && !slot.keyOptional");
  });

  it("declares no reasoning efforts, and omits the field rather than sending an empty one", () => {
    // TrueForge refuses `reasoning_efforts: []` outright -- at least one entry
    // or absent. Absent is the honest encoding for a model that takes none.
    expect(setup).toContain("efforts.length > 0 ? { reasoningEfforts: efforts } : {}");
  });

  it("carries its own base url and model id rather than the shared ones", () => {
    expect(setup).toContain("slot.baseUrl ?? GEMINI_OPENAI_BASE_URL");
    expect(setup).toContain("slot.modelId ?? sharedModelId");
  });
});

describe("the effort is not sent to a model that would refuse it", () => {
  it("drops it when the model declares it does not take one", () => {
    // Ollama answers a reasoning effort with 400, and TrueForge refuses it with
    // 422 before that. Either way the operator did nothing wrong and their
    // mission fails at launch.
    expect(server).toContain("const effortFor =");
    expect(server).toContain("supported.includes(wanted) ? wanted : undefined");
  });

  it("passes it through when the model is unknown to discovery", () => {
    // Discovery is best-effort. Guessing "unsupported" for a model we simply
    // failed to read would silently drop an effort that works.
    expect(server).toContain("if (supported === undefined) return wanted");
  });

  it("survives discovery failing entirely", () => {
    expect(server).toContain("await driver.listModelCapabilities()");
    expect(server).toMatch(/catch\s*\{[\s\S]{0,120}pool still works without it/);
  });
});
