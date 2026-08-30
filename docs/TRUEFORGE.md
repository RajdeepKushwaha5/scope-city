# TrueForge integration notes

Everything here was read from the TrueForge docs or verified against a running
instance. **If it is not in this file, do not assume it**. Check first and add
it, rather than coding against a guess.

Last verified: 2026-08-30.

Dated at the top and meant literally: this file's authority is that everything
in it was checked against a running instance, so a stale date on new content
would undercut the one thing it is for. What moved since 2026-08-24 is listed
under "Verified live" below, with what proved it.

---

## Which SDK

There are two different TrueFoundry products with similar names. Getting this
wrong costs a day.

| | Package | Client | What it is |
|---|---|---|---|
| **What we use** | `@truefoundry/trueforge-sdk` | `TrueForge` | The open-source agent harness. Required by the hackathon rules. |
| Not this | `truefoundry_gateway_sdk` | `TrueFoundryGateway` | The hosted TrueFoundry platform (AI Gateway / MCP Gateway). Needs an account. |

Server package: `@truefoundry/trueforge`, run as `npx @truefoundry/trueforge`, serves
on `http://localhost:8790` in local mode (SQLite, single process).

## Client

```ts
import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
  baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
  timeoutInSeconds: 600,
});
```

## Sessions and turns

A **session** holds conversation context; a **turn** is one request/response
cycle. Turns chain automatically, so we do not track message history ourselves.

```ts
const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: "anthropic/claude-sonnet-4-6" },
      instructions: "…",
    },
  },
});

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: "user.message", content: "…" }],
});

for await (const { data: event } of stream.withMetadata()) {
  // …
}
```

The stream **always** opens with `turn.created` and closes with `turn.done`.
`turn.done` carries `event.state.status`.

## Events

The SDK surface is camelCase even though the OpenAPI wire schema is snake_case.
Scope City accepts both, but the live events verified on 2026-08-24 used the SDK
shapes below. TrueForge's SDK stream does not expose a reconnect cursor; Scope
City therefore assigns its own monotonic sequence when it republishes events to
the browser.

| Event | Payload we care about | What Scope City does with it |
|---|---|---|
| `turn.created` | `turnId`, `previousTurnId`, `state` | Mission starts |
| `model.message` | `id`, `threadId`; content may be absent | Seeds a streamed message |
| `model.message.delta` | same `id`; streamed `content` and/or `toolCalls[]` | Merge text and reconstruct tool ID, office, and argument fragments |
| `tool.response` | `threadId`, `toolCallId`, `content` | Agent finishes at an office |
| `tool.approval_required` | `threadId`, sparse `toolCalls[]` containing `id`, `sourceEventId` | **The Gate**. Look up the exact reconstructed call and pause |
| `tool.response_required` | `threadId`, `toolCalls[]` | Client-side tool execution |
| `thread.created` | `threadId`, `title`, `parent`, `agentInfo` | **A second figure appears in the field** (subagent) |
| `thread.done` | `threadId`, `state` | That figure leaves |
| `mcp.initialize` | `threadId`, `mcpServers[]` | Districts come online |
| `mcp.auth_required` | `mcpServers[]` with `authUrl` | District needs OAuth |
| `sandbox.created` | `sandboxId` | The Yard lights up |
| `turn.done` | `state.status` (done / cancelled / error) | Mission ends |

**Deltas:** `model.message` arrives first, then `model.message.delta` fragments
share its `id`. Tool calls are also fragmented: the first delta carries an
`id`, index and `toolInfo.name`; later deltas may carry only the index and the
next JSON-argument fragment. The approval event does not repeat the name or
arguments. `packages/harness/src/translate.ts` reconstructs and tests this
binding; do not approve from the sparse event alone.

## Approvals are a new turn, not a callback

When a tool needs approval the harness emits `tool.approval_required` **and
pauses the turn**. You do not answer it inline. You resume by creating a *new
turn* whose input is one `UserToolApprovalEvent` per pending `toolCallId`.

Same shape for `tool.response_required` (`UserToolResponseEvent`) and
`mcp.auth_required` (create a turn with no input once OAuth is done).

### How this splits from our own enforcement

Two different mechanisms, and conflating them is the easiest mistake here:

