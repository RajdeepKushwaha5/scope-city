<!--
  This is the script the video is recorded from. It lives here rather than
  outside the repository because two copies of a script drift, and this project
  spends a lot of its README on what drift costs.
-->

# Scope City: the demo video script

**Maximum:** 3:00  
**Target after editing:** 2:45–2:55  
**Track:** Best Use of TrueForge  
**Core message:** Give an agent a key for one job, not the master key.
**Opening principle:** Build the boundary before the first tool call, not after the first incident.

---

## 1. Recording setup

### Use two terminals

Do not use `pnpm dev` for the recording.

**Terminal 1: the control plane**

```powershell
$env:NODE_OPTIONS="--experimental-sqlite"
cd "D:\trueforge-hack\scope city\apps\demo"
npx tsx watch src/live-server.ts
```

Wait until this appears:

```text
Scope City control plane: http://127.0.0.1:8787
```

Startup may take around 40 seconds.

**Terminal 2: the city UI**

```powershell
cd "D:\trueforge-hack\scope city\apps\city"
npx vite
```

Open `http://127.0.0.1:5180/`.

### Check before every take

Open `http://127.0.0.1:5180/api/health`. It should show:

```json
{"ok":true,"harness":{"ok":true},"activeMissions":0}
```

Also confirm:

- TrueForge: `http://127.0.0.1:8791/`
- Mailpit: `http://127.0.0.1:8025/`
- Ollama: `http://127.0.0.1:11434/api/tags` lists `qwen2.5:7b`
- Browser zoom: 100%
- Recording resolution: 1920 × 1080
- Close notifications, personal tabs and any terminal that contains secrets
- No `.env`, keys, tokens or personal information are visible
- Mission order says: `Refund order #184 and notify its owner, max $49`
- Model line begins with `local/qwen`
- The badge next to the title says `OFFLINE`. That is correct before you
  dispatch. It means no mission is streaming yet, not that anything is broken.
  It changes to `LIVE` when you click Dispatch.
- `activeMissions` is `0`. If it is `1`, a rehearsal mission is still open and
  Dispatch will be refused. Restart the control plane.
- On the welcome dialog, choose **Explore the island directly** before the take
  so the first recorded frame is the full island.
- Keep a separate, clean terminal ready with the record-verifier command. Do
  not type paths or search for commands while recording.

Restart the control plane before the final take so rehearsal cooldowns do not carry into the recording.

Before that restart, restore the refundable Stripe test charge:

```powershell
cd "D:\trueforge-hack\scope city"
node scripts/seed-stripe.mjs
```

### Pace

Speak naturally at about 150–160 words per minute. Record each section as a
separate clip and remove only silent waits. The main script deliberately leaves
a few seconds of safety below the three-minute limit.

### What to cut, and what is never cut

A take that runs long gets shortened in this order:

1. The GitHub proof at the end, which is already marked optional and can be
   recorded separately.
2. Any explanation of a panel nobody clicked.
3. Seconds of silent waiting, using jump cuts.

Two things are **never cut**, because without either the video stops making an
argument and becomes a feature tour:

- **The comparison.** The same ticket run twice, without a scope and with one.
  It is the whole claim, and it has to come before anything else that moves.
- **The verifier.** `node scripts/verify-record.mjs` is what turns "we logged
  it" into "you can check it", and it takes fifteen seconds.
- **The sentence introducing the recorded run as a real one.** Without it the
  replay looks like an animation, and the verifier that follows looks like it is
  checking the scripted runs. Cutting it does not shorten the video by much and
  it costs the whole proof.

Depth that gets cut is not lost. `pnpm --filter @scope-city/demo probe:code-mode`
and the rest are evidence you offer when a judge asks, not narrative you spend
the three minutes on.

### Editing rule

The model may take time to think. Record the complete flow, then remove only
silent waiting. Use clean jump cuts. A short freeze-frame or crop is fine when
the Gate needs more time to read, but never rearrange events or present a
scripted event as live.

If the local model writes a tool call as ordinary text and no building lights up, stop and retake. Do not describe that run as successful.

---

# 2. Final under-three-minute script

