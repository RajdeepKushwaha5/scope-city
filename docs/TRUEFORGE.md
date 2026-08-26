# TrueForge integration notes

Everything here was read from the TrueForge docs or verified against a running
instance. **If it is not in this file, do not assume it** — check first and add
it, rather than coding against a guess.

Last verified: 2026-08-24.

---

## Which SDK

There are two different TrueFoundry products with similar names. Getting this
wrong costs a day.

| | Package | Client | What it is |
|---|---|---|---|
| **What we use** | `@truefoundry/trueforge-sdk` | `TrueForge` | The open-source agent harness. Required by the hackathon rules. |
| Not this | `truefoundry_gateway_sdk` | `TrueFoundryGateway` | The hosted TrueFoundry platform (AI Gateway / MCP Gateway). Needs an account. |

Server package: `@truefoundry/trueforge` — `npx @truefoundry/trueforge`, serves
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
cycle. Turns chain automatically — we do not track message history ourselves.

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
| `tool.approval_required` | `threadId`, sparse `toolCalls[]` containing `id`, `sourceEventId` | **The Gate** — look up the exact reconstructed call and pause |
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

## Approvals — this is a new turn, not a callback

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
| Survives a refresh? | Yes — the turn is paused server-side | N/A, decision is instant |

So the countersign happens *upstream* of the proxy. Our proxy must **not** block
an MCP request waiting for a human — an MCP call held open for minutes will time
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

1. **No auth** — for public or network-trusted servers.
2. **Header auth** — static headers carrying an API key or bearer token.
3. **OAuth (Dynamic Client Registration)** — TrueForge acts as the OAuth client.
   Requires `PUBLIC_BASE_URL` to be set so it can redirect back.

## Sandbox

1 vCPU, 1 GB RAM, 1 GB disk, Debian slim, **2-minute cap per command**. Stops
after 5 minutes idle, deleted 30 days after stopping. Persists across turns
within a session. Ships with git, curl, jq, ripgrep, tree, helm, zip and Python
3.13 (pydantic, fastmcp, requests, genson); `pip` and `apt-get` work.

Sandbox-as-tool: the agent runs *outside* the sandbox and calls it over an API,
so credentials never enter it. Provider is Daytona.

## Subagents

Dynamic and parallel, **one level deep**, sharing the root's tools and sandbox.
**User-defined named specialists are not supported.** Do not script an
"adversarial prosecutor" subagent and claim the harness produced it — orchestrate
our own turns server-side, and animate `thread.created` / `thread.done` where the
harness genuinely spawns something.

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

## Still unverified

Kept honest so nothing unproven reaches the demo:

- [ ] Whether a turn paused on `tool.approval_required` survives a **full server
      restart** (browser refresh is expected to be fine).
- [ ] Whether `tools/list` is re-requested between turns, so a scope granted
      mid-session changes the visible tool set.
- [ ] Sandbox execution on the demo machine. Needs a `DAYTONA_API_KEY`:
      0.1.4's provider manifest accepts only `type: "daytona"`, so the local
      bwrap/socat/ripgrep route does not exist on this version. Verified by
      reading `SandboxProviderManifest` in the running instance's OpenAPI
      document, after installing those binaries achieved nothing.
