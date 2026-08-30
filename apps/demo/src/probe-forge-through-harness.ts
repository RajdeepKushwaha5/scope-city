import {
  HarnessDriver,
  missionAgentSpec,
  rotationCandidates,
} from "@scope-city/harness";
import {
  MissionRegistry,
  newMissionId,
  startProxyHttp,
} from "@scope-city/proxy";
import { CountersignBook } from "@scope-city/mission";
import type { Scope } from "@scope-city/scope";
import { createFixtureMission } from "./fixture-mission.js";
import { missionSystemsAsync, forgeStatus } from "./systems.js";
import { boundaryReachability, urlHost } from "./reachability.js";

/**
 * The arrow this project had never actually tested.
 *
 * `mcp/src/probe-forge.mts` proves Scope City can front GitHub's MCP server:
 * it calls `forgeSystem()` in-process and reads a real issue. What it does not
 * prove is that a TrueForge agent drives any of it, and the claim on the README
 * is a chain of three:
 *
 *   TrueForge --MCP--> Scope City --MCP--> GitHub
 *
 * Testing the right-hand arrow and asserting the left is how a project ends up
 * describing something it has not seen work. This drives the whole chain: a
 * real harness session, a real proxy, a real upstream, and a real issue.
 *
 * What it checks is not that the agent succeeds. It is what the agent could
 * *see*: the upstream advertises twenty-six tools, the scope grants one, and
 * `tools/list` through the boundary has to show one.
 */

const PORT = Number(process.env.PROBE_PORT ?? 8794);
const BIND = process.env.PROBE_BIND ?? "127.0.0.1";
const PUBLIC_HOST = process.env.PROBE_PUBLIC_HOST ?? "127.0.0.1";
/** How long a cancel gets before cleanup stops waiting for it. */
const CANCEL_MS = Number(process.env.PROBE_CANCEL_MS ?? 10_000);
/** Where this process reaches its own proxy. `0.0.0.0` is a bind, not an address. */
const LOCAL_HOST = BIND === "0.0.0.0" ? "127.0.0.1" : BIND;
const TURN_MS = Number(process.env.PROBE_TURN_MS ?? 120_000);

const BRIEF = `You are reading one GitHub issue through the __SERVER__ server.

Call issue.get with issue_number "__ISSUE__". Report the issue's title and state
in one sentence, then stop. Do not call anything else.`;