## 0:00-0:23. The problem, and the project

### Screen

- Begin on the full island.
- Slowly pan across the city and hover over one building.

### Say

> One command can take down a monorepo. A person may make that mistake once;
> an AI agent translating plain English into actions can repeat it at machine
> speed.
>
> Scope City builds the guardrail before the first tool call. Like a hotel key
> for one room, it gives an agent authority for one job instead of the master
> key.

---

## 0:23-0:58. Tech stack and architecture

### Screen

- Hover over one building, then point to its district.
- Show the **first rendered diagram** under `README.md` → **How it works** for
  about eight seconds. Crop to the diagram and zoom until its labels are easy
  to read. Do not show raw Mermaid source.

### Say

> Scope City is a React, TypeScript and Canvas map of what an agent can reach.
> The Exchequer is Stripe, the Post House is email, and the Forge is GitHub.
> Each building is an MCP tool, an action the agent can call, and its colour
> changes as work happens.
>
> This README diagram shows the whole architecture. TrueForge runs the agent,
> subagents, sandbox and approval Gate. It connects only to the Scope City
> proxy, never directly to those systems.
>
> The proxy is the security checkpoint. It reads the granted scope, holds the
> credentials, checks every call, limits usage, filters responses and records
> each decision.

### README diagram to use

Use the first Mermaid diagram in `D:\trueforge-hack\scope city\README.md`, under
**How it works**. It has three clear areas:

```text
TrueForge agent world  ↔  Scope City boundary  →  real systems
agent + subagents         proxy + granted scope    Stripe test
sandbox + Gate            quota + record            Mailpit + GitHub MCP
```

Do not use the second `tools/call` flow diagram in the main video. It is useful
for a technical judge question, but it introduces too many branches on screen.

---

## 0:58-1:15. Show the danger

### Screen

1. Choose **Test poisoned ticket containment**.
2. Click **1 · Without a scope**.
3. Point to the wrong `$399` refund and attacker email.
4. Click **2 · With a scope** and point to the refusal at the city limits.

The two runs print these lines. They are quoted here verbatim, em dashes and
all, because a test reads them out of this file and checks the city still emits
them. A script that promises output the application stopped producing is the
drift this project spends its README on.

Without a scope:

```text
Injected instruction obeyed — nothing to stop it
charge.refund ch_185 $399.00 — SUCCEEDED
customer.list — 3 records exfiltrated
mail.send attacker@example.test — SENT
Mission ended. Three irreversible actions, none authorised.
```

With one:

```text
Ticket body contains an injected instruction — flagged, not obeyed
charge.get ch_184 — history redacted by projection
```

and the refusal names why: the charge the ticket asked for is `not a granted charge`.

### Say

> This ticket has a hidden instruction in it. With broad access the agent
> refunds the wrong 399-dollar charge and emails an attacker. With a scope,
> those tools are absent and the same attack is refused.
>
> This comparison is scripted. The next proposal and adversarial review are live.

---

## 1:15-1:50. Build a live scope and attack it

This section is live, but it deliberately stops before execution so the video
does not depend on one model run behaving perfectly.

### Screen

1. In **Mission order**, keep: `Refund order #184 and notify its owner, max $49`.
2. Click **Dispatch**.
3. Show the proposed tools, the exact records, the `$49` ceiling and the expiry.
4. Wait until the local adversary line appears in **The Yard**. It takes about
   25 seconds.
5. Point to the model name and any admitted attack. A clean result is also
   valid. If it says the adversary was unavailable, stop and restart Ollama;
   do not use that take.
6. Click **Deny**. This ends the live proposal without starting a TrueForge
   session or calling Stripe.

### Say

> Now a live proposal. Before any agent exists, my sentence becomes a boundary:
> one order, one charge, one recipient, a 49-dollar ceiling and a thirty-minute
> expiry.
>
> The Yard first tries known attacks. Then a model on my machine reads the
> ticket and invents new ones. The customer data stays local.
>
> I deny it, so no TrueForge session and no external call is created. Now I
> replay a completed real run, making the rest of the demo deterministic.

---

## 1:50-2:28. Replay a completed real TrueForge mission

