import {
  exchequerSystem,
  githubRecordsSystem,
  mailpitSystem,
  postHouseSystem,
  recordsSystem,
  stripeSystem,
  type SystemDefinition,
  forgeSystem,
} from "@scope-city/mcp";

/**
 * Which implementation of each district the process runs against.
 *
 * One place, so the resolver, the mission and the headless run cannot disagree
 * about what the agent is talking to. They previously each constructed their
 * own systems, which was fine while everything was a fixture and becomes a
 * quiet bug the moment one of them is real: a scope derived by reading Stripe
 * and then executed against a fixture would be built from one world and
 * enforced in another.
 *
 * The Exchequer is real when a Stripe test key is configured. Nothing else in
 * the codebase changes shape -- the office specs, the evaluator, the projector,
 * the ledger and the countersign are untouched. That containment is the
 * architecture's strongest claim, and this function is the whole of the switch
 * that demonstrates it.
 */

const STRIPE_API_KEY = process.env.STRIPE_API_KEY ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? "";
const MAILPIT_HOST = process.env.MAILPIT_HOST ?? "";
const MAILPIT_PORT = Number(process.env.MAILPIT_PORT ?? 1025);

/**
 * Forces every district to its fixture, whatever else is configured.
 *
 * Documented in the README as the way a stranger runs the whole demo with no
 * accounts, and load-bearing for the test suite: a unit test that quietly
 * reaches Stripe because a key happened to be in `.env` is slow, flaky, and
 * writes to somebody's account. Vitest sets this, so the suite cannot make a
 * network call by accident no matter what the environment holds.
 */
const FIXTURES_ONLY =
  process.env.SCOPE_FIXTURES === "true" || process.env.VITEST !== undefined;

/** True when the Exchequer is talking to Stripe rather than a fixture. */
export function exchequerIsLive(): boolean {
  if (FIXTURES_ONLY) return false;
  // Test keys only. A live key here would refund real money on a countersign
  // meant to demonstrate that refunding real money is hard, which is a joke
  // nobody would find funny twice.
  return STRIPE_API_KEY.includes("_test_");
}

/**
 * True when the Post House hands mail to a real SMTP server.
 *
 * Off unless a host is configured, because the fixture has to stay the default:
 * a fresh clone with no Mailpit running must not fail its first mission on a
 * connection refused, and mail is the one office the poisoned-ticket scenario
 * depends on reaching.
 */
export function postHouseIsLive(): boolean {
  if (FIXTURES_ONLY) return false;
  return MAILPIT_HOST !== "";
}

/** True when Records is backed by a real GitHub Issues repository. */
export function recordsIsLive(): boolean {
  if (FIXTURES_ONLY) return false;
  if ((GITHUB_TOKEN === "") !== (GITHUB_REPOSITORY === "")) {
    throw new Error("GitHub Records needs both GITHUB_TOKEN and GITHUB_REPOSITORY");
  }
  return GITHUB_TOKEN !== "";
}

/**
 * True when the Forge is connected to GitHub's own MCP server.
 *
 * Off unless asked for. It starts a subprocess and holds a token, and a fresh
 * clone must not need either to run the demo -- but when it is on, the boundary
 * is being enforced over a server nobody here wrote, which is the only way to
 * show it is a boundary rather than three careful implementations.
 */
export function forgeIsLive(): boolean {
  if (FIXTURES_ONLY) return false;
  return process.env.FORGE_REPOSITORY !== undefined && GITHUB_TOKEN !== "";
}

/**
 * The systems, including any that have to be connected to rather than
 * constructed.
 *
 * Separate from `missionSystems` because a district behind somebody else's MCP
 * server cannot be built synchronously: it has to start the process, ask what
 * tools exist, and refuse at startup if an office names one that does not. The
 * synchronous list stays for the scripted paths, which have nothing to connect
 * to and should not have to await anything.
 */
export async function missionSystemsAsync(): Promise<readonly SystemDefinition[]> {
  const local = missionSystems();
  if (!forgeIsLive()) return local;

  const [owner, repo] = (process.env.FORGE_REPOSITORY ?? "").split("/");
  if (!owner || !repo) {
    throw new Error('FORGE_REPOSITORY must look like "owner/repo"');
  }

  return [...local, await forgeSystem({ owner, repo, token: GITHUB_TOKEN })];
}

export function missionSystems(): readonly SystemDefinition[] {
  return [
    recordsIsLive()
      ? githubRecordsSystem({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY })
      : recordsSystem(),
    exchequerIsLive() ? stripeSystem({ apiKey: STRIPE_API_KEY }) : exchequerSystem(),
    postHouseIsLive()
      ? mailpitSystem({ host: MAILPIT_HOST, port: MAILPIT_PORT })
      : postHouseSystem(),
  ];
}

/** One line for the startup log, so which world this is running against is never a guess. */
export function systemsSummary(): string {
  const records = recordsIsLive() ? `GitHub ${GITHUB_REPOSITORY}` : "fixture";
  const exchequer = exchequerIsLive() ? "Stripe test mode" : "fixture";
  const post = postHouseIsLive() ? `Mailpit ${MAILPIT_HOST}:${MAILPIT_PORT}` : "fixture";
  if (FIXTURES_ONLY && (STRIPE_API_KEY !== "" || GITHUB_TOKEN !== "" || GITHUB_REPOSITORY !== "")) {
    return "Systems: all fixtures — SCOPE_FIXTURES is set, so external credentials are ignored";
  }
  const forge = forgeIsLive() ? ` · The Forge (GitHub MCP, ${process.env.FORGE_REPOSITORY})` : "";
  return `Systems: Records (${records}) · Exchequer (${exchequer}) · Post House (${post})${forge}`;
}
