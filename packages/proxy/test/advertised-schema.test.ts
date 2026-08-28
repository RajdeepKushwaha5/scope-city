import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * What the tool listing tells the model an office accepts.
 *
 * The evaluator refuses a call carrying an argument the office does not
 * declare, and that rule has to be visible in the schema the model reads.
 * Enforcing a constraint the tool description never stated produces a refusal
 * the agent cannot anticipate, and an agent that cannot anticipate a refusal
 * retries rather than corrects.
 *
 * Read from source because the server builds this inside a request handler and
 * the helper is not exported -- the alternative is standing up an MCP server
 * and a mission to assert one JSON key.
 */
const server = readFileSync(
  fileURLToPath(new URL("../src/server.ts", import.meta.url)),
  "utf8",
);

describe("the schema advertised for each office", () => {
  it("says no other arguments are accepted", () => {
    expect(server).toContain("additionalProperties: false");
  });

  it("declares that in the return type, not just the value", () => {
    // A literal `false` in the object with a widened type would let a later
    // edit change it to `true` without anything failing.
    expect(server).toMatch(/additionalProperties:\s*false;/);
  });

  it("still lists the office's own arguments", () => {
    // Closing the schema must not become advertising nothing.
    expect(server).toContain("properties[name]");
    expect(server).toContain("required.push(name)");
  });
});
