import { afterEach, describe, expect, it } from "vitest";
import { publicOllamaHost } from "../src/setup-models.js";

/**
 * Which address TrueForge is told to reach Ollama at.
 *
 * `OLLAMA_HOST` is where *this* process reaches Ollama. What gets registered is
 * where *TrueForge* has to reach it, and those are different machines the moment
 * the harness is in a container.
 *
 * The bug this covers was created by the change that documented the override.
 * `.env.example` now ships `OLLAMA_PUBLIC_HOST=` as a blank placeholder, and a
 * blank is *present*, not absent -- so `??` selected the empty string and the
 * provider was registered at `/v1`, a relative URL that reaches nothing. The
 * common path was the broken one: copy the example, fill in `OLLAMA_HOST`,
 * leave the optional line alone.
 */
describe("resolving the address the harness is given", () => {
  const before = process.env.OLLAMA_PUBLIC_HOST;

  afterEach(() => {
    if (before === undefined) delete process.env.OLLAMA_PUBLIC_HOST;
    else process.env.OLLAMA_PUBLIC_HOST = before;
  });

  it("treats the blank placeholder as no override", () => {
    // The `.env.example` line, verbatim: `OLLAMA_PUBLIC_HOST=`.
    process.env.OLLAMA_PUBLIC_HOST = "";
    expect(publicOllamaHost("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("treats whitespace as no override either", () => {
    // A trailing space after `=` in an env file is invisible and would
    // otherwise register a base URL of ` /v1`.
    process.env.OLLAMA_PUBLIC_HOST = "   ";
    expect(publicOllamaHost("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("never returns something that cannot be a base URL", () => {
    // The failure was silent in both directions: the provider saved, the model
    // appeared in TrueForge's picker, and every request died at connect.
    process.env.OLLAMA_PUBLIC_HOST = "";
    expect(`${publicOllamaHost("http://127.0.0.1:11434")}/v1`).not.toBe("/v1");
  });

  // --- and when an override is actually given ------------------------------

  it("uses the override when there is one", () => {
    process.env.OLLAMA_PUBLIC_HOST = "http://host.docker.internal:11434";
    expect(publicOllamaHost("http://127.0.0.1:11434")).toBe(
      "http://host.docker.internal:11434",
    );
  });

  it("falls back when the variable is not set at all", () => {
    delete process.env.OLLAMA_PUBLIC_HOST;
    expect(publicOllamaHost("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434",
    );
  });
});
