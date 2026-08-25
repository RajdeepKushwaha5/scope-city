# What we are actually being judged on

The brief, verbatim where it matters, with an honest column for where Scope
City stands. Kept in the repo rather than in someone's head, because the two
gaps below are the kind that stay comfortable until the day before a deadline.

---

## The three things acting requires

> *"A chatbot answers questions. An agent acts on them. It opens the pull
> request, queries the database, runs the script."*

### 1. A way to reach your systems

> *"Your GitHub, your database, your internal tools, your calendar.
> **Connected, not mocked.**"*

**Where we are: partial, and this is a real gap.**

The agent reaches three MCP systems through a live TrueForge session over a
real MCP connection — that part is genuine, and the proxy in front of them is
the product. But Records, the Exchequer and Post House are **fixtures**. Real
protocol, real network, invented data.

"Connected, not mocked" is explicit, and a judge who opens `mcp/src/systems`
will see fixtures. The fix is not cosmetic: Stripe **test mode** is a real API
over the real network with real charge objects and real refunds that genuinely
cannot be undone. Same for a real mailbox via Mailpit or a real inbox.

Fixture mode stays, because a stranger must be able to clone and run this with
no accounts. It becomes the fallback, not the default.

### 2. A safe place to run what it writes

> *"Generated code has to execute somewhere that cannot damage anything if it
> is wrong."*

**Where we are: met, and verified against a running sandbox.**

The control plane configures the Daytona provider at boot, the agent opens a
sandbox mid-mission, and it runs its verification there before the gate asks a
human to approve anything. From a real mission record:

```
world  agent.arrived   {office: exec}
world  yard.opened     {sandboxId: v1:daytona:default.f57465e9-...}
world  agent.finished  {office: exec}
world  gate.raised     {office: charge.refund}
```

The order is the point. The sandbox runs *before* the countersign is
requested, which is what makes it the step that earns the approval rather
than a checkbox.

Two traps cost real time and are recorded so they cost it once.

An earlier version of this note claimed TrueForge offers a local provider
needing `bubblewrap`, `socat` and `ripgrep`. That is **wrong for 0.1.4**, and
the correction cost real time, so it is recorded here rather than quietly
fixed: the provider manifest's `type` enum has exactly one member, `daytona`.
There is no local provider on this version. Installing those three binaries
changes nothing.

So the sandbox needs a Daytona API key. With `DAYTONA_API_KEY` set the
provider is configured at boot and the verification step runs; without it the
startup log says so and the brief omits the step. What must not happen — and
did, before this was resolved at boot — is a session created with
`sandbox.enabled` and no provider: the harness rejects it with a 422, so
*every* mission fails at creation and the operator sees "mission failed" with
nothing on the map.

There also has to be a *reason* for the agent to write code. The obvious one,
and the one the brief's own illustration uses, is verification: have the agent
write and run a short script that checks the refund amount against the charge
metadata before asking for a countersign. That turns the sandbox from a
checkbox into the step that earns the approval.

### 3. A way to stay in control

> *"It should stop and ask a person before doing anything you cannot undo."*

**Where we are: met, and driven from the city.**

`tool.approval_required` raises The Gate, the countersign is bound to a
fingerprint of the exact call, and a drifted call voids the approval. A human clicks it in the city, and the
recorded mission shows the whole sequence: gate raised, cleared by an
operator, quota consumed 1/1, fingerprint revalidated, then the call allowed.

---

## The shape the brief itself draws

Their illustration is worth matching beat for beat, because it is the shape the
judges already have in mind:

| Their example | Ours |
|---|---|
| `grafana · error rate by service (MCP)` | `ticket.get` through the scope proxy |
| `sandbox · bisect the last four deploys` | **missing** — see gap 2 |
| `cause found · deploy 4c21 doubled timeouts` | charge resolved, over-reach redacted |
| `Rollback is irreversible. Holding for your approval.` | The Gate, klaxon, countersign |
| `Approved by you · 4c21 rolled back` | refund executes |
| `error rate recovering · session logged` | mission record, hash-chained |