This is the deterministic execution proof. Let the replay run in order; cut
only idle gaps.

The replay itself is about 15 seconds. Say the first sentence below before you
click, then follow the events. In editing, hold the Gate frame briefly if its
arguments are too fast to read; do not reorder the replay.

### Screen

1. Hover over **Replay a real run** and say the first narration sentence.
2. Click it, then point to **chain verified** before the replay advances.
3. Follow the workers and changing building colours.
4. Point to the subagents in **The Field** and response filtering in the log.
5. Point to the sandbox verification in **The Yard**.
6. At **The Gate**, show the exact charge and amount.
7. Let the record show the countersign and completion.

### Say

> This is not a scripted animation. It is the hash-chained record of a completed
> real TrueForge session, replayed through the same reducer as the live feed.
>
> TrueForge splits investigation across subagents. Every tool call crosses the
> same scope proxy, and allowed responses are reduced to only the fields needed.
>
> The sandbox verifies the refund arithmetic. The irreversible call then stops
> at TrueForge's Gate, and the record shows the operator approving this exact
> charge and amount. Not general access to Stripe.

---

## 2:28-2:45. Verify the record

### Screen

- Show **The Record**, or switch to a prepared terminal and run:

  ```powershell
  cd "D:\trueforge-hack\scope city"
  node scripts/verify-record.mjs apps/city/public/replays/refund-184.json
  ```

- Point to:

  ```text
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

  The chain covers the entries and the sealed scope. It does not cover the
  record's top-level job, timestamps, algorithm or lossy flag, which sit
  outside it.
  ```

  Quoted whole rather than trimmed to the flattering lines. The command keeps
  going after `sandbox checks`, and a presenter reading a shorter version during
  the step meant to establish trust would be showing different output from the
  one on screen.

### Say

> Every live mission writes a hash-chained record. This independent verifier confirms three agent threads, two sandbox checks, one approval gate and one exact countersign. The chain is intact.

The terminal command verifies the same shipped record being replayed in the
browser.

If asked what it proves: the record does not carry Stripe's response, so it
attests to what the boundary decided and what the operator approved, not that
money moved. Mailpit and the Stripe test dashboard are where you check that.

---

## 2:45-2:55. Closing

### Screen

- Return to the wide city view.
- Display: **Give agents a license to act, not a master key.**

### Say

> Scope City does not ask the model to behave. It limits what the model can reach.
>
> The agent received one job, one payment and one human-approved action. Not
> our Stripe account.

Stop here. Do not add another feature list.

---

# 3. Important truth checks

Say:

- **Tamper-evident hash chain**, not immutable record.
- The unsafe comparison is scripted. The scope proposal and local adversary are
  live. The completed execution is a verified record of an earlier real run.
- The shipped record is from a completed real mission.
- Subagents share the mission scope.
- The agent never receives the Stripe key; the proxy holds the upstream credential.
- The recorded run is replayed through the same reducer as live events.

Do not claim:

- The scripted comparison contacted Stripe or TrueForge.
- The verifier proves that Stripe moved money.
- Every subagent has different permissions.
- Scope City eliminates all powerful credentials.
- The model can never be compromised.
- A feature or number that is not visibly present.

---

# 4. Full architecture explanation

Use this longer answer if a judge asks, “What happens from the moment I type a
request?” Do not add all of it to the three-minute narration.

