import { describe, expect, it } from "vitest";
import { flattenMcpResult, mapArgs } from "../src/systems/upstream-mcp.js";

/**
 * The two pure decisions in fronting somebody else's MCP server.
 *
 * The connection itself is exercised separately against a real server; these
 * are the parts that decide what the evaluator and the projector get to see,
 * and they are worth testing without a subprocess.
 */

describe("flattening an MCP result", () => {
  it("returns a JSON object as itself", () => {
    // The common case, and the only one where projection can do its job:
    // subtraction from a declared set of fields needs there to be fields.
    const result = { content: [{ type: "text", text: '{"number":7,"title":"Fix the gate"}' }] };
    expect(flattenMcpResult(result)).toEqual({ number: 7, title: "Fix the gate" });
  });

  it("joins several text blocks before parsing", () => {
    const result = {
      content: [
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ],
    };
    expect(flattenMcpResult(result)).toEqual({ a: 1 });
  });

  it("keeps prose as one declared field rather than pretending it has none", () => {
    /*
     * The honest limitation. A scope cannot redact inside an opaque string, so
     * an office whose upstream answers in prose has exactly one field and it is
     * free text. Saying so lets the office spec declare it and the resolver
     * refuse to read it; inventing structure here would let an injected
     * instruction through a field nobody knew existed.
     */
    const result = { content: [{ type: "text", text: "no issue by that number" }] };
    expect(flattenMcpResult(result)).toEqual({ text: "no issue by that number" });
  });

  it("does not hand the projector an array", () => {
    // The projector's contract is a record. A JSON array parses fine and has no
    // fields to subtract, so it stays addressable under a declared name.
    const result = { content: [{ type: "text", text: "[1,2,3]" }] };
    const flat = flattenMcpResult(result);
    expect(Array.isArray(flat)).toBe(false);
    expect(flat.parsed).toEqual([1, 2, 3]);
  });

  it("survives a server that returns no content at all", () => {
    expect(flattenMcpResult({})).toEqual({ text: "" });
    expect(flattenMcpResult({ content: [] })).toEqual({ text: "" });
  });

  it("ignores blocks that are not text", () => {
    const result = {
      content: [
        { type: "image", data: "..." },
        { type: "text", text: '{"ok":true}' },
      ],
    };
    expect(flattenMcpResult(result)).toEqual({ ok: true });
  });
});

describe("mapping arguments onto the upstream's names", () => {
  it("passes everything through when there is nothing to rename", () => {
    expect(mapArgs({ issue_number: 7 }, {})).toEqual({ issue_number: 7 });
  });

  it("renames what is declared", () => {
    expect(mapArgs({ issue_id: 7 }, { argMap: { issue_id: "issue_number" } })).toEqual({
      issue_number: 7,
    });
  });

  it("drops everything that is not declared", () => {
    /*
     * The reason this is a map rather than a spread.
     *
     * The evaluator already refuses an undeclared argument, and this is the
     * second half of that: a server that grows a `force` parameter next week
     * cannot acquire the ability to use it just because the agent guessed the
     * name. Authority over an upstream is the set of arguments named here, and
     * it does not widen when the upstream does.
     */
    expect(
      mapArgs({ issue_id: 7, force: true }, { argMap: { issue_id: "issue_number" } }),
    ).toEqual({ issue_number: 7 });
  });

  it("omits a declared argument the caller did not supply", () => {
    expect(mapArgs({}, { argMap: { issue_id: "issue_number" } })).toEqual({});
  });

  it("supplies the arguments the office fixes for itself", () => {
    // Where most of the authority lives. The agent's whole say over this office
    // is an issue number; the repository is not its to choose.
    expect(
      mapArgs({ issue_number: 7 }, { fixedArgs: { owner: "octocat", repo: "hello" } }),
    ).toEqual({ issue_number: 7, owner: "octocat", repo: "hello" });
  });

  it("does not let a caller overwrite a fixed argument", () => {
    /*
     * The property that makes fixing them worth anything. An agent naming
     * `repo` reaches every repository the token can see, and `state: "open"`
     * reopens what a human just closed. Fixed wins, whatever arrives.
     */
    expect(
      mapArgs(
        { issue_number: 7, repo: "somebody-elses", state: "open" },
        { fixedArgs: { owner: "octocat", repo: "hello", state: "closed" } },
      ),
    ).toEqual({ issue_number: 7, owner: "octocat", repo: "hello", state: "closed" });
  });

  it("does not let a caller reach a fixed argument through the map either", () => {
    expect(
      mapArgs(
        { mine: "somebody-elses" },
        { argMap: { mine: "repo" }, fixedArgs: { repo: "hello" } },
      ),
    ).toEqual({ repo: "hello" });
  });

  it("sends a number where the upstream wants a number", () => {
    // A scope names resources as strings, because that is what the operator
    // wrote. `get_issue` wants 7, and answers "7" with a schema error.
    expect(mapArgs({ issue_number: "7" }, { numericArgs: ["issue_number"] })).toEqual({
      issue_number: 7,
    });
  });

  it("leaves a value alone when it is not a number at all", () => {
    // Better a legible refusal from the upstream than a silent NaN.
    expect(mapArgs({ issue_number: "seven" }, { numericArgs: ["issue_number"] })).toEqual({
      issue_number: "seven",
    });
  });
});
