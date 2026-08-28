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
    expect(setup).toContain('const host = process.env.OLLAMA_HOST ?? ""');
    expect(setup).toContain("if (!host) return [];");
  });

  it("uses the shared env loader rather than a copy of it", () => {
    // This file had its own eight-line .env parser, and that copy still keyed
    // precedence on truthiness: an explicitly exported `OLLAMA_HOST=` was
    // treated as absent and replaced by the .env value, so the operator could
    // turn the local model on but not off. The shared loader had already been
    // fixed to key on presence; the duplicate never got the fix.
    expect(setup).toContain('import "./load-env.js"');
    expect(setup).not.toContain("function loadEnv");
    expect(setup).not.toContain("readFileSync");
  });

  it("reads the environment after .env is loaded, not at import", () => {
    // `.env` is loaded by main, so a module-level read sees nothing -- which
    // made the documented way of configuring this the one way that did not
    // work. It looked fine to anyone who had already exported the variable.
    expect(setup).toContain("function localSlots()");
    expect(setup).toContain("...localSlots()");
    expect(setup).not.toMatch(/^const OLLAMA_/m);
  });

  it("takes its credential from a credential variable, not the endpoint", () => {
    // Naming OLLAMA_HOST as the key passed the URL itself as the API key and
    // made the fallback unreachable: harmless against Ollama, which ignores
    // it, and wrong for any endpoint that actually checks one.
    expect(setup).toContain('envKey: "OLLAMA_API_KEY"');
    expect(setup).not.toContain('envKey: "OLLAMA_HOST"');
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

describe("an empty pool is not the same as a broken harness", () => {
  it("tells the two apart before falling back", () => {
    // Filtering the local provider out of discovery created a third outcome:
    // discovery succeeded and found nothing to rotate onto. Treating that as a
    // failure substituted the hard-coded gemini-a/flash-a, so a machine with
    // only a local model registered started normally and pointed every mission
    // at a model the harness has never heard of.
    expect(server).toContain("let discovered = false;");
    expect(server).toContain("discovered ? [] : [\"gemini-a/flash-a\"]");
  });

  it("says the pool is empty rather than inventing one", () => {
    // The server still boots -- a control plane that cannot start cannot tell
    // anyone what is wrong -- but it has to say so.
    expect(server).toContain("none discovered");
    expect(server).toMatch(/Discovery found nothing to rotate onto/);
    expect(server).toMatch(/Set SCOPE_MODELS to name it/);
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

  it("keeps the operator's turn budget when the effort is dropped", () => {
    // Two settings that share an input: the effort is the provider's, the
    // budget is ours. Letting the spec infer the budget from the filtered
    // effort gave every local-model run the high ceiling however the operator
    // had set it, while the brief went on promising the smaller number.
    expect(server).toMatch(
      /iterationLimit: iterationLimitFor\(live\.reasoningEffort\),[\s\S]{0,600}?instructions: missionBrief/,
    );
  });

  it("survives discovery failing entirely", () => {
    expect(server).toContain("await driver.listModelCapabilities()");
    expect(server).toMatch(/catch\s*\{[\s\S]{0,120}pool still works without it/);
  });
});
