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
  standalone server segfaults on `win32` and its sandbox provider is
  Linux/macOS only.
- Node.js >= 22.13, pnpm 11.10
- For the sandbox: `bwrap`, `socat`, `ripgrep`
  ```bash
  sudo apt-get install -y bubblewrap socat ripgrep
  ```

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

### Fixture systems and offline replay

The ticket, payment, and mail systems are local deterministic fixtures. No
Stripe, helpdesk, or email credentials are needed, and no real refund or email
is sent. A live mission still needs one configured model key. The clearly
labelled **Offline security replays** in the UI and the full test suite need no
network or credentials.

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
