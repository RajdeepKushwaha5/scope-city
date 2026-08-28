# Scope City

**See where your agents can act.**

An isometric city where your connected systems are districts, an AI agent works
in the field, and its authority is drawn on the map as city limits. Watch an
attack go out of scope and stop at the line.

Built on [TrueForge](https://github.com/truefoundry/trueforge), the open-source
agent harness.

> **We don't give agents a bigger sandbox. We turn the environment into a
> sandbox with walls.**

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

## How TrueForge is used

The harness is not a wrapper around a model call here. Five of its capabilities
are load-bearing, and removing any one of them leaves no product:

| Capability | Where it is used | Evidence |
|---|---|---|
| **Real tools over MCP** | The scope proxy is an MCP server registered with `registerMcpServer`. Every office the agent can call is served through it, and the scope decides what appears in `tools/list`. | Stripe test mode, GitHub Issues, and Mailpit are all reached this way. `mcp/src/systems/` |
| **Sandboxed code** | The agent must check the arithmetic before a human is asked to approve anything irreversible — a sandbox that exists to earn the approval rather than to satisfy a checklist. | `yard.opened` and two `yard.verified` events in the shipped recording |
| **Human approval gates** | `requireApprovalForTools` raises The Gate. The countersign is bound to the exact call's arguments, so an approval cannot be reused for a different one. | `gate.raised` → `gate.cleared` in the recording; `packages/mission/src/countersign-book.ts` |
| **Subagents** | `dynamicSubAgents` is enabled and the brief describes two independent read-only assignments. A live run produced six child threads titled "Source investigator" and "Target verifier", drawn on the map as separate figures. | `packages/scope/src/delegation.ts`, and the measurements in [docs/TRUEFORGE.md](docs/TRUEFORGE.md) |
| **Session persistence** | A turn paused at The Gate survives the browser going away. The event log replays from any cursor, so a reconnecting client rebuilds the whole mission including the pending approval and its exact arguments. | `packages/mission/src/event-log.ts`; verified end to end, see [docs/TRUEFORGE.md](docs/TRUEFORGE.md#reconnection-verified) |

Eleven harness event types are translated into what the city draws
(`packages/harness/src/translate.ts`). Every figure, every lit building and
every held gate is an event from TrueForge or a decision from the proxy — none
of it is on a timer.

What the harness does **not** do is enforce the scope. That is deliberate and it
is the point of the project: the approval gate asks a human, and the proxy asks
nobody. A scope stops what should never happen; a gate pauses what should happen
only once somebody has looked. Both are needed, and they are different
mechanisms.

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
- **Node.js 22 LTS**, pnpm 11.10. There is an `.nvmrc` pinned to
  22.13.0 -- a bare `22` would let `nvm use` select an already-installed 22.0-22.12,
  which is the same broken class this is meant to avoid.

  Node 22.13 or later, not "22 or newer" -- and not Node 23. pnpm 11 imports
  `node:sqlite`, which was flag-gated until 22.13 and which Node 23.2 still
  only exposes behind `--experimental-sqlite`. Where it is gated, every pnpm
  command including `install` dies with `ERR_UNKNOWN_BUILTIN_MODULE` before
  anything in this repository runs.

  Verified on 23.2 (gated, pnpm unusable) and 22.23 (available, pnpm fine).
  Node 24 has it outright. The whole of 23 is excluded rather than bisected: it
  is a non-LTS line, and pinning the supported range to what was actually tested
  beats guessing which 23.x changed it.
- **A local model is optional, and proves something.** Point `OLLAMA_HOST` at
  Ollama, vLLM or any OpenAI-compatible endpoint and it joins the pool beside
  the hosted keys -- TrueForge registers it as a `custom` provider, the same
  mechanism the Gemini slots use. The scope, the proxy, the ledger and the gate
  are unchanged: being able to swap the model and watch nothing about the
  enforcement change is the clearest demonstration that enforcement does not
  depend on trusting the model. A local model may accept no reasoning effort,
  so the control plane drops that setting for it rather than failing the launch.
- **Mail is optional, and needs no account.** Without it the Post House keeps an
  in-memory outbox, which enforces correctly but cannot be looked at. Point
  `MAILPIT_HOST` at a running [Mailpit](https://mailpit.axllent.org) and the
  same office delivers to a real inbox at `http://127.0.0.1:8025`, so "the mail
  reached only the authorised recipient" is something a viewer opens rather than
  something the demo asserts.
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

Records talks to **GitHub Issues** when `GITHUB_TOKEN` and
`GITHUB_REPOSITORY=owner/repo` are set. A ticket id maps directly to an issue
number (`tkt_7` is issue #7). Give a fine-grained token only Issues read/write
access to that one repository. Structured resolver metadata comes from labels:

```text
scope-city:order:ord_184
scope-city:email:customer@example.test
```

The issue title and body remain customer-controlled, untrusted prose. They are
returned intact only after the scope is fixed; pre-grant resolution reads the
maintainer-controlled labels and never the body.

Create the deliberately poisoned demo issue and print the exact mission text:

```bash
pnpm seed:github
```

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

Post House remains a fixture. `SCOPE_FIXTURES=true` forces every
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
### Delegation, and the thing that nearly stopped it

Subagents spawn and the map draws them, titled from the brief. For a while a
*delegated* mission could not finish on a free-tier key: delegation fires enough
calls to trip the per-minute limit partway through, and rotating to the next key
meant a new session that started from nothing. Availability survived a rotation;
progress did not.

The fix was one fact, the wrong way round. A rate limit ends the *turn*, not the
session -- TrueForge keeps the conversation -- so the rotation loop was throwing
away work it could have kept. Holding the session and waiting for its own key
took the same job from seven sessions to one, and from never reaching the gate
to reaching it. The measurements, and the three pieces of state that had to
travel with the held session, are in
[docs/TRUEFORGE.md](docs/TRUEFORGE.md#what-delegation-cost-and-what-fixed-it).

The shipped recording is that delegated run.

### The agent can write code. The boundary does not care.

TrueForge lets an agent with a sandbox write Python that calls MCP tools
directly, bridged back through the harness. Scope City enables the sandbox on
every mission, so this has been available to the agent from the start -- which
makes it the case this project's claim has to survive. An agent that can execute
arbitrary code must not get further than one that cannot.

That is measured rather than asserted:

```bash
pnpm --filter @scope-city/demo probe:code-mode
```

One sandbox script, three calls, against a live TrueForge:

```
  HELD    in-scope       allowed, and the response still filtered
  HELD    out-of-scope   Refused: resource_not_in_scope. tkt_999 is not a granted ticket_ids
  HELD    countersigned  requires interactive handling and is not callable from sandbox
```

The in-scope case is the interesting one. The refusal is the obvious test; what
matters is that the allowed call still had its response projected and scanned
for injected instructions on the way back, exactly as a direct call does. A
success that skipped those would be a bypass wearing a success message.

The full findings, including a place where TrueForge's own documentation says
something the harness does not do, are in
[docs/TRUEFORGE.md](docs/TRUEFORGE.md#code-mode-and-whether-it-is-a-way-round-the-scope).

### Checking the record yourself

The recording the city replays is a hash-chained mission record, and you do not
have to take its word for anything:

```bash
node scripts/verify-record.mjs apps/city/public/replays/refund-184.json
```

```
  entries   71

  chain intact, head fedb0da15fdaf944…

  what it attests to
    ended            completed
    threads          3 (subagents ran)
    gates raised     1
    countersigned    1
    refused at gate  0
    left unanswered  0
    sandbox checks   2

  the authority it was granted
    offices          charge.find_by_order, charge.get, charge.refund
    countersign      charge.refund
    lease            30 minutes
```

It re-implements the hashing rather than importing it, on purpose: a verifier
sharing a canonicaliser with the writer would cancel out a bug in it and pass a
record nobody else could reproduce. `packages/mission/test/verifier-parity.test.ts`
pins the two implementations to each other so they cannot drift apart quietly.

Edit any entry and it names the first broken link. Delete entries from the end --
the one edit that leaves every remaining hash individually valid -- and the head
gives it away. It exits non-zero either way.

This is tamper-evidence, not a signature. Nothing here is signed, so anyone able
to rewrite the whole file can produce a consistent chain over whatever they like.
What it gives you is a stable identity you can quote and compare against a copy
someone else holds.

## Where this goes, and what it is not yet

The problem this exists for is not going away: teams want agents on Stripe,
Salesforce, Snowflake, GitHub and their own databases, and every one of those
integrations hands over a credential that can do far more than the job needs.
Call it the god-token problem. The agent asked to refund one charge holds a key
that can refund all of them, and nobody can say afterwards what it was *able* to
touch, only what it happened to do.

Scope City answers that for one job, end to end, against real systems. What it
is not is a product, and the distance is worth naming rather than leaving for
someone to find.

**The proxy still holds a static key.** Everything downstream of it is scoped:
the agent gets one charge, one amount, one recipient, one lease. But the proxy
itself authenticates to Stripe with a long-lived key from the environment, so
the god-token has moved rather than gone. The honest fix is minting an ephemeral
credential when the scope is granted -- Vault, STS, workload identity -- that
expires at the provider when the lease does, so the boundary is enforced by the
system holding the money and not only by us.

**Missions live in memory.** Restarting the control plane loses them. A browser
refresh is fine and is the claim the demo makes; anything more needs the store
this deliberately does not have.

**The map has six districts, and they are fixed.** Buildings are generated --
add an office to the registry and the city draws it, because the layout comes
from `tools/list` rather than a diagram. Districts are six hand-placed plots, so
a seventh system has nowhere to go until the layout is solved rather than
authored.

**There is no tenancy and no operator identity.** The control plane trusts
whoever can reach it. The proxy authenticates the *harness* with a per-mission
bearer token, which is the boundary that matters for enforcement, but "which
human approved this" is a name in a record rather than an authenticated
identity.

None of that is hard to see coming, and none of it changes the argument the
project makes. It does change what you could deploy on Monday, and a submission
that says so is more use than one that lets you find out.

## Qodo Code Review Evidence

Every change reaches `main` through a pull request that Qodo reviews first. Nothing
below is a summary written after the fact: each finding is quoted from the review
thread on the linked PR, and each fix is in the PR that answers it.

### The banner that lied about its own run

**Finding** ([#27](https://github.com/RajdeepKushwaha5/scope-city/pull/27)) — *"Clean
run never finishes."* The scenario banner promised *"the job finishes inside its
scope"*, but `CLEAN_JOB` ends by raising a gate and waiting for a countersign.

This one is worth reading the thread for. The banner exists to state what a run will
show **before** it shows it, so that a run doing something else is visibly a failed
run. Qodo caught that component making exactly the error it was built to expose.

**Fix** ([#30](https://github.com/RajdeepKushwaha5/scope-city/pull/30)) — every claim
rewritten from the script that actually runs, and a regression test that reads the
endings out of `useMission.ts` rather than asserting them from memory. Qodo then found
the correction was *also* wrong for the recorded run (it holds at the gate, then plays
through the approval the record already contains) and that the new test could pass
vacuously. Both fixed in the same PR.

### Evidence the code could no longer produce

**Finding** ([#24](https://github.com/RajdeepKushwaha5/scope-city/pull/24)) —
*"Recovery stops before lease."* `save-recording.mjs` waited 15 minutes against a lease
of up to 30, so it could abandon a mission that was still legally running and then
refuse to save it for not having completed.

**Fix** ([#32](https://github.com/RajdeepKushwaha5/scope-city/pull/32)) — the bound now
comes from the mission's own granted scope instead of a constant. Qodo's follow-up
noted the first scope in a record is the *proposed* one and grant recomputes the
expiry; the scan now looks for `scope.granted` specifically.

### A selector that changed nothing

**Finding** ([#35](https://github.com/RajdeepKushwaha5/scope-city/pull/35)) — *"Crew
choice never dispatches."* A model picker set React state and rendered a portrait, and
`onLaunch(order.trim())` carried neither the choice nor the effort.

For this project that is more than a dead control: a UI stating a capability the system
does not have is the gap between stated and actual authority that the rest of Scope
City argues against.

**Fix** — the fictional model identities are gone. What remains is real and verified
end to end: the effort is declared on each slot in `setup-models.ts`, travels through
`POST /api/missions` into `model.params.reasoningEffort`, and TrueForge refuses an
unsupported value rather than ignoring it.

```
effort=high    -> 201 {"model":{"params":{"reasoning_effort":"high"}}}
effort=max     -> 422 Reasoning effort "max" is not supported by model "gemini-a/flash-a"
effort=banana  -> 422 Reasoning effort "banana" is not supported by model "gemini-a/flash-a"
```

### Findings dismissed, and why

Not every finding was taken. On [#33](https://github.com/RajdeepKushwaha5/scope-city/pull/33)
Qodo reported that the panel stack's grid gaps still capture pointer events, and
separately that setting `pointer-events: none` on that stack breaks its own scrollbar in
Firefox. Those are the same line pulling opposite ways. The stack is sized to its
content, so what it captures is roughly forty pixels of strip *between* panels, while
the scrollbar is how a short screen reaches panels below the fold. The trade was
declined, with the reasoning recorded in the stylesheet and in the
[review thread](https://github.com/RajdeepKushwaha5/scope-city/pull/33), and a test pins
the revert.

### The record

Every merged pull request carries a Qodo review -- 32 of 32 at the time of writing.
Follow-up reviews were requested with
`/agentic_review` after each round of fixes. The full history, including the findings
that were rejected and the ones that turned out to be stale, is public in the
[pull request list](https://github.com/RajdeepKushwaha5/scope-city/pulls?q=is%3Apr).

## How this was built

Built during the hackathon week, with AI coding assistants used throughout and
disclosed here as the rules require. The architecture, the security model, and
the decisions about what to claim and what to leave out are the author's; the
reasoning behind the load-bearing ones is written into the code as comments
rather than left implicit.

Full attribution, including the artwork, is in [ATTRIBUTION.md](ATTRIBUTION.md).

## Licence

MIT — see [LICENSE](LICENSE).

Asset and font licences are recorded in [ATTRIBUTION.md](ATTRIBUTION.md).

