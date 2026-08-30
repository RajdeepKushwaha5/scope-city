import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import "./load-env.js";
import {
  HarnessDriver,
  ModelPool,
  classifyFailure,
  isWorthRotating,
  missionAgentSpec,
  initialState,
  iterationLimitFor,
  parseReasoningEffort,
  rotationCandidates,
  type TranslatorState,
} from "@scope-city/harness";
import { IRREVERSIBLE_OFFICES } from "@scope-city/mcp";
import {
  buildRecord,
  verifyRecord,
  proofAuthorises,
  CountersignBook,
  missionBrief,
  type CityFeedEvent,
} from "@scope-city/mission";
import { MissionRegistry, newMissionId, startProxyHttp } from "@scope-city/proxy";
import { createFixtureMission } from "./fixture-mission.js";
import { deriveScopeFromJob } from "./derive-scope.js";
import { boundaryReachability, boundarySummary, urlHost } from "./reachability.js";
import { controlPlaneSignpost } from "./signpost.js";
import { isWorkEvent, shouldKeepSession } from "./resume-policy.js";

import { missionSystemsAsync, systemsSummary } from "./systems.js";
import { unscopedScope } from "./unscoped.js";
import { backtest, counterfactual } from "@scope-city/yard";
import { officeRegistry } from "@scope-city/mcp";
import { MissionFeed, OperatorGateQueue } from "./live-feed.js";
import { newProxyToken, runMission, type GateRequest } from "./mission-run.js";
import {
  expireLiveMission,
  isTerminalMissionStatus,
  retireMission,
  type LiveMissionStatus,
  type ManagedLiveMission,
} from "./live-lifecycle.js";

const CONTROL_PORT = Number(process.env.SCOPE_CONTROL_PORT ?? 8787);
/** Where the city is served from, for the signpost on `/`. Display only. */
const CITY_DEV_PORT = Number(process.env.SCOPE_CITY_PORT ?? 5180);
const PROXY_PORT = Number(process.env.SCOPE_PROXY_PORT ?? 8791);
const PROXY_BIND = process.env.SCOPE_PROXY_BIND ?? "127.0.0.1";
const PROXY_PUBLIC_HOST = process.env.SCOPE_PROXY_PUBLIC_HOST ?? "127.0.0.1";
const SANDBOX = process.env.SCOPE_SANDBOX === "true";
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY ?? "";

/**
 * Whether this run has a sandbox, decided once at boot.
 *
 * Gates whether an approval requires the agent's working. With no sandbox the
 * brief never asked for a check, so demanding one would refuse every approval
 * on a build behaving exactly as configured.
 */
const SANDBOX_AVAILABLE = { value: false };

/**
 * How long a mission will wait for a model to come off cooldown.
 *
 * Long enough to ride out the per-minute rate limits free-tier keys hit
 * constantly, short enough that a genuinely dead pool is reported rather than
 * hidden behind a city that appears to be thinking.
 */
const POOL_WAIT_BUDGET_MS = 4 * 60 * 1000;
/**
 * Models to rotate across, pinned by configuration if anyone asked.
 *
 * Empty means "use whatever the harness has", which is the better default:
 * several keys were registered, this fell back to one hard-coded model, and a
 * rate limit ended the mission with two untouched keys sitting right there.
 */
