import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  alreadyWritten,
  flattenMcpResult,
  idempotencyMarker,
  mapArgs,
} from "../src/systems/upstream-mcp.js";

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
    const result = {
      content: [{ type: "text", text: '{"number":7,"title":"Fix the gate"}' }],
    };
    expect(flattenMcpResult(result)).toEqual({
      number: 7,
      title: "Fix the gate",
    });
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
    const result = {
      content: [{ type: "text", text: "no issue by that number" }],
    };
    expect(flattenMcpResult(result)).toEqual({
      text: "no issue by that number",
    });
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
  /*
   * Refusals first, then the cases that pass.
   *
   * The order is the project's checklist and it is not arbitrary here: every
   * test below the line is a way in, and reading the ways-in first makes the
   * pass-through cases look like the exceptions they are rather than the rule.
   */

  it("drops everything that is not declared", () => {
    // The evaluator already refuses an undeclared argument, and this is the
    // second half of that: a server that grows a `force` parameter next week
    // cannot acquire the ability to use it just because the agent guessed the
    // name. Authority over an upstream is the set of arguments named here, and
    // it does not widen when the upstream does.
    expect(
      mapArgs(
        { issue_id: 7, force: true },
        { argMap: { issue_id: "issue_number" } },
      ),
    ).toEqual({ issue_number: 7 });
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
    ).toEqual({
      issue_number: 7,
      owner: "octocat",
      repo: "hello",
      state: "closed",
    });
  });

  it("does not let a caller reach a fixed argument through the map either", () => {
    expect(
      mapArgs(
        { mine: "somebody-elses" },
        { argMap: { mine: "repo" }, fixedArgs: { repo: "hello" } },
      ),
    ).toEqual({ repo: "hello" });
  });

  it("omits a declared argument the caller did not supply", () => {
    expect(mapArgs({}, { argMap: { issue_id: "issue_number" } })).toEqual({});
  });

  it("leaves a value alone when it is not a number at all", () => {
    // Better a legible refusal from the upstream than a silent NaN.
    expect(
      mapArgs({ issue_number: "seven" }, { numericArgs: ["issue_number"] }),
    ).toEqual({
      issue_number: "seven",
    });
  });

  // --- and the cases that pass -------------------------------------------

  it("passes everything through when there is nothing to rename", () => {
    expect(mapArgs({ issue_number: 7 }, {})).toEqual({ issue_number: 7 });
  });

  it("renames what is declared", () => {
    expect(
      mapArgs({ issue_id: 7 }, { argMap: { issue_id: "issue_number" } }),
    ).toEqual({
      issue_number: 7,
    });
  });

  it("supplies the arguments the office fixes for itself", () => {
    // Where most of the authority lives. The agent's whole say over this office
    // is an issue number; the repository is not its to choose.
    expect(
      mapArgs(
        { issue_number: 7 },
        { fixedArgs: { owner: "octocat", repo: "hello" } },
      ),
    ).toEqual({ issue_number: 7, owner: "octocat", repo: "hello" });
  });

  it("sends a number where the upstream wants a number", () => {
    // A scope names resources as strings, because that is what the operator
    // wrote. `get_issue` wants 7, and answers "7" with a schema error.
    expect(
      mapArgs({ issue_number: "7" }, { numericArgs: ["issue_number"] }),
    ).toEqual({
      issue_number: 7,
    });
  });
});

