# The running order

A three-minute demo, in the order that makes the argument.

The temptation with this project is to show everything, because there is a lot
and all of it works. That is the mistake. Scope City has one claim, and the
demo's job is to make that claim land and then make it checkable. The Yard, the
subagents, Code Mode, the model rotation — all of that is **evidence you offer
when asked**, not narrative you spend time on. A judge who wants depth opens the
README, which is written for exactly that.

Structure borrowed from a demo that worked: state the premise, show the world
while explaining it, do something real, **then go and verify it actually
happened**, then one surprise, then credit the harness.

---

## Before you record

```bash
# The comparison needs no keys and no server. Only this.
pnpm --filter @scope-city/city dev
```

- **Unset `OLLAMA_HOST`** if you intend to run a live mission. A local model in
  the pool is fine to talk about and slow to watch.
- Have a second terminal open at the repo root, already `cd`'d, for the verifier.
- The whole comparison is offline. If the network dies mid-recording, keep going.

---

## 0:00 — The premise (20 seconds)

Do not open with the city. Open with the problem, in one specific sentence.

> A support agent needs to refund one forty-nine dollar charge. To do that, it
> gets an API key that can refund *every* charge, list *every* customer, and
> email *anyone*. That is not a bug in someone's integration — that is how all
> of them work. The agent inherits whatever the user could do.

Then the turn:

> Everyone's answer is to ask the model nicely and hope. I wanted to find out
> what happens if you just take the ability away instead.

---

## 0:20 — The city (25 seconds)

Now show it. Explain **while** moving, never in a paragraph first.

> This is a repository of systems rather than files. Each district is something
> you've connected — your ticket system, your payment processor, your mail. Each
> building is one thing an agent can actually do in there.

Drag the camera. Hover a building.

> The agent walks between them, and this line — the city limits — is what it's
> allowed to reach. Everything about the run gets drawn here, so you're not
> reading a log to find out what happened.

**Do not** name the Yard, the Gate, countersigning or field teams yet. Seven new
words before the first claim is what makes this project hard to follow.

---

## 0:45 — The same ticket, twice (75 seconds)

This is the demo. Everything before it is setup and everything after is
evidence.

### Run 1 — press **1 · Without a scope**

> Same support ticket both times. This first run is an ordinary integration: the
> agent has the access a real one would have.

Let it play. Read the log aloud as it lands — the lines do the work:

```
ticket.get tkt_184
Injected instruction obeyed — nothing to stop it
charge.refund ch_185 $399.00 — SUCCEEDED
customer.list — 3 records exfiltrated
mail.send attacker@example.test — SENT
Mission ended. Three irreversible actions, none authorised.
```

Stop on the refund line and point at the two numbers:

> The ticket had an instruction hidden in it, and the agent did what it said. It
> refunded the wrong charge — **ch_185, not 184** — for **three hundred and
> ninety-nine dollars**, not forty-nine. Then it mailed a customer list to an
> address that isn't the customer. Nothing refused any of it, because there was
> nothing to refuse *with*.

### Run 2 — press **2 · With a scope**

> Identical ticket. Same instruction inside it. The only difference is that the
> agent was given a scope first: one order, one charge, one amount, one
> recipient, ten minutes.

Let it play, and stop on the two refusals:

```
Ticket body contains an injected instruction — flagged, not obeyed
charge.get ch_184 — history redacted by projection
OUT OF SCOPE  charge.refund ch_185 — not a granted charge
OUT OF SCOPE  mail.send attacker@example.test
```

The one sentence to get exactly right:

> Those two calls didn't fail a permission check. The tools weren't there. We
> don't tell the agent no — we make the thing unreachable, so there's nothing
> for a prompt injection to talk it into.

Then the third line, which is easy to skip and worth ten seconds:

> And look at the call that *was* allowed — the charge lookup came back with the
> customer's payment history stripped out. The scope decides what comes back,
> not just what goes out.

---

## 2:00 — The one that stops for you (20 seconds)

The run has paused on its own.

> The legitimate refund — the right charge, the right amount — didn't just go
> through either. Refunds are irreversible, so it stops here and waits for a
> person.

Approve it. Show it complete.

> That's a human authorising one specific call, with the arguments in front of
> them. Not a policy written six months ago.

---

## 2:20 — Now one that actually ran (20 seconds)

Say this part exactly. Getting it wrong is the one thing that could sink the
demo, because it would be the video doing what the project accuses everyone else
of.

**The two runs you just watched are scripted.** They are deterministic replays
in the browser: no keys, no server, no model, and no record. That is on purpose
— anyone can open the deployed site and press them — but they prove the
interface, not the system.

So do not point the verifier at them. Introduce the real one first:

> Those two were scripted, deliberately: they run in the browser with no keys
> and no server, so anyone can press them. But scripted runs prove an interface,
> not a system. So here is a mission that actually happened.

