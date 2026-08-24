import { readFileSync } from "node:fs";

/**
 * Load the repository's optional .env before runtime constants are evaluated.
 *
 * Node does not load .env files by itself and the demo intentionally avoids a
 * runtime dependency for eight lines of parsing. Exported shell variables win,
 * which keeps CI and deployed environments authoritative.
 */
try {
  const text = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // Optional: production and CI normally inject variables directly.
}