const PINNED_MODELS = (process.env.SCOPE_MODEL ?? process.env.SCOPE_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

interface LiveMission extends ManagedLiveMission {
  readonly id: string;
  readonly order: string;
  /** The effort the operator asked for, if any. Empty means no preference. */
  readonly reasoningEffort: string;
  readonly feed: MissionFeed;
  readonly gates: OperatorGateQueue;
  readonly book: CountersignBook;
  /** The most recent sandbox check, if the agent ran one. */
  verification?: { script: string; output: string; passed: boolean };
  readonly report: ReturnType<typeof backtest>;
  scope: ReturnType<typeof createFixtureMission>["scope"];
  readonly startedAt: number;
  sessionId?: string;
}

async function main(): Promise<void> {
  /*
   * First, before the driver exists.
   *
   * Scope City hands TrueForge a URL and TrueForge connects to it from wherever
   * it is. Those are two machines' idea of "here" as soon as the harness is in
   * a container, and announcing `host.docker.internal` while listening only on
   * loopback produces the least useful error in the project: `ECONNREFUSED
   * 192.168.65.254:8794`, inside TrueForge's own UI, half a minute later,
   * naming a gateway address nobody typed.
   *
   * This check reads two environment strings and nothing else, so there is no
   * reason for it to run after model discovery and sandbox resolution -- and
   * good reason for it not to. Running it later meant an impossible boundary
   * still issued remote requests and could persist a sandbox provider before
   * exiting, and a throw from `hasSandboxProvider()` could stop the diagnosis
   * being printed at all. The one check certain of its answer went last.
   */
  const reachable = boundaryReachability({
    bind: PROXY_BIND,
    publicHost: PROXY_PUBLIC_HOST,
  });
  if (!reachable.ok) {
    console.error(`
  ${reachable.reason}
`);
    process.exit(2);
  }
  console.log(
    boundarySummary({ bind: PROXY_BIND, publicHost: PROXY_PUBLIC_HOST, port: PROXY_PORT }),
  );

  const driver = new HarnessDriver();

  // Discovered once at boot rather than per mission.
  //
  // Per-mission discovery would put a round trip on the one path that has to
  // feel instant -- the operator presses Launch and the city should move. It
  // also fails in a worse place: a harness that goes unreachable mid-demo would
  // turn every launch into a hang before the first frame, instead of a mission
  // that starts and reports the problem through the feed.
  //
  // The cost is that a model registered after boot is invisible until restart,
  // which is the right trade for a control plane whose model set is fixed by
  // .env at startup anyway.
  //
  // Discovery is allowed to fail. Booting is not: the previous behaviour was a
  // server that came up and reported harness trouble through /api/health, and
  // an unhandled rejection here would replace that with a process that exits
  // before it can tell anyone why.
  let source: "pinned" | "discovered" | "fallback default" | "none discovered" = "pinned";
  let found: readonly string[] = PINNED_MODELS;
  // Discovery answering "nothing to rotate onto" is a different fact from
  // discovery not answering at all, and only one of them justifies a guess.
  let discovered = false;

  if (PINNED_MODELS.length === 0) {
    source = "discovered";
    try {
      // Filtered, not just listed. Rotation treats every model as
      // interchangeable, which is true of four Gemini keys and false of a 7B on
      // a laptop -- a mission that rotated onto the local model when the hosted
      // keys were cooling did not fail, it just became something nobody would
      // watch. Naming it in SCOPE_MODELS is a decision; discovering it is an
      // accident.
      found = rotationCandidates(await driver.listModels());
      discovered = true;
    } catch (error) {
      found = [];
      console.warn(
        `Model discovery failed (${error instanceof Error ? error.message : String(error)}); ` +
          `starting anyway -- see /api/health`,
      );
    }
  }

  /*
   * Never silently claim discovery when the hard-coded default was used: a
   * startup line reading "(discovered)" next to a single model is what made the
   * original single-entry pool take so long to spot.
   *
   * And never fall back after discovery *succeeded*. A machine with only a
   * local model registered discovers no rotation candidates -- a true answer,
   * not a failure -- and substituting gemini-a/flash-a there would point every
   * mission at a model the harness has never heard of. The server still starts,
   * because a control plane that cannot boot cannot tell anyone what is wrong,
   * but it says the pool is empty rather than inventing one.
   */
  const models = found.length > 0 ? found : discovered ? [] : ["gemini-a/flash-a"];

  /*
   * What each model will accept, discovered once alongside the names.
   *
   * Not every model takes a reasoning effort, and the ones that do not reject
   * the request rather than ignoring it -- a local Qwen behind Ollama answers
   * one with `400 does not support thinking`. Sending an effort the operator
   * chose to a model that cannot take it turns a working mission into a failed
   * launch, and the operator did nothing wrong.
   *
   * An empty map means discovery failed, and the effort is passed through as
   * before: the harness validates it anyway and will refuse it with a clearer
   * message than a guess made here.
   */
  let effortsByModel: ReadonlyMap<string, readonly string[]> = new Map();
  try {
    effortsByModel = await driver.listModelCapabilities();
  } catch {
    // Discovery is best-effort. The pool still works without it.
  }

  /** The operator's effort, dropped for a model that would refuse it. */
  const effortFor = (model: string, wanted: string): string | undefined => {
    if (wanted === "") return undefined;
    const supported = effortsByModel.get(model);
    if (supported === undefined) return wanted;
    return supported.includes(wanted) ? wanted : undefined;
  };
  if (found.length === 0) source = discovered ? "none discovered" : "fallback default";

  console.log(
    models.length > 0
      ? `Models: ${models.join(", ")} (${source})`
      : `Models: none. Discovery found nothing to rotate onto -- an opt-in ` +
        `provider is registered but not chosen. Set SCOPE_MODELS to name it.`,
  );

  // Whether a sandbox is actually available, settled once at boot.
  //
  // `sandbox: { enabled: true }` with no provider configured makes the harness
  // reject the *session*, so every mission dies at creation with a 422 about
  // `PUT /settings/sandbox-providers` -- which reaches the operator as "mission
  // failed" and the map as nothing at all. Resolving it here turns a broken
  // demo into a line in the startup log.
  //
  // Note that TrueForge 0.1.4 accepts only Daytona: the provider manifest's
  // `type` enum has exactly one member. Installing bwrap, socat and ripgrep
  // does nothing for this build, whatever other versions may support.
  const sandbox = await resolveSandbox(driver);

  // Held in a box rather than closed over directly so the request handlers,
  // which are defined below, read the value settled at boot rather than a
  // binding that has not been initialised when they are created.
  SANDBOX_AVAILABLE.value = sandbox;

  console.log(systemsSummary());

  async function resolveSandbox(harness: HarnessDriver): Promise<boolean> {
    if (!SANDBOX) return false;

    if (await harness.hasSandboxProvider()) {
      console.log("Sandbox: provider already configured");
      return true;
    }

    if (!DAYTONA_API_KEY) {
      console.warn(
        "Sandbox: SCOPE_SANDBOX=true but no provider is configured and " +
          "DAYTONA_API_KEY is unset — running without one. " +
          "The brief's verification step is omitted rather than promised and skipped.",
      );
      return false;
    }

    try {
      await harness.configureDaytonaSandbox(DAYTONA_API_KEY);
      console.log("Sandbox: Daytona provider configured");
      return true;
    } catch (error) {
      // A rejected key must not take the control plane down with it. The
      // mission is still worth running; it just runs without the sandbox, and
      // the reason is on the record rather than inferred from a later failure.
      console.warn(
        `Sandbox: could not configure Daytona (${error instanceof Error ? error.message : String(error)}) — running without one`,
      );
      return false;
    }
  }
  /*
   * The systems, connected once, for every mission this process runs.
   *
   * The Forge was reachable only from its own probe: every mission built here
   * composed the three synchronous districts, so nothing an operator could
   * actually start went through the evaluator, projector, ledger and gate over
   * a server nobody in this repo wrote -- the whole claim the district exists
   * to support.
   *
   * Once, not per mission, because each connection spawns a subprocess and
   * holds a token. Missions come and go against the same upstreams.
   */
  const systems = await missionSystemsAsync();

  const registry = new MissionRegistry();
  const proxyToken = newProxyToken();
  const missions = new Map<string, LiveMission>();

  const proxy = await startProxyHttp({
    registry,
    port: PROXY_PORT,
    host: PROXY_BIND,
    token: proxyToken,
  });

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) json(res, 500, { error: detail });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    /*
     * The root says what this port is, because someone will open it.
     *
     * This is the control plane, and it serves `/api/*` only -- so visiting `/`
     * answered `{"error":"not found"}`, which is true and useless. The city
     * runs on a different port, and a bare 404 gives no way to work that out.
     * A signpost costs nothing and saves the guess.
     */
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
      json(res, 200, controlPlaneSignpost(CITY_DEV_PORT));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const harness = await driver.reachable();
      json(res, harness.ok ? 200 : 503, {
        ok: harness.ok,
        harness,
        activeMissions: [...missions.values()].filter((mission) => mission.status === "running").length,
        /*
         * Which models this server will actually rotate over.
         *
         * Added because the city was stating one from a string literal:
         * "gemini-2.5-flash - 4 rotating keys", regardless of what is
         * registered. That is wrong in three separate ways at once. Set fewer
         * than four Gemini keys and the slots without one are skipped, so the
         * count is a guess. Set GEMINI_MODEL and the model id is a guess. Point
         * SCOPE_MODELS at the local slot and both are, and the panel names a
         * hosted model while a Qwen on the operator's laptop does the work.
         *
         * A number the interface asserts and does not measure is the thing this
         * whole project is an argument against, and it was in the panel that
         * dispatches the mission.
         */
        models: { rotation: models, source },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/missions") {
      const body = await readJson(req);
      const order = typeof body.order === "string" ? body.order.trim() : "";
      if (!order || order.length > 500) {
        json(res, 400, { error: "order must contain between 1 and 500 characters" });
        return;
      }

      // Validated here as well as by TrueForge, and the duplication is
      // deliberate: the harness refuses an unsupported effort with a 422 in the
      // middle of session creation, by which point the mission has an id and a
      // proxy and the operator sees a started run collapse. Rejecting it at the
      // door turns that into an ordinary 400 before anything is built.
      //
      // Only an absent field means "no preference". Coercing a non-string to ""
      // and treating that as absence let numbers, booleans, arrays, objects and
      // null all launch as though nothing had been asked for -- a malformed
      // request quietly becoming a different valid one.
      const parsed = parseReasoningEffort(body.effort);
      if (!parsed.ok) {
        json(res, 400, { error: parsed.reason });
        return;
      }
      const effort = parsed.effort ?? "";

      const active = [...missions.values()].find(
        (mission) => mission.status === "starting" || mission.status === "running",
      );
      if (active) {
        json(res, 409, { error: "a mission is already active", missionId: active.id });
        return;
      }

      const health = await driver.reachable();
      if (!health.ok) {
        json(res, 503, { error: "TrueForge is not reachable", detail: health.reason });
        return;
      }

      const id = newMissionId();

      // The comparison run: the authority an ordinary integration hands over.
      //
      // Deliberately the same pipeline, not a bypass. Switching the proxy off
      // would compare "our enforcement" against "no enforcement" and prove only
      // that code which runs does something. This runs the same evaluator, the
      // same proxy and the same map against a scope that grants everything --
      // which is what inheriting a user's access actually means, written down.
      if (body.mode === "unscoped") {
        const scope = await unscopedScope({
          missionId: id,
          job: order,
          systems,
          now: Date.now(),
        });

        const feed = new MissionFeed();
        const gates = new OperatorGateQueue();
        const book = new CountersignBook();
        const fixture = createFixtureMission({
          missionId: id,
          book,
          emit: (event) => feed.append({ type: "proxy", event }),
          scope,
          systems,
        });
        registry.register(fixture.mission);

        const live: LiveMission = {
          id,
          order,
          reasoningEffort: effort,
          feed,
          gates,
          book,
          scope,
          // The Yard still runs, and this is the most useful thing it ever
          // reports: every probe it fires is *allowed*, so the findings are the
          // shape of the blast radius rather than a clean sheet.
          report: backtest({ scope, registry: officeRegistry(), now: Date.now() }),
          startedAt: Date.now(),
          status: "starting",
        };
        missions.set(id, live);

        feed.append({ type: "scope.granted", scope, at: Date.now() });
        feed.append({ type: "yard.report", report: live.report });
        feed.append({ type: "mission.status", status: "starting" });
        void runLiveMission(live, book).catch(() => undefined);

        json(res, 202, { missionId: id, status: live.status, scope, mode: "unscoped" });
        return;
      }

      // Stage 1 and 2 of sealing, before anything else exists.
      //
      // Deliberately ahead of the feed, the ledger and the session: if the
      // sentence cannot produce a usable scope, the right outcome is a 422 and
      // no mission at all, rather than a live agent holding authority nobody
      // examined.
      const derived = await deriveScopeFromJob({ job: order, missionId: id, systems });

      if (derived.scope.offices.length === 0) {
        // Carry the reasons. A job that produced no scope because the operator
        // did not state an amount is a completely different problem from one
        // that named no system this city has, and the operator can only fix the
        // one they are told about.
        json(res, 422, {
          error:
            derived.dropped.length > 0
              ? "that job could not be scoped"
              : "no office in this city can do that",
          detail:
            derived.dropped.length > 0
              ? derived.dropped.map((d) => `${d.office}: ${d.reason}`).join("; ")
              : "Nothing in the request matched a system the city can reach.",
          job: order,
        });
        return;
      }

      // The Yard, before anything is granted.
      //
      // Run here because a backtest is only useful at the one moment its answer
      // can still change the decision; afterwards it is a postmortem. Nothing
      // it does touches a system or spends anything -- every check is the pure
      // evaluator against a generated call, or a walk over declared shapes --
      // so it is safe to run on a scope nobody has approved, which is the
      // entire point.
      //
      // It probes the scope *as if granted*, because that is the authority the
      // operator is being asked about. Probing the proposed state would refuse
      // everything for `scope_not_active` and report a clean sheet that means
      // nothing.
      const report = backtest({
        scope: { ...derived.scope, state: "granted" },
        registry: officeRegistry(),
        now: Date.now(),
      });

      const feed = new MissionFeed();
      const gates = new OperatorGateQueue();
      const book = new CountersignBook();

      // Proposed, and nothing else.
      //
      // No proxy registration and no TrueForge session exist yet. That is the
      // difference between a product that shows you a scope and one that asks
      // your permission: until grant, there is nothing for an agent to reach
      // even if one were somehow started, because the mission is not in the
      // registry the proxy consults.
      const live: LiveMission = {
        id,
        order,
        reasoningEffort: effort,
        feed,
        gates,
        book,
        scope: derived.scope,
        report,
        startedAt: Date.now(),
        status: "proposed",
      };
      missions.set(id, live);

      feed.append({ type: "scope.proposed", scope: derived.scope });
      feed.append({ type: "yard.report", report });
      feed.append({ type: "mission.status", status: "proposed" });

      json(res, 200, {
        missionId: id,
        status: live.status,
        scope: derived.scope,
        report,
        dropped: derived.dropped,
        eventUrl: `/api/missions/${id}/events`,
        grantUrl: `/api/missions/${id}/grant`,
      });
      return;
    }

    const match = url.pathname.match(/^\/api\/missions\/([^/]+)\/(events|decisions|cancel|record|expire|grant|deny|counterfactual)$/);
    if (!match) {
      json(res, 404, { error: "not found" });
      return;
    }

    const mission = missions.get(match[1]!);
    if (!mission) {
      json(res, 404, { error: "no such mission" });
      return;
    }

    if (req.method === "GET" && match[2] === "events") {
      streamEvents(req, res, mission, url);
      return;
    }

    if (req.method === "POST" && match[2] === "decisions") {
      const body = await readJson(req);
      const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId : "";
      // Set only if this decision is checked against a proof, so the clear
      // below cannot touch a proof belonging to a different pending gate.
      let spendsProof = false;
      const approved = body.approved === true;
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      if (!toolCallId) {
        json(res, 400, { error: "toolCallId is required" });
        return;
      }
      // An approval needs the working behind it, when there is a sandbox to
      // produce working.
      //
      // The brief asks the agent to verify an irreversible amount before
      // requesting it, and the point of asking is that the answer gates the
      // request. Accepting a countersign while the check failed -- or while no
      // check was ever run -- would make the sandbox decorative: a step the
      // agent performs and nobody depends on. Refusing here is what turns it
      // into the thing that earns the approval.
      //
      // Only when a sandbox exists. Without one the brief never asked for a
      // check, so demanding evidence of one would refuse every approval on a
      // build that is running exactly as configured.
      // Checked for a denial too, so a refusal spends the proof it was made on
      // rather than leaving it for a retry -- but only that proof, and only if
      // it was about this call.
      if (SANDBOX_AVAILABLE.value) {
        // Bound to *this* call, and spent only once the approval lands.
        //
        // Keeping only the most recent verification meant any passing check
        // authorised any pending gate: the shipped recording shows a refund
        // being verified and then a `mail.send` approved on the strength of it,
        // with nothing ever checked about the mail. That is the same drift the
        // countersign fingerprint exists to catch, one layer up.
        const pending = mission.gates.pending(toolCallId);

        // Checked before the proof, because a missing gate supplies no
        // arguments and a proof with nothing to match against passes trivially
        // -- so a stale or mistyped id would destroy a valid proof and then
        // return 409, leaving the real pending gate unapprovable and the agent
        // paused on a decision that can no longer be made.
        if (!pending) {
          json(res, 409, { error: "that gate is not waiting" });
          return;
        }

        const verdict = proofAuthorises(mission.verification, pending.args);

        // An approval needs the working. A denial does not -- refusing an
        // action nobody verified is always allowed, and demanding proof to say
        // no would trap the operator into approving.
        if (approved && !verdict.ok) {
          json(res, 428, {
            error: verdict.reason,
            ...(verdict.detail ? { detail: verdict.detail } : {}),
          });
          return;
        }
        spendsProof = verdict.ok;
      }

      if (!mission.gates.decide(toolCallId, { approved, ...(reason ? { reason } : {}) })) {
        json(res, 409, { error: "that gate is not waiting" });
        return;
      }

      // Spent only when this decision was actually made on that proof.
      //
      // Two failures to avoid at once. Clearing on approval alone left a denied
      // gate's passing check available to authorise a retry with the same
      // arguments -- refuse an action, be asked again, and it rides on working
      // from before the refusal. But clearing on *every* decision was worse:
      // several gates can be pending together, so denying gate A destroyed the
      // proof that had arrived for gate B, and B's approval then failed for
      // missing working nobody had spent.
      //
      // A proof is consumed by the decision it justified, and by nothing else.
      if (spendsProof) mission.verification = undefined;
      mission.feed.append({
        type: "world",
        event: { type: "gate.cleared", toolCallId, approved, at: Date.now() },
      });
      json(res, 200, { accepted: true });
      return;
    }

    if (req.method === "POST" && match[2] === "grant") {
      if (mission.status !== "proposed") {
        json(res, 409, { error: "that mission is not awaiting a grant" });
        return;
      }

      // Re-checked here, not only at proposal.
      //
      // Several proposals can wait at once -- proposing costs nothing and
      // starts nothing -- so checking only that *this* one is awaiting a grant
      // let two of them be granted in turn, each starting a TrueForge session
      // through a control plane that assumes one. The singleton has to hold at
      // the moment authority is actually handed over.
      const running = [...missions.values()].find(
        (other) => other.status === "starting" || other.status === "running",
      );
      if (running) {
        json(res, 409, { error: "a mission is already active", missionId: running.id });
        return;
      }

      // The lease starts now, not when the scope was drafted.
      //
      // `expiresAt` was computed during derivation, so an operator who spent
      // two minutes reading the Yard report would have granted a scope with two
      // minutes already spent -- and a ten-minute lease that expires in eight
      // is not the lease they were shown. Recomputing at grant makes the
      // countdown mean what the screen said.
      const grantedAt = Date.now();
      const ttl = mission.scope.expiresAt - mission.startedAt;
      const granted = {
        ...mission.scope,
        state: "granted" as const,
        grantedBy: "operator:scope-city",
        grantedAt,
        expiresAt: grantedAt + Math.max(1, ttl),
        version: mission.scope.version + 1,
      };

      const fixture = createFixtureMission({
        missionId: mission.id,
        book: mission.book,
        emit: (event) => mission.feed.append({ type: "proxy", event }),
        scope: granted,
        systems,
      });

      // Only now does the proxy know this mission exists.
      registry.register(fixture.mission);

      mission.scope = granted;
      mission.status = "starting";
      mission.expiryTimer = setTimeout(
        () => void expireLiveMission(mission, registry, (sid) => driver.cancel(sid)),
        Math.max(0, granted.expiresAt - Date.now()),
      );

      mission.feed.append({ type: "scope.granted", scope: granted, at: grantedAt });
      mission.feed.append({ type: "mission.status", status: "starting" });
      void runLiveMission(mission, mission.book).catch(() => undefined);

      json(res, 202, { missionId: mission.id, status: mission.status, scope: granted });
      return;
    }

    if (req.method === "POST" && match[2] === "deny") {
      if (mission.status !== "proposed") {
        json(res, 409, { error: "that mission is not awaiting a grant" });
        return;
      }

      // Deliberately no singleton check here.
      //
      // The grant handler has one, because granting starts a session. Denial
      // starts nothing, revokes nothing, and touches no other mission, so
      // blocking it while an unrelated run is active would strand valid
      // proposals in `proposed` until something they have nothing to do with
      // finishes. Refusing authority must always be available.
      //
      // Nothing to revoke either: a denied scope was never registered with the
      // proxy and never had a session. Denial is simply the mission ending.
      mission.status = "denied";
      mission.feed.append({ type: "scope.denied", at: Date.now() });
      mission.feed.append({ type: "mission.status", status: "denied" });
      json(res, 200, { denied: true });
      return;
    }

    if (req.method === "POST" && match[2] === "counterfactual") {
      const body = await readJson(req);
      const office = typeof body.office === "string" ? body.office : "";
      if (!office) {
        json(res, 400, { error: "office is required" });
        return;
      }

      // Answered against the proposed scope, which is the only time the answer
      // is actionable: once granted, "what would this cost" is a question about
      // authority the agent already holds.
      json(res, 200, {
        counterfactual: counterfactual({
          scope: { ...mission.scope, state: "granted" },
          registry: officeRegistry(),
          office,
          now: Date.now(),
        }),
      });
      return;
    }

    if (req.method === "GET" && match[2] === "record") {
      // Built on demand from the log rather than maintained alongside it.
      //
      // A record kept in step with the feed is a second place for the truth to
      // live, and the two disagreeing is precisely the failure a tamper-evident
      // log is supposed to rule out. Derived once, at the moment it is asked
      // for, there is only ever one answer.
      const built = buildRecord({
        missionId: mission.id,
        scope: mission.scope,
        events: mission.feed.since(0).events,
        // The first thing that happened, not the scope's expiry.
        //
        // `grantedAt ?? expiresAt` put a *future* timestamp on a record whose
        // whole purpose is establishing when things occurred, in the one case
        // where grantedAt was absent. The log's own first entry is the honest
        // answer, and an empty log has no start to report.
        startedAt: mission.startedAt,
        finishedAt: Date.now(),
        lossy: mission.feed.lossy,
      });

      // Verified before it is handed over, and the two ways it can fail get
      // different answers.
      //
      // A broken chain means this server produced a record that does not
      // verify, which is a fault here and not something to hand over with a
      // flag set and hope the reader checks. An incomplete history is
      // different: the log dropped events under capacity pressure, the record
      // is still exactly what remains, and withholding it would destroy
      // evidence to avoid an awkward field.
      const verdict = verifyRecord(built);

      if (!verdict.ok && !verdict.chainIntact) {
        json(res, 500, {
          error: "the record does not verify",
          detail: verdict.reason,
          brokenAt: verdict.brokenAt,
        });
        return;
      }

      res.writeHead(200, {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="scope-city-${mission.id}.json"`,
      });
      res.end(JSON.stringify({ ...built, verified: verdict }, null, 2));
      return;
    }

    if (req.method === "POST" && match[2] === "cancel") {
      const sessionId = mission.sessionId;
      retireMission(mission, registry, "cancelled", "mission cancelled");
      if (sessionId) await driver.cancel(sessionId).catch(() => undefined);
      json(res, 200, { cancelled: true });
      return;
    }

    if (req.method === "POST" && match[2] === "expire") {
      // Expiry on demand, for the beat where the operator watches the city
      // limits close rather than waiting out a timer on camera.
      //
      // It does not shortcut the enforcement it demonstrates. The scope moves
      // to `expired` through exactly the path the timer uses, so afterwards the
      // agent is refused by the evaluator's own `scope_expired` check and not
      // by a demo flag. A control that faked the outcome would be showing the
      // wrong thing at the one moment somebody is watching closely.
      const expired = await expireLiveMission(mission, registry, (sessionId) =>
        driver.cancel(sessionId),
      );
      if (!expired) {
        json(res, 409, { error: "that mission has already finished" });
        return;
      }
      json(res, 200, { expired: true, at: Date.now() });
      return;
    }

    json(res, 405, { error: "method not allowed" });
  }

  async function runLiveMission(live: LiveMission, book: CountersignBook): Promise<void> {
    const proxyName = "scope-city-live";
    const proxyUrl = `http://${urlHost(PROXY_PUBLIC_HOST)}:${PROXY_PORT}/mission/${live.id}/mcp`;
    try {
      await driver.registerMcpServer({
        type: "remote",
        name: proxyName,
        url: proxyUrl,
        description: "Scope City live mission boundary",
        auth: { type: "header", headers: { Authorization: `Bearer ${proxyToken}` } },
      });

      const pool = new ModelPool(models.map((model, priority) => ({ model, priority })));
      let lastError: unknown;

      // Iterated live rather than over a snapshot of what was available at the
      // start, and willing to wait when nothing is.
      //
      // `pool.available()` taken once meant that if every model happened to be
      // cooling at that instant the loop body never ran and the mission failed
      // outright. On free-tier keys that is not an edge case: several keys
      // rate-limiting within a few seconds of each other is the normal way a
      // busy afternoon goes, and giving up while every one of them is sixty
      // seconds from working again wastes the whole mission.
      //
      // Bounded, because waiting forever is its own failure -- an operator
      // watching a city do nothing deserves to be told it has given up rather
      // than left to guess.
      const poolDeadline = Date.now() + POOL_WAIT_BUDGET_MS;

      /**
       * A session worth picking back up: the model it is bound to, the work
       * it already holds, and how far the reading of it had got.
       *
       * An agent spec names its model at creation and cannot be re-pointed, so
       * a resumed session runs on the model it started with whatever the pool
       * would have chosen next. Carrying the name means the loop waits for
       * *that* key and penalises *that* key -- without it the pool credits and
       * blames a model the session never used.
       *
       * The translator state travels with it because the session continues but
       * a fresh reader cannot pair a completion with a start it never saw. See
       * `MissionRunOptions.translator`.
       */
      let resume:
        | { sessionId: string; model: string; translator: TranslatorState }
        | undefined;

      for (;;) {
        // A held session pins the choice. Anything else is picking a fresh key
        // for a fresh session.
        const model = resume?.model ?? pool.next(Date.now());

        if (model === undefined) {
          const readyAt = pool.nextAvailableAt(Date.now());
          if (readyAt === undefined || readyAt > poolDeadline) break;

          const waitMs = Math.max(0, readyAt - Date.now()) + 250;
          live.feed.append({
            type: "mission.status",
            status: "starting",
            detail: `every model is cooling; waiting ${Math.ceil(waitMs / 1000)}s`,
          });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (isTerminalMissionStatus(live.status)) return;
          continue;
        }

        let attemptSessionId: string | undefined;
        let resumedThisAttempt = false;
        let translator = resume?.translator;
        // Set from the event stream rather than inferred from the feed cursor,
        // which also advances for the control plane's own status messages.
        //
        // Seeded true when resuming, because the work belongs to the session
        // and not to the turn that produced it. Starting each attempt at false
        // meant a held session that was rate limited again before emitting
        // anything new looked like it had done nothing, and was cancelled --
        // throwing away everything the earlier attempts had established, which
        // is the exact failure this whole path exists to prevent.
        let didWorkThisAttempt = resume !== undefined;
        try {
          // Carry an interrupted session forward instead of replacing it.
          //
          // A rate limit ends the turn, not the session. TrueForge keeps the
          // conversation, so an agent that has already read the ticket, checked
          // the charge and run its sandbox script still knows all of it --
          // creating a new session throws every bit of that away and starts the
          // job from the top on a fresh key.
          //
          // That is why delegated missions could not finish. Delegation fires
          // enough calls at once to trip a per-minute limit partway through,
          // and each rotation then discarded the progress that had been made
          // before the trip. Availability rotated; work did not. Seven attempts
          // in one measured run, none of them reaching the gate.
          //
          // So a rate limit on a session that has already done something waits
          // for the key rather than abandoning the work. Anything else -- a
          // rejected credential, an exhausted quota, a malformed spec -- is not
          // going to improve by waiting, and still rotates.
          if (resume !== undefined) {
            attemptSessionId = resume.sessionId;
            resumedThisAttempt = true;
            resume = undefined;
            live.sessionId = attemptSessionId;
            live.feed.append({
              type: "mission.status",
              status: "running",
              detail: `${model} resumed; the session kept its work`,
            });
          } else attemptSessionId = await driver.createSession(
            missionAgentSpec({
              model,
              proxyName,
              // From the scope, not a constant.
              //
              // The scope decides what stops for a human; passing a fixed list
              // meant the comparison run -- whose whole point is that nothing
              // stops to ask -- still raised a TrueForge approval for every
              // irreversible office. It demonstrated the opposite of what it
              // claimed, which is worse than not demonstrating it.
              gatedTools: [...live.scope.countersignRequired],
              sandbox,
              // The operator's choice, carried from the dispatch panel. Absent
              // unless they made one, or unless the chosen model refuses one.
              ...(() => {
                const effort = effortFor(model, live.reasoningEffort);
                return effort ? { reasoningEffort: effort } : {};
              })(),
              // Stated rather than derived, because the effort above may have
              // been dropped for this model and the budget must not go with it.
              //
              // They are two settings that share an input: the effort is the
              // provider's, the budget is ours. Letting the spec infer the
              // budget from the filtered effort gave every local-model run the
              // high ceiling however the operator had set it, while the brief
              // below went on promising the smaller number -- the run
              // contradicting its own instructions.
              iterationLimit: iterationLimitFor(live.reasoningEffort),
              // The comparison run is briefed as an ordinary integration is,
              // without our framing about untrusted content or limited reach.
              instructions: missionBrief({
                scope: live.scope,
                sandbox,
                // The same number the spec is built with, from the same
                // function and the same input, so the brief cannot promise a
                // budget the run does not get.
                iterationLimit: iterationLimitFor(live.reasoningEffort),
                registry: officeRegistry(),
                plain: live.scope.scopeId === "NO-SCOPE",
              }),
            }),
          );
          live.sessionId = attemptSessionId;
          if (isTerminalMissionStatus(live.status)) {
            await driver.cancel(attemptSessionId).catch(() => undefined);
            return;
          }
          setStatus(live, "running", model);
          const result = await runMission({
            driver,
            sessionId: live.sessionId,
            scope: live.scope,
            book,
            prompt: live.order,
            // A resumed session already has the brief and the work. Sending the
            // order again would set it going from the beginning on a
            // conversation that remembers doing it.
            resuming: resumedThisAttempt,
            // Carried so completions can still be matched to the starts that
            // happened before the interruption.
            ...(translator ? { translator } : {}),
            // Kept as the stream is read rather than taken from the result: a
            // rate limit throws out of the turn, so the result never arrives
            // on the one path that needs this.
            onState: (state) => {
              translator = state;
            },
            maxTurns: 8,
            decide: (gate: GateRequest) => live.gates.wait(gate),
            onRaw: (event) => {
              if (process.env.SCOPE_TRACE === "true") {
                console.log(`[trueforge:${event.type}] ${JSON.stringify(event).slice(0, 1_000)}`);
              }
            },
            onEvent: (event) => {
              // Arm the decision before publishing the visible gate. A very
              // fast operator must never beat the stream consumer to `decide`.
              if (event.type === "gate.raised") {
                void live.gates.wait({
                  threadId: event.threadId,
                  toolCallId: event.toolCallId,
                  office: event.office,
                  args: (event.args ?? {}) as Record<string, unknown>,
                });
              }
              // Kept server-side as well as published, because the approval
              // endpoint consults it. A verification that only existed in the
              // browser would let a client that never rendered it approve
              // anyway, which is the wrong place for the check to live.
              if (event.type === "yard.verified") {
                live.verification = {
                  script: event.script,
                  output: event.output,
                  passed: event.passed,
                };
              }
              // Work, as opposed to the control plane narrating itself. This is
              // what decides whether an interrupted session is worth keeping.
              if (isWorkEvent(event.type)) didWorkThisAttempt = true;
              live.feed.append({ type: "world", event });
            },
          });
          if (!["done", "completed", "success"].includes(result.status)) {
            throw new Error(
              result.message ?? `TrueForge ended the turn with status ${result.status}`,
            );
          }
          pool.restore(model);
          retireMission(live, registry, "completed");
          return;
        } catch (error) {
          lastError = error;
          const kind = classifyFailure(error);

          // Kept, not cancelled, when the key is the only thing that failed.
          //
          // `progressed` is the test that matters: a session that has raised a
          // gate or made a proxy call holds work worth more than a fresh start.
          // One that fell over before doing anything has nothing to carry, so
          // there is no reason to prefer it over the next model.
          const keepSession = shouldKeepSession({
            kind,
            didWork: didWorkThisAttempt,
            sessionId: attemptSessionId,
          });

          if (attemptSessionId && !keepSession) {
            await driver.cancel(attemptSessionId).catch(() => undefined);
            if (live.sessionId === attemptSessionId) live.sessionId = undefined;
          }
          if (isTerminalMissionStatus(live.status)) return;
          if (!isWorthRotating(kind)) throw error;

          if (keepSession && attemptSessionId !== undefined) {
            resume = {
              sessionId: attemptSessionId,
              model,
              translator: translator ?? initialState(),
            };
            live.feed.append({
              type: "mission.status",
              status: "starting",
              detail: `${model} rate limited; holding the session and waiting`,
            });
          }

          pool.penalise(model, kind, Date.now());
          live.feed.append({
            type: "mission.status",
            status: "starting",
            detail: `${model} unavailable; rotating (${kind})`,
          });
        }
      }
      // A session held for a resume that never came still exists on the
      // harness. Falling out of the loop with one open leaks it for as long as
      // the instance runs.
      if (resume !== undefined) {
        await driver.cancel(resume.sessionId).catch(() => undefined);
        if (live.sessionId === resume.sessionId) live.sessionId = undefined;
        resume = undefined;
      }

      throw lastError ?? new Error("no configured model was available");
    } catch (error) {
      if (!isTerminalMissionStatus(live.status)) {
        retireMission(live, registry, "failed", error instanceof Error ? error.message : String(error));
      }
    }
  }

  await new Promise<void>((resolve) => server.listen(CONTROL_PORT, "127.0.0.1", resolve));
  console.log(`Scope City control plane: http://127.0.0.1:${CONTROL_PORT}`);

  const close = async () => {
    const cancellations: Promise<unknown>[] = [];
    for (const mission of missions.values()) {
      const sessionId = mission.sessionId;
      retireMission(mission, registry, "cancelled", "server stopped");
      if (sessionId) cancellations.push(driver.cancel(sessionId).catch(() => undefined));
    }
    await Promise.all([
      ...cancellations,
      // Same reason the proxy drops its connections: `/api/missions/:id/events`
      // is an SSE stream that stays open for as long as the city is on screen,
      // and `close()` waits for open connections. With a browser tab open,
      // Ctrl+C on this server hung until someone closed the tab or killed it.
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
      proxy.close(),
      /*
       * The upstream subprocesses go with the server.
       *
       * A connected district holds a child process and its pipes. Nothing
       * closed them, so every Ctrl+C left a third-party server running with a
       * GitHub token in its environment and no parent left to stop it.
       */
      ...systems.map((system) => {
        const closable = system as { close?: () => Promise<void> };
        return closable.close ? closable.close().catch(() => undefined) : Promise.resolve();
      }),
    ]);
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
}

function setStatus(mission: LiveMission, status: LiveMissionStatus, detail?: string): void {
  if (isTerminalMissionStatus(mission.status)) return;
  mission.status = status;
  mission.feed.append({ type: "mission.status", status, ...(detail ? { detail } : {}) });
}

function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  mission: LiveMission,
  url: URL,
): void {
  const requested = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
  const cursor = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();

  const { replay, unsubscribe } = mission.feed.subscribeFrom(
    cursor,
    (entry) => writeSse(res, entry.sequence, entry.event),
  );
  if (replay.truncated) {
    writeSse(res, replay.cursor, {
      type: "mission.status",
      status: "failed",
      detail: "event history was truncated; reload the mission snapshot",
    });
  }
  for (const entry of replay.events) writeSse(res, entry.sequence, entry.event);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSse(res: ServerResponse, id: number, event: CityFeedEvent): void {
  res.write(`id: ${id}\nevent: mission\ndata: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