function newProxyToken(): string {
  return `probe-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** One JSON-RPC round trip against the mission endpoint, SSE or JSON. */
async function rpc(
  url: string,
  token: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    // So a stalled preflight ends at the probe's own deadline rather than at
    // the socket's, which is neither configured nor short.
    signal,
    headers: {
      "content-type": "application/json",
      // The spec requires a client to accept both; omitting either is a common
      // cause of a 406 that reads like a server fault.
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);
  const line = text.startsWith("event:")
    ? text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim()
    : text;
  return line ? (JSON.parse(line) as unknown) : null;
}

/**
 * What the agent can see, asked rather than inferred.
 *
 * The probe's stated purpose is tool invisibility: the upstream advertises
 * twenty-six tools and the scope grants one. It used to prove that by watching
 * one allowed call succeed -- which a regression that also exposed
 * `issue.close` would pass just as happily. The only evidence for "one office"
 * is the listing itself, so ask for it.
 */
async function officesVisibleThroughTheBoundary(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  await rpc(
    url,
    token,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "probe", version: "0" },
      },
    },
    signal,
  );
  await rpc(
    url,
    token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    signal,
  );
  const listed = (await rpc(
    url,
    token,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    signal,
  )) as { result?: { tools?: { name: string }[] } };
  return (listed.result?.tools ?? []).map((tool) => tool.name).sort();
}

async function main(): Promise<void> {
  const forgeOn = forgeStatus();
  if (!forgeOn.live) {
    console.error(
      `The Forge is not configured (${forgeOn.reason}). ` +
        "Set FORGE_REPOSITORY=owner/repo and GITHUB_TOKEN.",
    );
    process.exit(2);
  }

  /*
   * The same check the city makes, for the same reason.
   *
   * This probe registers its endpoint with TrueForge and then waits for the
   * harness to connect back. With the harness in a container and the proxy on
   * loopback, the connection is refused and the failure arrives as an MCP
   * transport error naming a Docker gateway address -- which reads like the
   * boundary is broken rather than like two flags disagreeing.
   */
  const reachable = boundaryReachability({
    bind: BIND,
    publicHost: PUBLIC_HOST,
    names: { bind: "PROBE_BIND", publicHost: "PROBE_PUBLIC_HOST" },
  });
  if (!reachable.ok) {
    console.error(reachable.reason);
    process.exit(2);
  }

  const issue = process.env.FORGE_ISSUE ?? "102";
  const systems = await missionSystemsAsync();
  const forge = systems.find((system) => system.district === "forge");
  if (!forge) throw new Error("the Forge did not connect");

  console.log(
    `  upstream tools   ${forge.offices.length} offices exposed by the Forge`,
  );

  const missionId = newMissionId();
  const now = Date.now();

  /*
   * One office, one issue, ten minutes.
   *
   * `issue.comment` and `issue.close` are implemented and deliberately not
   * granted: the point of the run is what the agent cannot see, and leaving
   * them out of the scope is the only way to show that `tools/list` follows
   * the grant rather than the implementation.
   */
  const scope: Scope = {
    missionId,
    scopeId: "SC-FORGE",
    agent: "forge-reader",
    job: `Read issue #${issue}`,
    state: "granted",
    offices: ["issue.get"],
    resources: { issue_numbers: [issue] },
    limits: { maxAmountMinor: {}, maxCalls: {}, maxResponseBytes: 64_000 },
    projection: { "issue.get": ["number", "title", "state"] },
    countersignRequired: [],
    expiresAt: now + 10 * 60 * 1000,
    grantedBy: "operator:probe",
    grantedAt: now,
    version: 1,
  };

  const seen: string[] = [];
  const registry = new MissionRegistry();
  const token = newProxyToken();
  const proxy = await startProxyHttp({
    registry,
    port: PORT,
    host: BIND,
    token,
  });

  const fixture = createFixtureMission({
    missionId,
    book: new CountersignBook(),
    systems,
    scope,
    emit: (event) => {
      const e = event as { type?: string; office?: string };
      if (e.type)
        seen.push(e.office ? `${e.type} ${e.office}` : String(e.type));
    },
  });
  registry.register(fixture.mission);

  const driver = new HarnessDriver({
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790",
  });

  const configured = (process.env.SCOPE_MODELS ?? "")
    .split(",")
    .filter(Boolean);
  const models =
    configured.length > 0
      ? configured
      : rotationCandidates(await driver.listModels());
  if (models.length === 0)
    throw new Error("no models registered with TrueForge");

  const name = `scope-city-forge-${Date.now().toString(36)}`;
  await driver.registerMcpServer({
    type: "remote",
    name,
    url: `http://${urlHost(PUBLIC_HOST)}:${PORT}/mission/${missionId}/mcp`,
    description: "Scope City boundary over GitHub's MCP server",
    auth: { type: "header", headers: { Authorization: `Bearer ${token}` } },
  });

  const sessionId = await driver.createSession(
    missionAgentSpec({
      model: models[0]!,
      proxyName: name,
      gatedTools: [],
      sandbox: false,
      instructions: BRIEF.replaceAll("__SERVER__", name).replaceAll(
        "__ISSUE__",
        issue,
      ),
    }),
  );

  console.log(`  harness session  ${sessionId} on ${models[0]}`);

  // Kept apart so one can be preferred over the other rather than concatenated.
  let assembled = "";
  let streamed = "";
  let visible: readonly string[] = [];
  let timedOut = false;

  /*
   * A deadline that actually ends the wait.
   *
   * This was `setTimeout(() => undefined, TURN_MS)`: a timer that fired into
   * nothing while the loop below went on awaiting the stream. `PROBE_TURN_MS`
   * looked like a bound and was decoration, so a stalled turn ran until the
   * driver's own ten-minute default with CI or an operator waiting through it.
   * Racing the drain against the timer is what makes the number mean something.
   */
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TURN_MS);

  const drain = async (): Promise<void> => {
    for await (const event of driver.runTurn(sessionId, [
      {
        type: "user.message",
        content: `Read issue ${issue} and report its title and state.`,
      },
    ])) {
      if (deadline.signal.aborted) return;
      /*
       * `model.message.delta.content`, which is where the words actually are.
       *
       * This read `assistant.text`, an event type the harness does not emit, so
       * the probe printed "the agent said (nothing)" after every successful run
       * -- on Gemini as well as on the local model. The tool call and the
       * refusals were reported correctly, which made the silence look like a
       * model that would not answer rather than a reader looking in the wrong
       * field. Confirmed against the stream: a turn asking "what is 2 + 2"
       * arrives as `{"content":"4","type":"model.message.delta"}`.
       */
      const e = event as { type?: string; content?: unknown };
      /*
       * Both shapes, and neither counted twice.
       *
       * A turn can arrive as an assembled `model.message` carrying the whole
       * answer, or as an empty one followed by `model.message.delta` fragments.
       * Reading only the deltas reported "(nothing)" for a run that answered in
       * one piece; reading both without care would print the answer twice when
       * a server sends an assembled message *and* fragments.
       *
       * The assembled form wins when it has content, because it is the whole
       * answer rather than a piece of one.
       */
      if (e.type === "model.message" && typeof e.content === "string" && e.content !== "") {
        assembled += e.content;
      }
      if (e.type === "model.message.delta" && typeof e.content === "string") {
        streamed += e.content;
      }
    }
  };

  /*
   * One race, around everything the deadline is supposed to bound.
   *
   * The rejection has to be observed from the moment it can happen. Building
   * the timeout promise and only reaching the `Promise.race` after an awaited
   * preflight left a window where an abort during `initialize` or `tools/list`
   * rejected a promise nobody was watching, which Node treats as unhandled --
   * the process dies without running the cleanup below, leaving a subprocess
   * and a live TrueForge session behind. So the preflight and the drain are
   * inside one function, and that function is raced.
   */
  const expired = new Promise<never>((_resolve, reject) => {
    deadline.signal.addEventListener("abort", () => {
      timedOut = true;
      reject(new Error(`the probe did not finish within ${TURN_MS}ms`));
    });
  });

  const run = async (): Promise<void> => {
    // Asked before the turn, so what the boundary showed is recorded whatever
    // the agent then does with it.
    visible = await officesVisibleThroughTheBoundary(
      // Reached locally, not through `PROBE_PUBLIC_HOST`. That name exists so
      // a harness inside a container can find this process --
      // `host.docker.internal` does not necessarily resolve from the host
      // itself -- and this request starts here.
      `http://${urlHost(LOCAL_HOST)}:${PORT}/mission/${missionId}/mcp`,
      token,
      deadline.signal,
    );
    await drain();
  };

  try {
    await Promise.race([run(), expired]);
  } catch (error) {
    if (!timedOut) throw error;
    console.error(`  ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);

    /*
     * The turn is cancelled, not merely stopped being listened to.
     *
     * `Promise.race` does not cancel the promise that lost, and abandoning an
     * async generator does not end the turn behind it. On a timeout the probe
     * would close its proxy and exit while the harness went on spending model
     * calls and retrying an MCP endpoint that had just been shut, until
     * TrueForge's own timeout. Cancelling first is also why the proxy is closed
     * after this and not before.
     */
    if (timedOut) {
      /*
       * Cancelling gets its own, much shorter, deadline.
       *
       * `HarnessDriver` requests carry a ten-minute timeout by default, so a
       * cancel against a TrueForge that has stopped answering would hold the
       * probe open for ten more minutes past the deadline it just missed --
       * with the proxy still listening and the token-bearing subprocess still
       * running. The bound is passed into the request so the request itself
       * ends; the timer below is the second line, for a client that does not
       * honour it. The cleanup after this is the part that must happen.
       */
      let giveUp: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          // The bound goes into the request, not just around the await. A
          // timer that wins a race leaves the request itself running under the
          // driver's ten-minute default, which is the thing being avoided.
          driver.cancel(sessionId, Math.ceil(CANCEL_MS / 1000)).catch((error: unknown) => {
            // The timeout is the diagnosis; a failure to cancel is a footnote.
            console.error(`  could not cancel ${sessionId}: ${String(error)}`);
          }),
          new Promise<void>((resolve) => {
            giveUp = setTimeout(() => {
              console.error(`  cancel of ${sessionId} did not answer in ${CANCEL_MS}ms`);
              resolve();
            }, CANCEL_MS);
            // Node keeps a process alive for a pending timer, and this one
            // exists only to stop waiting.
            giveUp.unref();
          }),
        ]);
      } finally {
        // `unref()` stops the timer holding the process open; it does not stop
        // the callback. Left armed, a cancel that answered in a second would
        // still print "did not answer" ten seconds later, while the proxy was
        // closing -- a false diagnostic about the one step that worked.
        clearTimeout(giveUp);
      }
    }

    await proxy.close();
    const closable = forge as { close?: () => Promise<void> };
    if (closable.close) await closable.close();
  }

  const calls = seen.filter((line) => line.startsWith("call."));
  console.log(`  visible to the agent  ${visible.join(", ") || "(nothing)"}`);
  console.log(`  through the boundary  ${calls.join(", ") || "(nothing)"}`);
  const text = assembled !== "" ? assembled : streamed;
  console.log(`  the agent said   ${text.trim().slice(0, 200) || "(nothing)"}`);

  /*
   * Both halves, and the listing is the half that is about the boundary.
   *
   * One allowed call says the arrow works. Only the listing says the other
   * twenty-five tools stayed out of reach, which is the claim being made.
   */
  const onlyGranted = visible.length === 1 && visible[0] === "issue.get";
  const reached = calls.some((line) => line === "call.allowed issue.get");

  if (!onlyGranted) {
    console.log(
      `\n  the scope granted issue.get and the boundary showed ${visible.length}`,
    );
  } else if (!reached) {
    console.log("\n  the agent did not reach issue.get");
  } else {
    console.log(
      "\n  HELD  one office visible, and the harness reached GitHub through it",
    );
  }
  process.exit(onlyGranted && reached ? 0 : 1);
}

main().catch((error: Error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