Five of six. The missing one is the sandbox.

---

## The Qodo track

> *"Judges read your pull request history, so the review trail is the
> evidence. A repo with a single pull request opened an hour before the
> deadline will not win this one."*

| Requirement | Status |
|---|---|
| **Install at the start** — "installing it the night before defeats the point" | Done. PR #1 was the Qodo config itself. |
| **Work through pull requests, not straight to main** | Done. Seven PRs; no feature has gone straight to main. |
| **Deal with what it finds before you merge** | Done. Eight findings, each fixed with a regression test and answered on the thread. |

Findings addressed so far, with the two that mattered:

- **Negative amounts defeated the scope ceiling.** `-1000` passed `Number.isInteger`, passed `value > ceiling`, and ran the downstream arithmetic backwards — restoring refundable headroom. The ceiling meant nothing. Fixed at both layers.
- **A retried call performed an irreversible action twice.** A replay was treated as a won claim; worse, refusing it afterwards released the *original* entry and handed back quota for money that had already moved.

Both were security-relevant, both were ours, and both have a
finding → fix → regression test → reply arc in the trail. That arc is the
artifact this track scores.

---

## The five best practices, scored honestly

> **01. The harness has to be doing real work.**
> *"A judge has to see TrueForge reaching a tool, running code in the sandbox,
> and stopping for a person. If it would work just as well as a chat box,
> change the project."*

This is the qualification bar and it names **three** things. We can currently
show one.

| A judge must see | Us |
|---|---|
| TrueForge reaching a tool | **Yes.** Live session, real MCP connection, refusals over the wire. |
| Code running in the sandbox | **No.** Criterion at zero. |
| Stopping for a person | **Headlessly only.** Not yet clicked in the city. |

> **02. Pick one job an agent can finish.**

**Good.** One job: resolve ticket #184. Narrow, end to end, three minutes.

> **03. Open pull requests from the first commit.**

**Good.** Qodo was PR #1. Seven PRs, eight findings, each with a fix, a
regression test and a reply.

> **04. Put the approval gate in the demo.**
> *"Control and safety is a judging criterion of its own, and it is the one
> nobody films. Show where the agent's code ran, and show the moment it stops
> and asks."*

Note what this sentence asks for: **both** halves. Where the code ran *and* the
moment it stops. Our demo script has the gate; it has nowhere to point for the
sandbox.

> **05. Ship a repo a judge can run.**

**Not yet.** The repository is private and must be public before the deadline.
Fixture mode has to work with no accounts and no keys.

---

## The eight things the harness does, and which we use

Using more is not automatically better -- forcing a capability in is the red
flag the winner's playbook warns about. But an unused one is worth a deliberate
decision rather than an oversight.

| Capability | Us |
|---|---|
| Connects to your tools (MCP) | **Central.** The proxy is the product. |
| Runs code safely (sandbox) | **Unused.** The gap. |
| Waits for a human | **Used.** `tool.approval_required`, countersign bound to a call fingerprint. |
| Delegates (subagents) | Enabled in the spec; the city renders `thread.created`. Not yet forced by a mission. |
| Survives reconnects | Not demonstrated. The orchestrator is replayable by design, so this is cheap to show. |
| Runs on any model | **Used.** Three keys, rotation with per-failure cooldowns. |
| Loads Skills | Unused. A deliberate skip -- the mission has no procedure worth versioning yet. |
| Scales to Postgres/Redis | Not relevant at this size. |

Three used centrally, one deliberately skipped, two cheap to show and worth
doing: **sandbox** and **reconnect**.

---

## Order of work

1. **Sandbox** — the only criterion at zero, and the brief names it explicitly.
2. **Real systems** — Stripe test mode first; it is the one that turns
   "connected, not mocked" from arguable into true.
3. **Countersign from the UI** — the control story is built but not visible.