| | The Gate | The city limits |
|---|---|---|
| Mechanism | TrueForge `tool.approval_required` | `@scope-city/proxy` |
| Asks a human? | Yes | **Never** |
| Fires when | Tool is in `require_approval_for_tools` | Call falls outside the granted scope |
| Timing | **Before** the call reaches our proxy | When the call arrives at the proxy |
| Survives a refresh? | Yes, the turn is paused server-side | N/A, decision is instant |

So the countersign happens *upstream* of the proxy. Our proxy must **not** block
an MCP request waiting for a human. An MCP call held open for minutes will time
out. `CountersignGate` in `@scope-city/proxy` is therefore a **verification**
callback ("was this exact call countersigned?"), answered immediately by the
server from the approval it already collected. It is not a prompt.

The server is the correlation point: it sees the `tool.approval_required` event
(with arguments) *and* the proxy's incoming call, so it is the only place that
can bind one to the other via `fingerprintCall()`.

## MCP servers

Registered through the UI at **Settings → Connectors**. There is a shipped
catalog (Linear, Notion, GitHub, …) and **Add MCP Server** accepts any remote
URL, which is how our proxy gets connected.

Auth options:

1. **No auth**, for public or network-trusted servers.
2. **Header auth**, static headers carrying an API key or bearer token.
3. **OAuth (Dynamic Client Registration)**, where TrueForge acts as the OAuth client.
   Requires `PUBLIC_BASE_URL` to be set so it can redirect back.

## Sandbox

1 vCPU, 1 GB RAM, 1 GB disk, Debian slim, **2-minute cap per command**. Stops
after 5 minutes idle, deleted 30 days after stopping. Persists across turns
within a session. Ships with git, curl, jq, ripgrep, tree, helm, zip and Python
3.13 (pydantic, fastmcp, requests, genson); `pip` and `apt-get` work.

Sandbox-as-tool: the agent runs *outside* the sandbox and calls it over an API,
so credentials never enter it. Provider is Daytona.

## Two things that were on the whole time

`config.context_management` is not something Scope City ever set, and both
features under it default to on. Confirmed by asking the server what it stores
for this exact spec -- send no `contextManagement` and it comes back holding:

```json
"contextManagement": {
  "compaction":        { "enabled": true },
  "largeToolResponse": { "enabled": true }
}
```

So both have been live on every mission this project has ever run. They are
declared explicitly now, because a project arguing "state what the agent may
do" should not be relying on two undeclared defaults that change what the model
sees and where tool output is kept.

**Compaction** replaces older conversation history with a summary once the
input passes a threshold. It stays on, and the thing worth being clear about is
that it cannot touch the record: the mission log is built from the harness
event stream and the proxy's decisions, never from the model's conversation. A
summarised history changes what the agent remembers, not what is attested to
have happened. Turning it off would only cap how long a delegated mission can
run before its context fills.

**Large tool response offloading** writes any response over the threshold
(documented as 6,000 tokens) to a file in the sandbox, replacing it in context
with a preview and the path. It requires a sandbox, and Scope City enables one
on every mission.

That interacts with the boundary, and the interaction is the right way round:
what lands on that disk is whatever the proxy returned -- already projected
down to the granted fields, already scanned for injected instructions. So
offloading relocates a response the scope has already filtered rather than
carrying one past it. `maxResponseBytes` is still enforced before any of this,
so the file can only hold what the agent was allowed to receive. What changes
is how much of it enters the model's context in one step, not how much the
agent may have.

### A second place the documentation and the harness disagree

The docs describe `compaction.trigger` as `{ type: "input_tokens", value }`.
This server drops it. An agent created with a deliberately non-default trigger
of 40000 comes back holding `{ "compaction": { "enabled": true } }` and nothing
else, in either spelling:

```
non-default trigger 40000: {"compaction":{"enabled":true},...}
snake_case trigger:        {"compaction":{"enabled":true},...}
disabled:                  {"compaction":{"enabled":false},...}
```

The third line matters: `enabled: false` survives, so this is a field being
discarded rather than a response that only ever echoes defaults. So the trigger
is not sent. A setting that reads as configured and is not is worse than an
inherited default, and it is the same trap as writing snake_case keys the SDK
accepts and drops.

## Code Mode, and whether it is a way round the scope

An agent with a sandbox can write Python that calls MCP tools directly, bridged
back through the harness -- Code Mode, or Programmatic Tool Calling. Scope City
enables the sandbox on every mission, so this has been available to the agent
from the beginning.

