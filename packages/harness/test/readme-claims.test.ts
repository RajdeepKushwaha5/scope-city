import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The README's "How TrueForge is used" table is the case for the harness being
 * load-bearing rather than a wrapper. A judge reads it and then looks at the
 * files it cites, so a claim that has quietly stopped being true is worse than
 * one that was never made.
 */
const root = new URL("../../../", import.meta.url);
const readme = readFileSync(fileURLToPath(new URL("README.md", root)), "utf8");
const table = readme.slice(
  readme.indexOf("## How TrueForge is used"),
  readme.indexOf("## Repository layout"),
);

describe("the README's harness claims", () => {
  it("names all five capabilities the project depends on", () => {
    for (const capability of [
      "Real tools over MCP",
      "Sandboxed code",
      "Human approval gates",
      "Subagents",
      "Session persistence",
    ]) {
      expect(table, `${capability} is not claimed`).toContain(capability);
    }
  });

  it("cites files that exist", () => {
    // Every path the table points at, checked. A broken reference in the one
    // section written for someone auditing the claims is the worst place for it.
    const paths = [...table.matchAll(/`((?:packages|apps|mcp|docs)\/[A-Za-z0-9/._-]+)`/g)].map(
      (m) => m[1]!,
    );

    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) {
      expect(existsSync(fileURLToPath(new URL(path, root))), `${path} does not exist`).toBe(true);
    }
  });

  it("counts the harness event types correctly", () => {
    // The table says eleven are translated into what the city draws.
    const translate = readFileSync(
      fileURLToPath(new URL("packages/harness/src/translate.ts", root)),
      "utf8",
    );
    const kinds = new Set([...translate.matchAll(/case "([a-z._]+)"/g)].map((m) => m[1]!));

    const claimed = /(\w+) harness event types/.exec(table)?.[1];
    expect(claimed, "the count is not stated").toBeDefined();
    expect(claimed).toBe("Eleven");
    expect(kinds.size).toBe(11);
  });

  it("claims two harness options that the driver actually sets", () => {
    const driver = readFileSync(
      fileURLToPath(new URL("packages/harness/src/driver.ts", root)),
      "utf8",
    );

    expect(driver).toContain("requireApprovalForTools");
    expect(driver).toContain("dynamicSubAgents");
  });

  it("discloses the use of AI coding assistants, as the rules require", () => {
    // "AI coding assistants are allowed, but their use must be disclosed."
    expect(readme).toMatch(/AI coding assistants?/i);
  });

  it("keeps the section the submission rules require", () => {
    expect(readme).toContain("## Qodo Code Review Evidence");
  });
});