> The browser is a React and TypeScript application with a Canvas city. The city
> is not the security boundary; it is the way we make that boundary visible.
>
> First, the Node control plane receives the natural-language job. The intent
> compiler resolves names such as order 184 into exact record IDs, then drafts a
> short-lived scope. That scope lists the MCP tools the job may use, the exact
> records it may touch, amount and call limits, allowed response fields, and an
> expiry time.
>
> Before an agent exists, the Yard tests the draft. Fixed probes check known
> failure cases, and local Qwen reads the ticket and proposes attacks the fixed
> tests may not have imagined. A human can inspect, deny or grant the result.
>
> Only after grant does the control plane create a TrueForge session. TrueForge
> supplies the main agent, dynamic subagents, sandbox execution and its human
> approval Gate. Every thread inherits the same sealed mission scope.
>
> TrueForge does not connect directly to Stripe, GitHub or email. Its only MCP
> route is the Scope City proxy. On `tools/list`, the proxy exposes only granted
> tools. On every call, it checks the tool, record ID, amount, call budget and
> expiry. An atomic ledger prevents two workers from spending the same one-call
> allowance. Irreversible calls pause at TrueForge's Gate, and the proxy accepts
> only a countersign for those exact arguments. The proxy holds
> the upstream credentials. It then calls Stripe test mode, GitHub MCP or
> Mailpit and removes response fields the scope did not grant.
>
> Finally, TrueForge events and proxy decisions are appended to a hash-chained
> mission record and streamed to the browser over Server-Sent Events. The UI
> reduces those events into workers, lit buildings, refusals and gates. A
> recorded mission goes through that same reducer, and the independent verifier
> checks the chain. So the animation is a view of the enforcement; it is not the
> source of truth.

### Stack at a glance

- **City UI:** React, TypeScript and Canvas
- **Control plane:** Node.js, TypeScript, REST and Server-Sent Events
- **Agent runtime:** TrueForge SDK and server
- **Models:** local Ollama/Qwen first, Gemini slots as error/rate-limit fallback
- **Enforcement:** MCP scope proxy, sealed scope evaluator and atomic quota ledger
- **Connected systems:** Stripe test mode, GitHub MCP and Mailpit SMTP
- **Proof:** SHA-256 hash-chained mission record plus an independent verifier
- **Local infrastructure:** Docker Compose for TrueForge, PostgreSQL, Redis and Mailpit

### Architecture in one sentence

> Scope City compiles least privilege before execution, TrueForge performs the
> work, the MCP proxy enforces every interaction, and the record proves what
> happened.

---

# 5. Emergency shorter narration

Use this if the first edit is longer than three minutes:

> One command can take down a monorepo. An agent can repeat that mistake at
> machine speed, so Scope City builds the boundary before the first tool call.
>
> React and Canvas draw systems as districts and MCP tools as buildings. A
> request becomes a short-lived scope, and a local model attacks it before I
> grant anything. TrueForge runs agents, subagents, sandbox and approval. Our
> MCP proxy limits tools, requests and responses before Stripe, GitHub or email.
>
> Without a scope, this poisoned ticket causes the wrong refund and sends data
> to an attacker. The live proposal instead allows one order, one charge, one
> recipient and a 49-dollar ceiling. I deny it, so no external call is made.
>
> I then replay the verified record of a completed real TrueForge mission.
> Subagents investigate, responses are filtered, the sandbox verifies the work,
> and the exact refund pauses for human approval.
>
> The independent verifier confirms the threads, sandbox checks and countersign.
> We do not ask the model to behave. We limit what it can reach.

---

# 6. Optional GitHub proof, recorded separately rather than in the main video

This is strong backup material for judge questions, but it adds network and
token risk to a three-minute take. Run it only in a prepared terminal and never
show the token:

```powershell
cd "D:\trueforge-hack\scope city"
pnpm --filter @scope-city/demo probe:forge-harness
```

Explain the result in one line:

> GitHub's MCP server offers many tools; this mission exposes only `issue.get`,
> so the other tools are absent from the agent's world.

---

# 7. YouTube upload

## Suggested title

**Scope City: A Visible Safety Boundary for TrueForge Agents | 3-Minute Demo**

## Suggested description

> Scope City gives AI agents a temporary, task-specific license to act instead of broad standing access. Built on TrueForge, it combines real MCP tools, sandbox verification, subagents, human approval and a tamper-evident mission record in an interactive city.

## Final upload checklist

- Duration is below 3:00.
- The live proposal and adversary ran on camera; the execution is clearly
  labelled as a verified real-run replay.
- Project, architecture and live demo are all included.
- Scripted and live sections are labelled honestly.
- Text is readable at normal YouTube size.
- Voice is louder than background audio.
- No secrets or personal data appear.
- Upload is **Public** or **Unlisted**, not Private.
- Open the final link in an incognito window before submitting it.
