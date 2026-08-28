import { describe, expect, it } from "vitest";
import { rotationCandidates } from "../src/index.js";

const HOSTED = [
  "gemini-a/flash-a",
  "gemini-b/flash-b",
  "gemini-c/flash-c",
  "gemini-d/flash-d",
];

/**
 * Rotation exists to survive a cooling key and treats every registered model as
 * interchangeable. That holds for four keys against the same Gemini. It does
 * not hold for a 7B on a laptop, and the way it failed was quiet: nothing broke,
 * the mission simply rotated onto the local model and became something nobody
 * would sit and watch.
 */
describe("what discovery may pick on its own", () => {
  it("does not offer a local model as a fallback", () => {
    expect(rotationCandidates([...HOSTED, "local/qwen"])).toEqual(HOSTED);
  });

  it("leaves the hosted models alone", () => {
    expect(rotationCandidates(HOSTED)).toEqual(HOSTED);
  });

  it("keeps the order it was given", () => {
    // The pool takes priority from position, so reordering here would silently
    // change which key a mission prefers.
    const mixed = ["gemini-a/flash-a", "local/qwen", "gemini-b/flash-b"];

    expect(rotationCandidates(mixed)).toEqual(["gemini-a/flash-a", "gemini-b/flash-b"]);
  });

  it("can return nothing, and says so by being empty", () => {
    // A machine with only a local model registered discovers no rotation
    // candidates. That is the honest answer: the caller then reports that no
    // model is configured rather than quietly using one nobody asked for.
    expect(rotationCandidates(["local/qwen"])).toEqual([]);
  });

  it("is not fooled by a model whose name merely contains the word", () => {
    // The provider is the part before the slash. A hosted model called
    // "local-llm/thing" is somebody's provider name, not our opt-in marker.
    expect(rotationCandidates(["local-llm/thing"])).toEqual(["local-llm/thing"]);
    expect(rotationCandidates(["vendor/local"])).toEqual(["vendor/local"]);
  });
});