That is the case the project's central claim has to survive. If reach is decided
by the scope rather than by the agent's good behaviour, then an agent that can
execute arbitrary code must not get further than one that cannot. Whether that
holds is not a matter of opinion, so it is measured:

```bash
pnpm --filter @scope-city/demo probe:code-mode
```

One sandbox script makes three calls. Measured against a live TrueForge:

| From inside the script | What happened |
| --- | --- |
| `ticket.get tkt_184`, in scope | Allowed, **and still redacted and injection-scanned** |
| `ticket.get tkt_999`, out of scope | `Refused: resource_not_in_scope. tkt_999 is not a granted ticket_ids` |
| `charge.refund`, countersign required | `requires interactive handling and is not callable from sandbox` |

The boundary recorded `call.allowed`, `call.out_of_scope`, `response.redacted`
and `response.injection_detected`, the same four things a direct tool call
produces. The refund never reached the proxy at all.

Two things worth stating precisely.

**The response filtering matters more than the refusal.** A refusal is the
obvious test and the boring one. The interesting result is that the in-scope
call still had its response projected and scanned for injected instructions on
the way back, which is what stops Code Mode being a way to read a full record
that a direct call would have trimmed. A success that skipped those would be a
bypass wearing a success message.

**The countersign is stronger from code than from a direct call, and the docs
say otherwise.** TrueForge's documentation states that a script calling a tool
matching `require_approval_for_tools` "pauses for user approval just like a
direct tool call". It does not. The harness refuses it outright: *Tool
'scope-city-probe/charge.refund' requires interactive handling and is not
callable from sandbox.* Safer than documented, but not what was written down --
which is exactly why this is probed rather than cited.

## Subagents

Dynamic and parallel, **one level deep**, sharing the root's tools and sandbox.
**User-defined named specialists are not supported.** Do not script an
"adversarial prosecutor" subagent and claim the harness produced it. Orchestrate
our own turns server-side, and animate `thread.created` / `thread.done` where the
harness genuinely spawns something.

Scope City delegates only office pairs whose registry contracts prove they are
read-only and able to return the evidence named in the assignment. This is task
separation, not capability isolation: TrueForge children inherit the session's
tools. The proxy therefore continues to enforce the same sealed mission scope
for every thread, while the ledger atomically serialises any attempted mutation.

### What delegation cost, and what fixed it

Delegation works. On a live run it produced child threads titled from the brief
-- "Source investigator", "Target verifier" -- and the map drew them. For a
while, what it could not do was finish.

A delegated mission fires enough model calls in quick succession to exceed the
free tier's per-minute limit partway through. Rotation then moves to the next
key, and this is where it comes apart: **a session is bound to a model, so
rotating means `createSession` again, and the new session starts from nothing.**
Availability carries across a rotation; progress does not.

Measured on one run, before it was stopped:

```
attempts (running): 7      rotations: 6
agent.arrived:     31      proxy calls: 16
threads:           15      gates raised: 0
```

Seven attempts, each re-reading what the last one had already read, none
reaching the refund. All four keys returned 200 within seconds of stopping, so
this is burst limiting rather than exhausted quota -- the pool was never out of
capacity, it was out of *continuity*.

The fix turned on one fact that had been assumed the wrong way round: **a rate
limit ends the turn, not the session.** TrueForge keeps the conversation, so an
agent that has already read the ticket, checked the charge and run its sandbox
script still knows all of it. The rotation loop was calling `createSession`
inside itself, so every limit threw that away and started the job from the top
on a fresh key. Availability rotated; work did not.

So a rate limit on a session that has already done something now waits for that
key rather than abandoning it. Anything else -- a rejected credential, an
exhausted quota, a malformed spec -- still rotates, because none of those
improve by waiting. The same job, before and after:

```
                     before   after
sessions created         7        1
work discarded           6        0
agent.arrived           31        5
proxy calls             16        3
reached the gate        no      yes
```

Three things had to travel with the held session, and each failed silently
until it did. Whether the session had done any work, or a second immediate
limit cancelled it anyway. Which gates the operator had already answered, or a
replayed approval asked them to authorise a refund that had already been made.
And the translator state, or a subagent that finished after the resume stayed
on the map forever and the sandbox result lost the office it belonged to --
which drops the `yard.verified` the operator reads before countersigning.

