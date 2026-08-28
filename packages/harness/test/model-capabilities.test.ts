import { describe, expect, it } from "vitest";
import { reasoningEffortsByModel } from "../src/index.js";

/**
 * Not every model takes a reasoning effort, and the ones that do not refuse the
 * request rather than ignoring it. A local Qwen behind Ollama answers one with
 * `400 "qwen2.5:3b" does not support thinking`, so an effort the operator chose
 * turns a working mission into a failed launch unless the control plane knows
 * which models will accept it.
 */
describe("reading what each model accepts", () => {
  it("reports the efforts a model declares", () => {
    const map = reasoningEffortsByModel([
      { name: "gemini-a/flash-a", properties: { reasoning_efforts: ["low", "medium", "high"] } },
    ]);

    expect(map.get("gemini-a/flash-a")).toEqual(["low", "medium", "high"]);
  });

  it("reports an empty list for a model that declares none", () => {
    // Distinct from "unknown". A model present in the listing with no efforts
    // has told us it takes none, and the control plane should believe it.
    const map = reasoningEffortsByModel([{ name: "local/qwen", properties: {} }]);

    expect(map.get("local/qwen")).toEqual([]);
    expect(map.has("local/qwen")).toBe(true);
  });

  it("accepts either spelling, because both arrive", () => {
    // The wire format is snake_case and the SDK converts to camelCase; which
    // one turns up depends on the path a listing took to get here.
    const snake = reasoningEffortsByModel([
      { name: "a/b", properties: { reasoning_efforts: ["high"] } },
    ]);
    const camel = reasoningEffortsByModel([
      { name: "a/b", properties: { reasoningEfforts: ["high"] } },
    ]);

    expect(snake.get("a/b")).toEqual(["high"]);
    expect(camel.get("a/b")).toEqual(["high"]);
  });

  it("drops unqualified names, as the name reader does", () => {
    // An unqualified name is rejected by the harness at session creation, so
    // carrying one here would put a model in the map that can never be used.
    const map = reasoningEffortsByModel([
      { name: "flash", properties: { reasoning_efforts: ["high"] } },
      { name: "gemini-a/flash-a", properties: { reasoning_efforts: ["high"] } },
    ]);

    expect(map.has("flash")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("falls back to id when name is absent", () => {
    const map = reasoningEffortsByModel([{ id: "provider/model", properties: {} }]);
    expect(map.has("provider/model")).toBe(true);
  });
});
