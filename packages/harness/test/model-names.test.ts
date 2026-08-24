import { describe, expect, it } from "vitest";
import { qualifiedModelNames, type ModelListEntry } from "../src/model-names.js";

/**
 * The payload below is not invented. It is the literal response of
 * `GET /api/v1/models` from a standalone harness with three Gemini keys
 * registered, captured while debugging the single-entry pool this function
 * exists to prevent.
 */
const LIVE_RESPONSE: ModelListEntry[] = [
  { name: "gemini-a/flash-a", model_id: "gemini-2.5-flash" },
  { name: "gemini-b/flash-b", model_id: "gemini-2.5-flash" },
  { name: "gemini-c/flash-c", model_id: "gemini-2.5-flash" },
];

describe("qualifiedModelNames", () => {
  it("reads every model from a real standalone-harness listing", () => {
    expect(qualifiedModelNames(LIVE_RESPONSE)).toEqual([
      "gemini-a/flash-a",
      "gemini-b/flash-b",
      "gemini-c/flash-c",
    ]);
  });

  it("never falls back to model_id, which would collapse the pool", () => {
    // All three entries share one model_id. Reading it would produce a pool of
    // three identical names that rotates onto the same rate-limited credential
    // every time -- the exact failure that looks like rotation working.
    const names = qualifiedModelNames(LIVE_RESPONSE);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain("gemini-2.5-flash");
  });

  it("accepts `id` for a hosted control plane that qualifies it there", () => {
    expect(qualifiedModelNames([{ id: "openai-main/gpt-4o" }])).toEqual(["openai-main/gpt-4o"]);
  });

  it("prefers `name` when a response carries both", () => {
    expect(qualifiedModelNames([{ name: "a/one", id: "b/two" }])).toEqual(["a/one"]);
  });

  it("drops unqualified names rather than repairing them", () => {
    // The harness rejects an unqualified name at session creation, so failing
    // at launch with "no models" beats failing mid-mission on the first turn.
    expect(qualifiedModelNames([{ name: "flash" }, { name: "ok/one" }])).toEqual(["ok/one"]);
  });

  it("survives a listing with missing and malformed entries", () => {
    const messy = [
      {},
      { name: undefined, id: undefined },
      { id: "" },
      { name: "good/one" },
    ] as ModelListEntry[];
    expect(qualifiedModelNames(messy)).toEqual(["good/one"]);
  });

  it("returns nothing for an empty listing, so callers can detect it", () => {
    expect(qualifiedModelNames([])).toEqual([]);
  });
});
