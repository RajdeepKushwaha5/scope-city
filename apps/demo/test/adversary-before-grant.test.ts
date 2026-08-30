import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { textAt } from "../src/adversary.js";

const server = readFileSync(
  fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
  "utf8",
);
const adversary = readFileSync(
  fileURLToPath(new URL("../src/adversary.ts", import.meta.url)),
  "utf8",
);

/**
 * The feature's whole claim is in its ordering: the scope is attacked *before*
 * anyone grants it.
 *
 * The pass runs unawaited so the operator can read the scope while a local
 * model writes attacks against it. That is right for the proposal and wrong for
 * the grant -- an operator who clicks quickly handed over authority while the
 * attacks were still being written, and the completion guard then dropped them
 * for arriving at a mission that had moved on. A pass whose findings are
 * discarded is worse than no pass, because the panel says it ran.
 */
describe("the attacks finish before the grant does", () => {
  it("does not let the grant proceed while the pass is still running", () => {
    expect(server).toContain("if (mission.adversary) {");
    expect(server).toContain("mission.adversary.then(() => true)");
  });

  it("bounds that wait, so a model that never answers cannot freeze a mission", () => {
    // The Yard informs the decision. It must not become a way to prevent one.
    //
    // Above the pass's own ceiling, not below it: reading nested evidence makes
    // the prompt larger and the pass slower (25s measured against qwen2.5:7b
    // with six fields), and a wait that expires before the work it waits for is
    // the race this guard was written to close.
    expect(server).toContain("GRANT_WAIT_MS");
    expect(server).toMatch(/ADVERSARY_GRANT_WAIT_MS \?\? 60_000/);
  });

  it("shows a late finding before the grant rather than after", () => {
    // They granted on the strength of a report that did not contain it. An
    // over-reach caught before the grant is the only kind that costs nothing.
    expect(server).toContain("grantedOnce");
    expect(server).toContain("read it and grant again to proceed");
  });

  it("refuses only once, because the second grant is an answer", () => {
    // The Yard does not get to overrule the operator; it gets to inform them.
    expect(server).toContain("grantedOnce.add(mission.id)");
    expect(server).toContain("!grantedOnce.has(mission.id)");
  });
});

/**
 * The prompt has to stay on this machine, and the endpoint check only covers
 * the address that is dialled.
 */
describe("keeping the prompt on the machine that wrote it", () => {
  it("refuses to follow a redirect out of the request", () => {
    // `fetch` follows redirects by default, so a loopback endpoint answering
    // 307 re-sends the POST body -- ticket evidence included -- to wherever it
    // points. The guarantee is about where the request ends, not where it
    // starts.
    expect(adversary).toContain('redirect: "error"');
  });

  it("does not treat an offloaded model as a local one", () => {
    // Ollama can run a model in its cloud and still list it on 127.0.0.1,
    // marked with `remote_model` or `remote_host`. Dialling loopback and
    // calling that local would send the customer's ticket to somebody else's
    // GPU while the comments here claimed it could not.
    expect(adversary).toContain("m.remote_model !== undefined");
    expect(adversary).toContain("m.remote_host !== undefined");
  });

  it("bounds the discovery request as well as the chat one", () => {
    // The chat deadline starts after discovery returns, so a loopback server
    // that accepts and never answers left the pass pending with no timer and
    // no declined report.
    expect(adversary).toContain("DISCOVERY_MS");
    expect(adversary).toContain("AbortSignal.timeout(DISCOVERY_MS)");
  });

  it("bounds each evidence read", () => {
    // These handlers reach live systems, and ADVERSARY_MS only ever wrapped the
    // model request that comes afterwards.
    expect(adversary).toContain("withDeadline(");
    expect(adversary).toContain("EVIDENCE_MS");
  });
});

/**
 * `freeTextFields` names paths as the registry declares them, and the registry
 * declares nested ones.
 */
describe("reading the evidence the registry actually points at", () => {
  it("finds nothing at a path that is not there", () => {
    expect(
      textAt({ customer: { email: "a@b.test" } }, "customer.address"),
    ).toEqual([]);
    expect(textAt(null, "customer.address")).toEqual([]);
    expect(textAt({ customer: "not an object" }, "customer.address")).toEqual(
      [],
    );
  });

  it("ignores a value that is not text", () => {
    expect(textAt({ customer: { age: 41 } }, "customer.age")).toEqual([]);
    expect(textAt({ body: "   " }, "body")).toEqual([]);
  });

  it("does not put an unbounded collection into a prompt", () => {
    // This is assembled into a model's context window, so a long history has to
    // stop somewhere chosen rather than wherever the data ends.
    const history = Array.from({ length: 50 }, (_, i) => `purchase ${i}`);
    expect(textAt({ customer: { history } }, "customer.history")).toHaveLength(
      5,
    );
  });

  it("does not put an unbounded string into one either", () => {
    expect(textAt({ body: "x".repeat(10_000) }, "body")[0]!.length).toBe(2_000);
  });

  // --- and the evidence it does find ---------------------------------------

  it("reads a nested string the registry declares by path", () => {
    // The case that was silently dropped: `customer.address` is a dotted path
    // in the registry and a nested value in the handler's result, so a literal
    // lookup found nothing and the adversary reported no holes having seen no
    // evidence.
    expect(
      textAt({ customer: { address: "12 Example St" } }, "customer.address"),
    ).toEqual(["12 Example St"]);
  });

  it("reads a nested collection", () => {
    expect(
      textAt(
        { customer: { history: ["bought a hat", "returned it"] } },
        "customer.history",
      ),
    ).toEqual(["bought a hat", "returned it"]);
  });

  it("still reads a plain top-level field", () => {
    expect(textAt({ body: "please refund me" }, "body")).toEqual([
      "please refund me",
    ]);
  });
});
