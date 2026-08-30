/**
 * Where Ollama is, from two points of view, with no side effects.
 *
 * Its own module because `setup-models.ts` is a CLI: it calls `main()` at the
 * top level, so importing it to reach one pure function runs the whole
 * registration. A unit test that did that would issue real `createOrUpdate`
 * requests against a configured TrueForge and mutate its provider settings --
 * a test suite whose result depends on what is running and what keys are set.
 */

/**
 * The address to register, given the one this process uses.
 *
 * `OLLAMA_HOST` is where *this* process reaches Ollama. What gets registered is
 * where *TrueForge* has to reach it, and those are different machines the moment
 * the harness is in a container: `127.0.0.1` inside it is the container.
 *
 * `??` was wrong here in a way the same change created: `.env.example` ships
 * `OLLAMA_PUBLIC_HOST=` as a documented blank placeholder, and a blank is
 * present rather than absent. So the common path -- copy the example, fill in
 * `OLLAMA_HOST`, leave the optional override alone -- registered the provider
 * at `/v1`, a relative URL that reaches nothing.
 */
export function publicOllamaHost(host: string): string {
  const announced = (process.env.OLLAMA_PUBLIC_HOST ?? "").trim();
  return announced === "" ? host : announced;
}

/**
 * The OpenAI-compatible base URL for a host, trailing slashes and all.
 *
 * Shared by the registration and the line printed about it. They computed it
 * separately, so `http://host:11434/` registered as `.../v1` and printed as
 * `...//v1` -- a diagnostic that disagrees with what it is describing is worse
 * than no diagnostic, because it sends the reader after a difference that is
 * not there.
 */
export function ollamaBaseUrl(host: string): string {
  return `${host.replace(/\/+$/, "")}/v1`;
}
