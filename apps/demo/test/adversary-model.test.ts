import { describe, expect, it } from "vitest";
import { billionsOf, chooseAdversaryModel } from "../src/adversary.js";

/**
 * Which local model writes the attacks.
 *
 * This used to fall back to `OLLAMA_MODEL`, which is the model the *mission
 * agent* runs on. That is a different job which happens to share a machine, and
 * the coincidence cost something real: the worker is picked for a fast turn, so
 * the adversary wrote its attacks with the smallest model on the box while a
 * larger one sat pulled and idle.
 */
describe("choosing the model that writes the attacks", () => {
  const pulled = [
    { name: "llama3.2:latest", billions: 3.2 },
    { name: "qwen2.5:3b", billions: 3.1 },
    { name: "qwen2.5:7b", billions: 7.6 },
  ];

  it("does not fall back to the worker's model", () => {
    // The regression this file exists for. `OLLAMA_MODEL` is not consulted at
    // all now, so a worker chosen for speed cannot quietly become the adversary.
    const picked = chooseAdversaryModel(pulled, "");
    expect(picked?.model).toBe("qwen2.5:7b");
  });

  it("chooses nothing when nothing is pulled", () => {
    // Better than naming a plausible default that is not there: that failure
    // arrives as an opaque 404 at grant time and reads like the Yard is broken.
    expect(chooseAdversaryModel([], "")).toBeUndefined();
  });

  it("says so when the operator names a model that is not pulled", () => {
    // Still used -- they may be about to pull it -- but the reason records that
    // it was not found, so a later `declined` is not a surprise.
    const picked = chooseAdversaryModel(pulled, "qwen2.5:32b");
    expect(picked?.model).toBe("qwen2.5:32b");
    expect(picked?.why).toContain("not pulled");
  });

  it("does not reorder equally sized models between runs", () => {
    // Two models of the same size swapping on restart would make a report look
    // like it changed when nothing did.
    const tie = [
      { name: "b-model", billions: 7 },
      { name: "a-model", billions: 7 },
    ];
    expect(chooseAdversaryModel(tie, "")?.model).toBe("a-model");
    expect(chooseAdversaryModel([...tie].reverse(), "")?.model).toBe("a-model");
  });

  // --- and what it does choose ---------------------------------------------

  it("takes the largest, because the pass is not on the critical path", () => {
    // It runs unawaited while the operator reads the scope, so the extra ten
    // seconds costs nothing and buys attacks worth reading.
    expect(chooseAdversaryModel(pulled, "")?.why).toContain("largest");
  });

  it("obeys an operator who names one, even a smaller one", () => {
    // They know something this does not.
    expect(chooseAdversaryModel(pulled, "qwen2.5:3b")?.model).toBe(
      "qwen2.5:3b",
    );
  });
});

describe("reading a parameter count", () => {
  it("treats an unparseable size as smallest rather than guessing", () => {
    // Zero loses to anything measurable, so a model with no declared size is
    // never chosen over one that has declared it.
    expect(billionsOf(undefined)).toBe(0);
    expect(billionsOf("")).toBe(0);
    expect(billionsOf("huge")).toBe(0);
    expect(billionsOf("7")).toBe(0);
  });

  it("reads the forms Ollama actually reports", () => {
    expect(billionsOf("7.6B")).toBeCloseTo(7.6);
    expect(billionsOf("3.1B")).toBeCloseTo(3.1);
    expect(billionsOf("70B")).toBe(70);
  });

  it("puts millions below billions rather than above them", () => {
    // "500M" sorting above "7.6B" on the raw number would pick the smallest
    // model on the machine while claiming it picked the largest.
    expect(billionsOf("500M")).toBeCloseTo(0.5);
    expect(billionsOf("500M")).toBeLessThan(billionsOf("3.1B"));
  });
});