The shipped recording is the delegated run: 71 entries, three threads, one gate
raised and countersigned, two sandbox checks, chain intact.

## Capabilities considered and not used

Four TrueForge features are deliberately off. Listing them because "did not use
it" and "used it and it was wrong for this" are different facts, and only one of
them says the harness was understood.

**Generative UI, off.** It lets the model draw into the operator's view.
Everything here rests on the operator seeing what the *boundary* did rather than
what the model says it did: every building, figure and held gate is a harness
event or a proxy decision. Giving the model a channel to render its own account
of the mission would put the one untrusted party in the room in charge of the
display.

**Clarifying questions, off**, and for a sharper reason. The Gate is the human
interaction, and it is bound to one call's exact arguments: the operator answers
"may this run" about a call they can read. A clarifying question is free text
with nothing behind it, composed by a model that has just read a ticket written
by a member of the public. An injected instruction that cannot reach a tool can
still reach a person. *"Confirm you want the customer list sent"* is a question,
not a tool call, and it would arrive looking like the agent asking rather than
the attacker.

**Code mode, not used.** It is genuinely interesting here and the reason for
leaving it is worth stating: batching tool calls into code changes where the
proxy sees them. The boundary works because every call crosses it individually
and is evaluated against the scope; a batch that resolves several calls inside
one execution is a different enforcement problem, not a harder version of the
same one. Worth building on top of, not worth guessing at days from a deadline.

**Skills, not used.** The mission brief is derived per-mission from the granted
scope, naming the exact offices and identifiers that scope allows. A static
skill pack cannot do that, and a brief describing authority the agent does not
hold is what sent an earlier version at a door it had no key to.

## Reconnection, verified

A pending approval survives the browser going away, and this is the property
that makes The Gate usable rather than a demo trick. Proven against a running
instance rather than assumed:

1. Mission granted, agent runs, `charge.refund` raises a gate.
2. The event stream is closed -- what a reload does.
3. A fresh connection asks from cursor 0 and replays the whole mission,
   including the pending gate and its exact arguments.
4. The recovered `toolCallId` is approved and accepted; the turn resumes.

None of the state lives in the browser, which is why the refresh costs
nothing: TrueForge keeps the turn paused, the queue holds the pending call
server-side, and the feed replays from any cursor.

Note the claim is **browser refresh**, not server restart. Missions are held in
memory, so restarting the control plane loses them. Saying otherwise on camera
would be the kind of overclaim that unravels in a question.

## Verified live for Scope City

- [x] TrueForge reaches the local authenticated MCP proxy.
- [x] A returned `turn.done` error rotates the model pool (observed 429 → next provider).
- [x] Approval ends a turn and a new approval-input turn resumes the exact call.
- [x] Two sequential gates (refund, then mail) complete one mission.
- [x] Browser-facing SSE replay resumes from the last Scope City sequence.
- [x] Dynamic subagents genuinely spawn: six child threads on one run, titled
      from the brief's two assignments, drawn on the map as separate figures.
- [x] **Sandbox execution.** `yard.opened` once and `yard.verified` twice in the
      shipped recording, against a configured Daytona provider. This sat under
      "still unverified" until 2026-08-30 while it was already working, which is
      the drift this file exists to prevent.
- [x] **TrueForge as an MCP client of a server nobody here wrote.** A harness
      session reached GitHub's own MCP server through the scope proxy:
      `tools/list` returned one office where the upstream advertises twenty-six,
      and `call.allowed issue.get` crossed the boundary. Three runs out of
      three on 2026-08-30. See `apps/demo/src/probe-forge-through-harness.ts`.
- [x] **A local model driving a mission.** `local/qwen` on Ollama, registered as
      a provider, completed the same chain. Tool calling is less reliable than
      the hosted models: one run in seven emitted the call as prose instead of
      calling it, which is a completed turn with no call in it rather than an
      error the pool can rotate over.
- [x] **The harness in Docker on Windows.** Standalone will not start; Compose
      does, on host port 8791. See the section at the end of this file.

## Still unverified

Kept honest so nothing unproven reaches the demo:

- [ ] Whether a turn paused on `tool.approval_required` survives a **full server
      restart** (browser refresh is expected to be fine).
