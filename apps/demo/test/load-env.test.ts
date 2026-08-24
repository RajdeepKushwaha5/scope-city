import { describe, expect, it } from "vitest";
import { applyEnv } from "../src/load-env.js";

describe("applyEnv", () => {
  it("preserves an explicitly exported empty value", () => {
    const env: NodeJS.ProcessEnv = { SCOPE_PROXY_BIND: "" };

    applyEnv("SCOPE_PROXY_BIND=0.0.0.0\nSCOPE_MODELS=gemini-a/flash-a", env);

    expect(env.SCOPE_PROXY_BIND).toBe("");
    expect(env.SCOPE_MODELS).toBe("gemini-a/flash-a");
  });

  it("parses comments, whitespace, and quoted values", () => {
    const env: NodeJS.ProcessEnv = {};

    applyEnv("# local config\n MODEL = 'gemini-2.5-flash' \n", env);

    expect(env.MODEL).toBe("gemini-2.5-flash");
  });
});
