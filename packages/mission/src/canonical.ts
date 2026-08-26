/**
 * Deterministic JSON, in a module with no Node dependencies.
 *
 * Split out from `record.ts` so the browser can reach it. Verifying a record
 * needs the same canonical form the server hashed, but importing it through
 * the package barrel pulls in `record.ts` -> `@scope-city/proxy` ->
 * `node:crypto`, which fails the browser build outright and would have bloated
 * the bundle with the entire enforcement layer had it merely worked.
 *
 * Nothing here touches a Node API, so the same source is used on both sides --
 * which matters, because two canonicalisers that disagree would make the two
 * hash implementations disagree, and a chain check that quietly accepts
 * altered records is worse than none.
 */

/**
 * Deterministic JSON.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * events hash differently if their keys were assigned in a different order --
 * which happens routinely across a serialisation boundary. Sorting keys makes
 * the hash a function of the content rather than of how the object was built.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