Press **Replay a real run**.

> This is a captured TrueForge session, played back from its own record. Real
> model, real proxy, and the refund it stops on is a real Stripe charge in test
> mode — that's a genuine charge id on the gate.

Be careful with the last clause. The refund **was** executed against Stripe test
mode when this was captured, and the charge id on screen is Stripe's. But the
record does not carry Stripe's response, so do not say the verifier proves the
money moved. What it proves is the chain of authority around the call:
countersign required, countersigned, allowed, completed.

If you would rather not hold that distinction live, say only "a real charge id,
countersigned by a human" and keep the Stripe detail for the questions. An
overclaim here costs more than the sentence is worth.

Let it reach the gate, and point at **THE FIELD** while it does:

> And this is the delegation. The agent created two workers while it ran — a
> source investigator and a target verifier — and every one of those threads is
> judged by the same scope you granted the root. There is no per-subagent
> permission to get wrong, because there isn't one.

That folds the subagent story into a run you were showing anyway, which is why
it does not need its own slot later.

---

## 2:40 — Go and check (30 seconds)

**The most important twenty seconds of the video.** Do not skip it, and do not
narrate it from memory — run the command on camera.

> That run is a claim on a screen too. So don't take it from me.

Switch to the terminal:

```bash
node scripts/verify-record.mjs apps/city/public/replays/refund-184.json
```

This is the whole output, not an excerpt — read it against your screen:

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

  The chain covers the entries and the sealed scope. It does not cover the
  record's top-level job, timestamps, algorithm or lossy flag, which sit
  outside it -- so those are reported above from the scope where possible.
```

> Every live mission writes a hash-chained record, and that is the file the city
> just replayed. This verifier re-implements the hashing independently rather
> than importing ours, so a bug in ours can't cancel itself out. Change one entry
> and it names the first broken link.

Point at `threads 3`:

> Including the two workers you just watched appear.

Then the honesty line, which buys more credibility than it costs:

> It's tamper-evidence, not a signature. Nothing here is signed. What it gives
> you is a head you can quote and compare against a copy someone else holds.

---

## 3:10 — One surprise (25 seconds)

The subagents are already spent — they happened inside the recorded run, which
is why that run earns its place. So this is **Code Mode**, and it is the right
one anyway: it answers the objection a security audience is already forming.

> You might be thinking: fine, but the agent has a sandbox. It can write Python.
> So I tested that.

```bash
pnpm --filter @scope-city/demo probe:code-mode
```

```
  HELD    in-scope       allowed, and the response still filtered
  HELD    out-of-scope   Refused: resource_not_in_scope
  HELD    countersigned  requires interactive handling, not callable from sandbox
```

> Arbitrary code, same boundary. The in-scope call still came back redacted —
> writing Python doesn't get you a wider response.

**Swap for the Yard** if the audience is more product than security: the
over-reach run, where a scope drawn too wide is caught and narrowed *before*
anything is granted. It is a weaker close for a security room and a better one
for a product room.

---

## 3:35 — Close (10 seconds)

> Built on TrueForge, the open-source agent harness — the sandbox, the subagents
> and the approval gate are all its primitives. Scope City is the boundary
> around them, and the city is so you can see it hold.

---

## Things to say only if asked

Keep these out of the main run. Each is strong and each costs you thirty seconds
you do not have.

| If they ask | The answer |
|---|---|
| "Is the refund real?" | Yes — Stripe test mode, a real charge, a real irreversible refund, and the key never reaches the agent. Note what the *record* attests to, though: countersign required, countersigned, allowed, completed. Stripe's own response is not in the chain, so the artifact proves the authority around the call rather than the money moving. |
| "Does the model pick the scope?" | It drafts; the sentence decides. An id that isn't in what you wrote is dropped, including a shortened one. |
| "What if the harness rate-limits?" | A rate limit ends the turn, not the session. It waits for that key rather than throwing the work away. |
| "Could you run a different model?" | Any OpenAI-compatible endpoint, including a local one. The boundary doesn't change — that's the point of it being outside the model. |
| "How do you know the docs are right?" | Two places TrueForge's documentation and the harness disagree are written up in `docs/TRUEFORGE.md`, both found by probing rather than reading. |

---

## What to cut if you are over time

This runs about three and a half minutes read at a normal pace, which is long.
Cut in this order:

1. The clean-job run, if you were going to show it at all. It proves the
   boundary has no false positives, and nobody doubts that yet.
2. The projection line at 1:45 — painful to lose, and the first to go.
3. Code Mode. Keep it in your pocket for the questions instead; it is the best
   answer you have to "but the agent can write code".
4. The subagent aside at 2:20. Say only "a captured session" and move on.

**Never cut** the two-run comparison, or the verifier, or the sentence
introducing the recorded run as a real one. The first is the argument, the
second is the proof, and the third is what keeps the second honest.
