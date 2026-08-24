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

Every event has `id`, `thread_id` and a sequence number, so a stream can be
resumed after a disconnect.

| Event | Payload we care about | What Scope City does with it |
|---|---|---|
| `turn.created` | `turn_id`, `previous_turn_id`, `state` | Mission starts |
| `model.message` | `id`, `thread_id`, `content`, `tool_calls[]` | Transmissions log |
| `model.message.delta` | same `id`, streamed `content` | Merge into the base event and re-render |
| `tool.response` | `thread_id`, `tool_call_id`, `content` | Agent arrives at an office |
| `tool.approval_required` | `thread_id`, `tool_calls[]` with `tool_call_id`, `source_event_id` | **The Gate** — klaxon, countersign UI |
| `tool.response_required` | `thread_id`, `tool_calls[]` | Client-side tool execution |
| `thread.created` | `thread_id`, `title`, `parent`, `agent_info` | **A second figure appears in the field** (subagent) |
| `thread.done` | `thread_id`, `state` | That figure leaves |
| `mcp.initialize` | `thread_id`, `mcp_servers[]` (name, session_id) | Districts come online |
| `mcp.auth_required` | `mcp_servers[]` (id, name, auth_url) | District needs OAuth |
| `sandbox.created` | `sandbox_id` | The Yard lights up |
| `turn.done` | `state.status` (done / cancelled / error) | Mission ends |

**Deltas:** `model.message` arrives first with empty content, then
`model.message.delta` fragments share the same event `id`. Merge deltas into the
base event; do not treat them as separate messages.

## Approvals — this is a new turn, not a callback

When a tool needs approval the harness emits `tool.approval_required` **and
pauses the turn**. You do not answer it inline. You resume by creating a *new
turn* whose input is one `UserToolApprovalEvent` per pending `tool_call_id`.

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

1. **No auth** — "for public or network-trusted servers". This is what our local
   proxy uses.
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

## Still unverified

Kept honest so nothing unproven reaches the demo:

- [ ] Whether TrueForge reaches a `localhost` MCP server, or needs a public URL
      (tunnel fallback: Cloudflare).
- [ ] Whether a turn paused on `tool.approval_required` survives a **full server
      restart** (browser refresh is expected to be fine).
- [ ] Whether `tools/list` is re-requested between turns, so a scope granted
      mid-session changes the visible tool set.
- [ ] Whether the sandbox can reach the network for `pip install`.
