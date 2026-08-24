/**
 * Prints named TrueForge component schemas with $refs resolved, so we code
 * against the shapes a live instance actually accepts rather than against prose
 * in the docs. The two have already disagreed once.
 *
 * Usage: node dump-schemas.mjs [spec.json] [SchemaName ...]
 */
import { readFileSync } from "node:fs";

const [, , specPath = "/tmp/tf-spec.json", ...requested] = process.argv;
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const schemas = spec.components?.schemas ?? {};

const DEFAULTS = [
  "AgentSpec",
  "UserToolApprovalEvent",
  "UserToolResponseEvent",
  "UserMessage",
  "MCPServerHeaderAuth",
  "MCPServerDcrAuth",
];

const names = requested.length > 0 ? requested : DEFAULTS;

function resolve(node, depth = 0, stack = new Set()) {
  if (node == null) return null;
  if (depth > 6) return "…";

  if (node.$ref) {
    const name = node.$ref.split("/").pop();
    if (stack.has(name)) return `<recursive ${name}>`;
    const target = schemas[name];
    if (!target) return `<missing ${name}>`;
    const next = new Set(stack);
    next.add(name);
    return resolve(target, depth + 1, next);
  }

  const union = node.anyOf ?? node.oneOf;
  if (union) {
    return { __oneOf: union.map((n) => resolve(n, depth + 1, stack)) };
  }

  if (node.type === "array") return [resolve(node.items ?? {}, depth + 1, stack)];

  if (node.type === "object" || node.properties) {
    const out = {};
    const required = new Set(node.required ?? []);
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      out[required.has(key) ? `${key}*` : key] = resolve(value, depth + 1, stack);
    }
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
      out["[key]"] = resolve(node.additionalProperties, depth + 1, stack);
    }
    return out;
  }

  if (node.const !== undefined) return `const(${node.const})`;
  if (node.enum) return `enum(${node.enum.join("|")})`;
  return node.type ?? "any";
}

for (const name of names) {
  console.log(`\n${"=".repeat(70)}\n${name}`);
  if (!schemas[name]) {
    const near = Object.keys(schemas).filter((k) =>
      k.toLowerCase().includes(name.toLowerCase().slice(0, 6)),
    );
    console.log(`  (not found)${near.length ? ` — similar: ${near.join(", ")}` : ""}`);
    continue;
  }
  console.log(JSON.stringify(resolve(schemas[name]), null, 2));
}