describe("what the upstream is trusted with", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/systems/upstream-mcp.ts", import.meta.url)),
    "utf8",
  );
  const forge = readFileSync(
    fileURLToPath(new URL("../src/systems/forge.ts", import.meta.url)),
    "utf8",
  );

  it("does not hand a third-party subprocess this process's secrets", () => {
    /*
     * It did. `env: { ...process.env, ...options.env }` gave somebody else's
     * server every credential here: the Gemini keys, the Stripe key, the
     * Daytona token, the SMTP settings. The office needs one of them.
     *
     * It is also this project's own argument made one layer down. A scope
     * exists so an agent gets one charge rather than every charge; handing its
     * upstream every secret rather than the one it needs is that same failure
     * with the word "environment" in front of it.
     */
    expect(source, "process.env must not be spread into the child").not.toMatch(
      /env:\s*\{\s*\.\.\.\(?process\.env/,
    );
    expect(source, "the SDK's allowlist is the floor").toContain(
      "getDefaultEnvironment()",
    );
  });

  it("does not return the upstream's own words to the agent", () => {
    /*
     * A refusal goes back to the agent, and a thrown error never passes the
     * projector or the injection scan. Putting the foreign server's text in one
     * gave it a channel around both -- to disclose what it liked, or to write
     * an instruction where nothing was looking.
     */
    expect(source).toContain(
      "throw new UpstreamMcpError(`${office.office} failed upstream`)",
    );
    expect(
      source,
      "the detail belongs in the operator's log, not the response",
    ).toContain("console.error(");
  });

  it("runs a pinned version of a server it hands a write token", () => {
    // `npx -y <name>` with no version fetches and executes whatever that name
    // resolves to today, then receives a GitHub token that can write. Mutable
    // third-party code, outside the lockfile and outside review.
    expect(forge).toMatch(/SERVER_GITHUB_VERSION = "\d{4}\.\d+\.\d+"/);
    expect(forge).toContain(
      "@modelcontextprotocol/server-github@${SERVER_GITHUB_VERSION}",
    );
    expect(forge, "a floating tag is the thing being fixed").not.toMatch(
      /"-y",\s*"@modelcontextprotocol\/server-github"/,
    );
  });
});

describe("making a non-idempotent write safe to retry", () => {
  const key = "op_7f3a";
  const marker = idempotencyMarker(key);

  /*
   * Refusals first. Every test above the line is a duplicate that does not
   * happen; the ones below only say the mechanism does not fire when it should
   * not.
   */

  it("recognises its own marker in what is already there", () => {
    // The retry case: GitHub created the comment, the response was lost, and
    // the boundary is deciding whether to write again.
    expect(
      alreadyWritten(
        [
          {
            body: `Looked into this.

${marker}`,
          },
        ],
        "body",
        marker,
      ),
    ).toBe(true);
  });

  it("finds the marker among other people's comments", () => {
    expect(
      alreadyWritten(
        [
          { body: "any thoughts?" },
          {
            body: `done

${marker}`,
          },
          { body: "thanks" },
        ],
        "body",
        marker,
      ),
    ).toBe(true);
  });

  it("does not mistake a different operation's marker for its own", () => {
    // Two comments on one issue are two actions, and the second must go
    // through. A dedupe that matched on "some marker" would swallow it.
    expect(
      alreadyWritten([{ body: idempotencyMarker("op_other") }], "body", marker),
    ).toBe(false);
  });

  it("says nothing was written when the lookup did not return a list", () => {
    // A malformed lookup must not read as "already done" -- that is a comment
    // silently never sent, which is worse than one sent twice.
    expect(alreadyWritten({ message: "Not Found" }, "body", marker)).toBe(
      false,
    );
    expect(alreadyWritten(undefined, "body", marker)).toBe(false);
  });

  it("ignores an item whose field is not text", () => {
    expect(
      alreadyWritten([{ body: null }, { body: 42 }, {}], "body", marker),
    ).toBe(false);
  });

  // --- and what the marker itself is --------------------------------------

  it("is invisible where it lands", () => {
    // An HTML comment, because GitHub renders one as nothing. The reader sees
    // the agent's sentence; the boundary sees a key it can recognise.
    expect(marker).toBe(`<!-- scope-city:${key} -->`);
  });

  it("carries the operation key, not the attempt", () => {
    // A key per attempt makes every retry a new action, which is the bug.
    expect(idempotencyMarker(key)).toBe(idempotencyMarker(key));
    expect(idempotencyMarker("op_other")).not.toBe(marker);
  });
});
