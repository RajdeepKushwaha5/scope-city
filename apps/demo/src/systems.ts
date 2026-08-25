import {
  exchequerSystem,
  postHouseSystem,
  recordsSystem,
  stripeSystem,
  type SystemDefinition,
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

export function missionSystems(): readonly SystemDefinition[] {
  return [
    recordsSystem(),
    exchequerIsLive() ? stripeSystem({ apiKey: STRIPE_API_KEY }) : exchequerSystem(),
    postHouseSystem(),
  ];
}

/** One line for the startup log, so which world this is running against is never a guess. */
export function systemsSummary(): string {
  if (exchequerIsLive()) {
    return "Systems: Records (fixture) · Exchequer (Stripe test mode) · Post House (fixture)";
  }
  if (FIXTURES_ONLY && STRIPE_API_KEY !== "") {
    return "Systems: all fixtures — SCOPE_FIXTURES is set, so the Stripe key is ignored";
  }
  return "Systems: all fixtures — set STRIPE_API_KEY to make the Exchequer real";
}
