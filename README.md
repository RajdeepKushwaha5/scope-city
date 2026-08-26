# Scope City

**See where your agents can act.**

An isometric city where your connected systems are districts, an AI agent works
in the field, and its authority is drawn on the map as city limits. Watch an
attack go out of scope and stop at the line.

Built on [TrueForge](https://github.com/truefoundry/trueforge), the open-source
agent harness.

---

## The problem

Every agent integration today makes the same mistake: the user has broad access,
so the agent inherits broad access. A support agent that needs to refund one $49
charge is handed an API key that can refund every charge, list every customer,
and email anyone.

The industry's two answers are both weak. **Prompt guardrails** ask the model
nicely and hope; prompt injection defeats them routinely. **Static tool
allowlists** are configured once and forever — too tight and the agent is
useless, too loose and one poisoned support ticket reaches everything.

And when something does go wrong, nobody can answer the simplest question:
*what was it actually able to touch?* Authority lives in JSON blobs, OAuth scope
strings and IAM consoles. It is invisible until it is a postmortem.

## What Scope City does

You state a job. The agent proposes the minimum reach it needs. That proposal is
probed, then shown to you as a **scope** — one order, one charge, one amount, one
recipient, ten minutes. You grant it. From that moment the agent cannot exceed it,
because the tools outside it are not denied to the agent, they are **absent**.

Then the whole thing is drawn as a city, so you can watch it hold.

> We don't tell the agent no. We make the thing unreachable.

## How it works

TrueForge talks to the **scope proxy**, never to Stripe or your mail server. The
agent therefore holds no credential at all, and every call is policed on four
surfaces:

| Surface | Enforcement |
|---|---|
| `tools/list` | Only offices inside the scope are listed. The rest are absent. |
| `tools/call` request | Resource ids, amount ceilings in integer minor units, call budgets, expiry, exact-call fingerprint. |
| `tools/call` response | Projected and redacted to the fields the scope allows, size-capped, scanned for instruction-shaped text. |
| Quota ledger | Atomic compare-and-consume, idempotency keys, replay protection. |

The response surface matters as much as the request surface. An allowed
`charge.get` can legitimately return a customer's entire payment history —
filtering *what you may call* without filtering *what comes back* leaks exactly
the data you thought you had fenced off.

For missions with two independent read paths, the brief requires two real
TrueForge dynamic subagents: a source investigator and a target verifier. Only
their actual `thread.created` events add workers to the city, so a run that
delegates nothing shows nothing.

**Delegation here separates context, not privilege**, and the distinction is
worth being exact about because the looser version would be the overclaim this
project exists to argue against. TrueForge children inherit the session's
tools, and the proxy is given no thread identity, so nothing *stops* a child
calling a mutating office. Asking them to stay read-only is an instruction, and
an instruction is not a boundary.

What holds regardless is the scope. Quota is claimed atomically per mission,
ceilings are per office, and an irreversible call raises the same gate whichever
thread makes it — so a child that tried to act would meet exactly the
enforcement the root meets. The delegation is chosen from offices the registry
proves are non-mutating, which makes a child acting unlikely; the boundary that
makes it *safe* is the one that was there already.

### Two refusals, deliberately different

| | The Gate | The city limits |
|---|---|---|
| Mechanism | TrueForge `tool.approval_required` | The scope proxy |
| Asks a human? | Yes — klaxon, countersign | **Never** |
| Fires when | The action is irreversible | The call falls outside the scope |
| On the map | A gate rises, ceremony, a stamp | The agent stops dead at the line |

That contrast is the whole thesis, rendered.

## Repository layout

```
packages/
  scope/     scope schema, request evaluator, response projector  (pure)
  ledger/    atomic quota claims, idempotency, replay protection  (pure)
  proxy/     the enforcing MCP proxy — decide → claim → countersign → execute → project
  harness/   TrueForge SDK driver, event translation, model rotation
  mission/   countersign binding, mission brief, replayable event log
apps/
  demo/      live control API, SSE replay, fixture mission, TrueForge setup
  city/      clean-room React + Canvas isometric city and operator HUD
mcp/         the demo MCP servers (ticket, payments, mail)
docs/
  TRUEFORGE.md   verified notes on the harness API — read before integrating
```

The scope and ledger packages are the security substrate and have no I/O:
`now` and `consumed` are arguments rather than ambient state, which is what makes
every branch reachable from a test.

## Running it

### Requirements

- **Linux or macOS** for the TrueForge server. On Windows use WSL2 — the
  standalone server segfaults on `win32`.
- Node.js >= 22.13, pnpm 11.10
- **The sandbox is optional, and needs a Daytona key.** TrueForge 0.1.4 accepts
  exactly one sandbox provider — the manifest's `type` enum has a single member,
  `daytona` — so there is no local provider on this version and installing
  `bwrap`, `socat` or `ripgrep` does nothing for it. Set `DAYTONA_API_KEY` and
  `SCOPE_SANDBOX=true` and the control plane configures the provider at boot.

  **Scope the key to three permissions: Sandboxes, Snapshots, Volumes.** A key
  scoped to Sandboxes alone is refused — TrueForge's validation reaches
  further, and Daytona answers 403 on `/api/volumes`, which surfaces as
  "Daytona rejected the API key — check the credentials" and sends you to
  check a credential that works. Those three are what a working key needs;
  verified by probing each endpoint, with `api-keys` still 403 on the key that
  configures successfully. There is no reason to grant more than that, least
  of all in this project.

  Without a key, everything else still runs. The startup log says the sandbox is
  unavailable and the mission brief omits its verification step, rather than
  asking the agent for working it has no way to produce.

### Quick start — live mission

```bash
pnpm install
cp .env.example .env                 # add at least one Gemini key

# 1. TrueForge (run in Linux/macOS; on Windows run this inside WSL)
npx @truefoundry/trueforge           # http://127.0.0.1:8790

# 2. register the configured models in that TrueForge instance
pnpm demo:models

# 3. start the mission control plane, scope proxy, and city
pnpm dev                             # http://127.0.0.1:5180
```

On Windows, if an existing TrueForge database predates the installed version,
do not delete it. Start the hackathon instance with an isolated database:

```bash
SQLITE_PATH=/tmp/scope-city-trueforge.sqlite npx @truefoundry/trueforge
```

### Real systems, and fixtures

The Exchequer talks to **Stripe test mode** when `STRIPE_API_KEY` is set. A
refund issued there is genuinely irreversible in the test ledger, which is the
property the gate exists to protect — a demo whose "irreversible action" is a
counter in memory is asking to be taken on faith.

```bash
node scripts/seed-stripe.mjs   # creates the charges the demo refunds
```

Scope the key to **Charges and Refunds: write** and **Payment Intents: read**,
and nothing else. That is the entire surface the Exchequer uses. It is worth
doing properly: our first attempt looked correct — the two permissions we
wanted were set — and probing what the key could actually reach found write
access to payouts, transfers and top-ups, inherited from a group toggle. Stated
permissions and actual reach are different things, which is the same argument
the Yard makes about the agent.

Records and Post House remain fixtures. `SCOPE_FIXTURES=true` forces every
district to its fixture regardless of what is configured, so the whole demo
runs with no accounts at all — and the test suite sets it, so no test can reach
a payment API by accident.

The clearly labelled **Offline security replays** in the UI need no network or
credentials either.

## Judge mode — no install, no credentials

The city is a static build. Deploying `apps/city` gives a public URL with no
sign-in, no backend, and no keys, and the **Replay a real run** button plays a
mission that actually happened.

That recording is not a script. It is what the control plane produced during a
live TrueForge session — the derivation, the Yard's 46 probes, the gates, the
countersigns, the quota — and it is hash-chained, so anyone doubting the order
of events can check it:

```bash
# the same file the UI replays
cat apps/city/public/replays/refund-184.json
```

It replays through the **same reducer the live stream drives**, so there is no
second code path that could flatter the first.

```bash
pnpm --filter @scope-city/city build   # -> apps/city/dist, deploy anywhere static
```

The scripted **Offline security replays** sit alongside it and are labelled
differently on purpose: those illustrate a scenario, the recording is one that
happened.

## Verifying the claim

The safety claim is not rhetorical; it is a test suite.

```bash
pnpm test        # no network
```

The tests that matter most:

- `packages/scope` — boundaries, expiry, integer-minor-unit amounts, deny-by-default
- `packages/ledger` — the ten-way race where evaluate() would say yes to all of them
- `packages/proxy` — the poisoned ticket refused end to end, and the countersign
  that is void because it belongs to a different call

## Licence

MIT — see [LICENSE](LICENSE).

Asset and font licences are recorded in [ATTRIBUTION.md](ATTRIBUTION.md).