- [ ] Whether a session whose turn failed on a 429 can be re-run rather than
      recreated. If it can, delegated missions become completable on a free
      tier; see "What delegation costs" above.
- [ ] Whether `tools/list` is re-requested between turns, so a scope granted
      mid-session changes the visible tool set.
- [ ] A **local** sandbox provider. 0.1.4's provider manifest accepts only
      `type: "daytona"`, so the bwrap/socat/ripgrep route does not exist on this
      version. Verified by reading `SandboxProviderManifest` in the running
      instance's OpenAPI document, after installing those binaries achieved
      nothing. Execution itself is verified above, with a Daytona key.

## Standalone will not start on Windows; Compose will

`npx @truefoundry/trueforge` dies on this machine every time, immediately after

```
warn Removing leftover Code Mode socket parent
warn Local sandbox fallback is unavailable (win32)
```

with a segfault on Node 23.2 and a silent exit on a portable Node 22.13. It
never binds its port. Deleting the stale `tf_cms` socket directory, disabling
Code Mode, running outside the msys shell and `pnpm dlx` all reproduce it, so it
is not the Node version and not the shell.

Compose works, and is the documented path for exactly this reason ("the whole
stack under Compose, for when the agent is doing real work").

**Every command below runs in a TrueForge checkout, not in this repository.**
Scope City has no Dockerfile and no `packages/trueforge`, so running them here
fails on a missing build context and a missing `.env`. Clone it first and stay
in its root for the whole section:

```bash
git clone https://github.com/truefoundry/trueforge.git
cd trueforge
git checkout v0.1.4          # the version this was run against
```

With that established, two things are not obvious from the README:

- **The image is not published.** `docker compose up` alone fails on
  `pull access denied for truefoundry-server`. Build it first, and the build
  requires a version:

  ```bash
  docker build -t truefoundry-server:latest --build-arg APP_VERSION=0.1.4 .
  ```

  Without `--build-arg` the build fails closed on purpose: `APP_VERSION
  build-arg is required`.

- **`packages/trueforge/.env` must exist** -- that path is inside the TrueForge
  checkout -- because the compose file marks it `required: true`. Copying the
  example is enough for a local run:

  ```bash
  cp packages/trueforge/.env.example packages/trueforge/.env
  ```

- **Compose maps host 8791**, not 8790, to avoid colliding with a host `pnpm
  dev`. Scope City's own proxy defaults to 8791 too, so one of them has to move
  -- the probes take `PROBE_PORT`.

The consequence worth knowing before wiring anything: **the harness is now in a
container, so `127.0.0.1` is the container**. An MCP server running on the host
has to be registered as `host.docker.internal`, and bound to `0.0.0.0` rather
than loopback, or the harness registers a URL it can never reach and every tool
call fails with a connection error that looks like a boundary refusal.

That applies to **every** address handed to the harness, and the second one is
easy to miss because it fails so quietly.

| What is registered | Set it to | Symptom when loopback |
|---|---|---|
| The mission's MCP endpoint | `SCOPE_PROXY_PUBLIC_HOST=host.docker.internal`, with `SCOPE_PROXY_BIND=0.0.0.0` | `ECONNREFUSED 192.168.65.254:<port>` in TrueForge's UI, tens of seconds in |
| The local model's endpoint | `OLLAMA_PUBLIC_HOST=http://host.docker.internal:11434` | **Nothing at all.** The provider saves, the model appears in the picker, and it never answers |

The model one is worse than the MCP one because there is no error anywhere a
person is looking. The provider is accepted, the model shows up, the operator
selects it, sends a message, and waits. Every request dies at connect inside the
container. Gemini keeps working throughout, which points suspicion at the local
model rather than at the address it was registered under.

`OLLAMA_HOST` stays whatever *this* process uses to reach Ollama --
`http://127.0.0.1:11434` is right there. `OLLAMA_PUBLIC_HOST` is what TrueForge
is told, and it defaults to `OLLAMA_HOST`, which is correct whenever both are on
the same machine.

Ollama also has to be listening where the container can reach it. Started as a
Windows service it binds loopback; confirm with:

```bash
docker exec trueforge-server-1 node -e "fetch('http://host.docker.internal:11434/api/tags').then(r=>console.log(r.status))"
```

`200` means the harness can see it. Anything else is a network problem, not a
model problem.
