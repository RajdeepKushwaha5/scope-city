# Scope City — working notes

`README.md` is the product: what this is and how to run it. **This file is how
to work inside the codebase** — the invariants, the ordering rules, and the
mistakes that are easy to make twice.

---

## Commands

```bash
pnpm dev         # mission control plane (:8787) + city (:5180)
pnpm test        # vitest across every package that has tests
pnpm typecheck   # tsc --noEmit everywhere
pnpm build       # build all workspaces

pnpm --filter @scope-city/scope test    # one workspace
pnpm demo:models                        # register configured models in TrueForge
pnpm demo:headless                      # run a mission with no browser
```

Node >= 22.5, pnpm 11.10. There is no linter: **the compiler and the suite are
the only gates**, so run `pnpm typecheck` and `pnpm test` before calling
anything done.

TrueForge itself must run on Linux or macOS — the standalone server segfaults on
`win32`. On Windows use WSL2 and `scripts/trueforge-up.sh`, which runs in the
foreground on purpose: WSL shuts a distro down when its last process exits, so
backgrounding the server from a one-shot `wsl -- …` kills it immediately.

---

## Layout

| Path | Responsibility |
|---|---|
| `packages/scope` | Scope schema, request evaluator, response projector. **Pure.** |
| `packages/ledger` | Atomic quota claims, idempotency, replay protection. **Pure.** |
| `packages/proxy` | The enforcing MCP proxy. The only thing the agent can reach. |
| `packages/harness` | TrueForge SDK driver, event translation, model rotation. |
| `packages/mission` | Countersign binding, mission brief, replayable event log. |
| `apps/demo` | Control plane on `:8787`, SSE replay, TrueForge setup. |
| `apps/city` | React + Canvas isometric renderer and operator HUD. |
| `mcp/` | Demo MCP servers — ticket, payments, mail. Deterministic fixtures. |

`scope` and `ledger` have **no I/O and no ambient state**. `now` and `consumed`
are arguments, not reads. That is not a style preference: it is what makes every
branch of the security boundary reachable from a test with nothing stubbed.
Keep it that way. If a decision function needs the time, it takes the time.

---

## The pipeline

Every tool call the agent makes runs this, in this order:

```
decide → claim → countersign → execute → project
```

**The order is load-bearing.** Each step assumes the previous one ran:

1. **decide** — pure policy. Does the scope permit this call, with these
   arguments, right now?
2. **claim** — reserve quota *before* acting. A claim is a reservation, not a
   fact.
3. **countersign** — for gated tools, verify the human approved *this* call.
4. **execute** — the irreversible thing happens here and only here.
5. **project** — filter the response down to the fields the scope allows.

### Step 0: retries short-circuit before policy

A retry of an already-settled call returns the recorded result **without
re-deciding**. This looks like a hole and is the opposite of one: re-running
policy would refuse the retry for consuming quota the original call already
spent, and the caller would then retry an action that has *already happened*.
Idempotency has to sit outside the policy gate or it is not idempotency.

### Claims settle; they do not decrement

`settle()` turns a reservation into a fact. `release()` **refuses on a settled
claim** — you cannot un-send an email by decrementing a counter. If you find
yourself wanting to release a settled claim, the model is wrong, not the guard.

### The ledger's critical section is synchronous

No `await` between reading a quota and writing the claim. Node's single thread
is the mutex; an `await` in there reintroduces exactly the ten-way race the
package exists to prevent. `packages/ledger` tests that race directly.

---

## Two refusals, deliberately different

| | The Gate | The city limits |
|---|---|---|
| Mechanism | TrueForge `tool.approval_required` | The scope proxy |
| Asks a human? | Yes | **Never** |
| Fires when | The action is irreversible | The call is outside the scope |

Both are needed. A scope stops what should never happen; a gate pauses what
should happen only once someone has looked. Do not collapse them into one
mechanism — the contrast *is* the product.

### Countersign fingerprints must be derived twice

`checkFingerprint()` takes the fingerprint the human saw and compares it to one
the proxy derives from what it is *about to run*. It **never echoes its input**.
The moment one derivation feeds the other, the approval is approving itself and
the TOCTOU window is back.

---

## Enforcement is on four surfaces, not one

`tools/list` (absence), the request, **the response**, and the ledger.

The response surface is the one that gets forgotten. An allowed `charge.get` can
legitimately return a customer's whole payment history — filtering *what may be
called* without filtering *what comes back* leaks precisely the data you thought
you had fenced off. `project.ts` prunes to allowed paths and is enforcement, not
advice.

---

## Amount checks: a ceiling is not a bound

```ts
if (value <= 0) return { allowed: false, reason: "amount_not_positive", … };
```

`-1000` is comfortably under a `4900` ceiling, and a negative refund runs
backwards through the downstream system, restoring refundable headroom. Both
layers refuse non-positive amounts. Amounts are **integer minor units**
everywhere — never floats.

---

## TrueForge integration traps

These each cost real debugging time. They are written down so they cost it once.

- **The agent spec is camelCase.** The SDK's TypeScript surface is camelCase and
  converts to snake_case on the wire; the OpenAPI document shows the *wire*
  format. Writing `mcp_servers` because the spec says so produces an object the
  SDK accepts, silently drops, and then starts a perfectly healthy session with
  **no tools at all**. Nothing anywhere tells you why. See the comment in
  `packages/harness/src/driver.ts` — do not "fix" those keys.

- **Approval is a new turn, not a callback.** The harness pauses the turn and
  waits for a *fresh* turn carrying a `UserToolApprovalEvent`. Code that expects
  to answer the event in place hangs forever. `resume()` exists to make that
  impossible to get wrong.

- **A gate ends the stream.** TrueForge closes the turn stream when it raises an
  approval, so a single `runTurn` stops before the action ever runs.
  `runMission()` loops for exactly this reason.

- **Model names need a `provider/model` prefix**, and a given provider can only
  be registered once — hence `CustomModelProvider` for the additional Gemini
  keys.

- **Bind to `127.0.0.1`, not `localhost`.** Node resolves `localhost` to `::1`
  while the harness listens on IPv4, and the only symptom is `fetch failed`.

- **One transport per request.** The MCP stateless transport does not tolerate
  reuse; a shared `StreamableHTTPServerTransport` returns 500s.

- **Health checks carry their reason.** `reachable()` returns
  `{ ok: false, reason }`, never a bare boolean. A check that says "no" without
  saying why sends you to the network when the answer was in the response body.

---

## Conventions

- Deny by default. A missing entry is a refusal, never a permission.
- New enforcement logic goes in `scope` or `ledger` as a pure function, and gets
  a test for the *failure* path before the success path.
- Errors returned to the agent say what was refused, never what exists outside
  the scope. Refusal messages are an information channel too.
