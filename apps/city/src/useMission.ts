import type { BacktestReport } from "@scope-city/yard";
import type { OfficeActivity } from "./live-state.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Figure } from "./render/scene.js";
import { plotFor } from "./render/world.js";
import { scriptedRawState } from "./scripted-state.js";

/**
 * Mission state for the city.
 *
 * Today this drives scripted scenarios so the interface can be built and judged
 * on its own. The shape is deliberately the shape of the real thing: every
 * field here is something a WorldEvent already carries, so wiring the socket up
 * replaces the scenario driver and touches nothing else.
 *
 * Scenario steps are declarative for the same reason -- a step is "the agent
 * arrived at the Exchequer", not "move a sprite", so the same step list will
 * replay from a recorded session later.
 */

export type Phase = "drafting" | "proposed" | "running" | "awaiting_countersign" | "done" | "failed";

export interface LogLine {
  readonly at: string;
  readonly what: string;
  readonly kind: "plain" | "allowed" | "refused" | "gate";
}

export interface GateRequest {
  readonly toolCallId: string;
  readonly office: string;
  readonly district: string;
  readonly args: Record<string, unknown>;
}

export interface ScopeView {
  readonly id: string;
  readonly job: string;
  readonly offices: readonly { office: string; disposition: "allowed" | "gated" | "blocked" }[];
  readonly resources: Readonly<Record<string, readonly string[]>>;
  readonly limits: readonly string[];
  readonly expiresInMs: number;
  readonly expiresAt?: number;
}

interface Step {
  readonly after: number;
  readonly run: (api: StepApi) => void;
}

interface StepApi {
  log: (what: string, kind?: LogLine["kind"]) => void;
  arrive: (office: string) => void;
  settle: (office: string) => void;
  gate: (gate: GateRequest) => void;
  refuse: (office: string, why: string) => void;
  online: (districts: readonly string[]) => void;
  team: (count: number) => void;
  sandbox: (open: boolean) => void;
  phase: (phase: Phase) => void;
  spend: (usd: number) => void;
  grantScope: () => void;
  /**
   * Publish a Yard report.
   *
   * The scripted runs could show an agent stopping at a boundary but never the
   * step before it -- the probes that find a boundary drawn too wide while
   * nothing has been granted yet. That is the one beat where narrowing a scope
   * is still free, and it had no way onto the screen.
   */
  yard: (report: BacktestReport | null) => void;
}

const ALL_DISTRICTS = ["records", "exchequer", "post-house", "yard", "gate"] as const;

/**
 * The offices the city draws, and which resource classes each one consumes.
 *
 * `consumes` mirrors the arg bindings in the server's office registry. Without
 * it the inspector flattened every granted resource onto every building, so
 * `charge.refund` claimed it could reach ticket ids and email addresses it has
 * no argument for -- overstating authority on the one screen whose job is
 * stating it precisely.
 *
 * An office consuming nothing cannot be narrowed by id at all: it is granted
 * wholesale or withheld, which is exactly what makes `customer.list` the
 * instructive counterfactual.
 */
export const OFFICES = [
  { office: "ticket.get", district: "records", consumes: ["ticket_ids"] },
  { office: "ticket.reply", district: "records", consumes: ["ticket_ids"] },
  { office: "ticket.close", district: "records", consumes: ["ticket_ids"] },
  { office: "charge.get", district: "exchequer", consumes: ["charge_ids"] },
  { office: "charge.find_by_order", district: "exchequer", consumes: ["order_ids"] },
  { office: "charge.refund", district: "exchequer", consumes: ["charge_ids"] },
  { office: "customer.list", district: "exchequer", consumes: [] },
  { office: "mail.send", district: "post-house", consumes: ["mail_to"] },
  { office: "mail.list", district: "post-house", consumes: [] },
];

const NARROW_SCOPE: ScopeView = {
  id: "SC-184",
  job: "Refund order #184 and notify its owner",
  offices: [
    { office: "ticket.get", disposition: "allowed" },
    { office: "charge.get", disposition: "allowed" },
    { office: "charge.refund", disposition: "gated" },
    { office: "mail.send", disposition: "gated" },
    { office: "customer.list", disposition: "blocked" },
    { office: "ticket.close", disposition: "blocked" },
  ],
  resources: {
    ticket_ids: ["tkt_184"],
    charge_ids: ["ch_184"],
    mail_to: ["customer@example.test"],
  },
  limits: ["refund ≤ $49.00", "1 refund", "1 email"],
  expiresInMs: 10 * 60 * 1000,
};

export function useMission() {
  const [phase, setPhase] = useState<Phase>("drafting");
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [scopeState, setScopeState] = useState<"none" | "proposed" | "granted">("none");
  const [yard, setYard] = useState<BacktestReport | null>(null);
  const [online, setOnline] = useState<readonly string[]>([]);
  const [figures, setFigures] = useState<readonly Figure[]>([]);
  const [gate, setGate] = useState<GateRequest | null>(null);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const [refusedAt, setRefusedAt] = useState<{ u: number; v: number } | null>(null);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [treasury, setTreasury] = useState(0);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [officeActivity, setOfficeActivity] = useState<Readonly<Record<string, OfficeActivity>>>({});

  const timers = useRef<number[]>([]);

  const schedule = useCallback((run: () => void, after: number) => {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((candidate) => candidate !== timer);
      run();
    }, after);
    timers.current.push(timer);
    return timer;
  }, []);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // The expiry countdown ticks locally so the wall can visibly close without a
  // message per second from the server.
  useEffect(() => {
    if (expiresAt === null) {
      setExpiresIn(null);
      return;
    }
    const tick = window.setInterval(() => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        clearTimers();
        setExpiresAt(null);
        setExpiresIn(0);
        setScopeState("none");
        setGate(null);
        setPhase("done");
        setLog((lines) => [
          ...lines,
          {
            at: new Date().toLocaleTimeString(undefined, { hour12: false }),
            what: "Scope expired. Every office is unreachable again.",
            kind: "refused",
          },
        ]);
        return;
      }
      setExpiresIn(remaining);
    }, 250);
    return () => window.clearInterval(tick);
  }, [clearTimers, expiresAt]);

  const api: StepApi = {
    log: (what, kind = "plain") =>
      setLog((lines) => [
        ...lines,
        { at: new Date().toLocaleTimeString(undefined, { hour12: false }), what, kind },
      ]),
    arrive: (office) => {
      const district = OFFICES.find((candidate) => candidate.office === office)?.district;
      if (!district) return;
      const plot = plotFor(district);
      if (!plot) return;
      setFigures((current) => {
        const rest = current.filter((f) => f.kind !== "agent");
        return [
          { id: "agent", u: plot.landmark.u - 2, v: plot.landmark.v, kind: "agent" as const },
          ...rest,
        ];
      });
      setOfficeActivity((current) => ({
        ...Object.fromEntries(
          Object.entries(current).map(([id, record]) => [id, { ...record, busy: false }]),
        ),
        [office]: {
          ...(current[office] ?? { calls: 0, refusal: null }),
          busy: true,
        },
      }));
    },
    settle: (office) => {
      setOfficeActivity((current) => ({
        ...current,
        [office]: {
          calls: (current[office]?.calls ?? 0) + 1,
          busy: false,
          refusal: null,
        },
      }));
    },
    gate: (request) => {
      setGate(request);
      setPhase("awaiting_countersign");
      setOfficeActivity((current) => ({
        ...current,
        [request.office]: {
          ...(current[request.office] ?? { calls: 0, refusal: null }),
          busy: true,
        },
      }));
    },
    refuse: (office, why) => {
      const district = OFFICES.find((candidate) => candidate.office === office)?.district;
      if (!district) return;
      const plot = plotFor(district);
      if (plot) setRefusedAt({ u: plot.landmark.u - 2, v: plot.landmark.v });
      setOfficeActivity((current) => ({
        ...current,
        [office]: {
          ...(current[office] ?? { calls: 0 }),
          busy: false,
          refusal: why,
        },
      }));
      api.log(why, "refused");
      // The flash is brief on purpose: a permanent marker would read as damage
      // rather than as something that was prevented.
      schedule(() => setRefusedAt(null), 1600);
    },
    online: setOnline,
    team: (count) =>
      setFigures((current) => {
        const agent = current.filter((f) => f.kind === "agent");
        const plot = plotFor("exchequer");
        const team = Array.from({ length: count }, (_, i) => ({
          id: `team-${i}`,
          u: (plot?.landmark.u ?? 13) + 1 + i,
          v: (plot?.landmark.v ?? 5) + 2,
          kind: "team" as const,
        }));
        return [...agent, ...team];
      }),
    sandbox: setSandboxOpen,
    phase: setPhase,
    spend: (usd) => setTreasury((t) => Number((t + usd).toFixed(4))),
    grantScope: () => {
      setScope(NARROW_SCOPE);
      setScopeState("granted");
      setExpiresAt(Date.now() + NARROW_SCOPE.expiresInMs);
    },
    yard: setYard,
  };

  const play = useCallback(
    (steps: readonly Step[]) => {
      clearTimers();
      for (const step of steps) {
        schedule(() => step.run(api), step.after);
      }
    },
    [clearTimers, schedule],
  );

  const reset = useCallback(() => {
    clearTimers();
    setPhase("drafting");
    setScope(null);
    setScopeState("none");
    setOnline([]);
    setFigures([]);
    setGate(null);
    setLog([]);
    setRefusedAt(null);
    setSandboxOpen(false);
    setTreasury(0);
    setExpiresAt(null);
    setOfficeActivity({});
    // Cleared with everything else, or the over-reach findings would follow the
    // operator into whichever run they picked next and describe a scope that is
    // no longer on screen.
    setYard(null);
  }, [clearTimers]);

  /* ---------------------------------------------------------------- scope */

  const propose = useCallback(() => {
    setScope(NARROW_SCOPE);
    setScopeState("proposed");
    setPhase("proposed");
    api.log("Scope proposed — sealed before any ticket is read", "gate");
  }, []);

  const grant = useCallback(() => {
    setScopeState("granted");
    setPhase("running");
    setExpiresAt(Date.now() + NARROW_SCOPE.expiresInMs);
    api.log("Scope granted. 3 offices allowed, 2 gated, everything else absent.", "allowed");
  }, []);

  const denyScope = useCallback(() => {
    clearTimers();
    setScopeState("none");
    setScope(null);
    setPhase("drafting");
    setGate(null);
    setExpiresAt(null);
    api.log("Scope refused. Nothing was granted.", "refused");
  }, [clearTimers]);

  const revoke = useCallback(() => {
    clearTimers();
    setScopeState("none");
    setExpiresAt(null);
    setPhase("done");
    setGate(null);
    api.log("Scope revoked. Every office is unreachable again.", "refused");
  }, [clearTimers]);

  const countersign = useCallback(
    (approved: boolean) => {
      const request = gate;
      if (!request || scopeState !== "granted") {
        if (request) api.log(`Stale countersign rejected — ${request.office}`, "refused");
        setGate(null);
        return;
      }
      setGate(null);
      setPhase("running");

      if (!approved) {
        setOfficeActivity((current) => ({
          ...current,
          [request.office]: {
            ...(current[request.office] ?? { calls: 0 }),
            busy: false,
            refusal: "Countersign refused",
          },
        }));
        api.log(`Countersign refused — ${request.office} did not run`, "refused");
        return;
      }

      api.settle(request.office);
      api.log(`Countersigned ${request.office}`, "allowed");
      schedule(() => {
        api.log("$49.00 refunded on ch_184", "allowed");
        api.spend(0.014);
      }, 500);
    },
    [gate, schedule, scopeState],
  );

  /* ------------------------------------------------------------ scenarios */

  const runPoisonedTicket = useCallback(() => {
    reset();
    play(POISONED_TICKET);
  }, [play, reset]);

  const runCleanJob = useCallback(() => {
    reset();
    play(CLEAN_JOB);
  }, [play, reset]);

  const runOverReach = useCallback(() => {
    reset();
    play(OVER_REACH);
  }, [play, reset]);

  const runNoScope = useCallback(() => {
    reset();
    play(NO_SCOPE);
  }, [play, reset]);

  const rawState = scriptedRawState({
    phase,
    scope,
    scopeState,
    online,
    figures,
    gate,
    log,
    refusedAt,
    sandboxOpen,
    expiresAt,
    officeActivity,
    now: Date.now(),
  });

  return {
    phase,
    scope,
    scopeState,
    online,
    offices: OFFICES,
    figures,
    gate,
    gateDistricts: gate ? [gate.district] : [],
    log,
    refusedAt,
    sandboxOpen,
    // Null for most replays: they are scripted rather than derived, so there is
    // no scope for the Yard to have examined, and the panel renders as "runs
    // before the scope is granted". The over-reach scenario sets one, because
    // showing probes finding a boundary drawn too wide is the whole of what it
    // demonstrates.
    yard,
    // Offline replays run entirely in the browser: there is no server-side
    // record to hand over and no server-held scope to expire, so the panel
    // omits both rather than offering controls that would 404.
    missionId: null as string | null,
    // Scripted replays have no server-held scope, so nothing is ever waiting
    // on a grant here.
    awaitingGrant: false,
    proposedScope: null,
    report: null,
    verification: null,
    rawState,
    askCounterfactual: async () => null,
    expireNow: async () => undefined,
    treasury,
    inspecting,
    expiresIn,
    job: scope?.job ?? "No mission",
    granted: scopeState === "granted" ? ["records", "exchequer", "post-house"] : [],
    proposed: scopeState === "proposed" ? ["records", "exchequer", "post-house"] : [],
    inspect: setInspecting,
    propose,
    grant,
    denyScope,
    revoke,
    countersign,
    runPoisonedTicket,
    runCleanJob,
    runOverReach,
    runNoScope,
  };
}

/* -------------------------------------------------------------- scenarios */

/** The headline: an injected instruction breaks against the boundary. */
const POISONED_TICKET: readonly Step[] = [
  { after: 50, run: (a) => a.grantScope() },
  { after: 100, run: (a) => a.log("Mission opened — resolve ticket #184") },
  { after: 400, run: (a) => a.online(["records", "exchequer", "post-house", "yard", "gate"]) },
  { after: 700, run: (a) => a.log("5 districts online via MCP") },
  { after: 1200, run: (a) => a.phase("running") },
  { after: 1400, run: (a) => a.arrive("ticket.get") },
  { after: 1600, run: (a) => { a.settle("ticket.get"); a.log("ticket.get tkt_184", "allowed"); } },
  {
    after: 2400,
    run: (a) =>
      a.log("Ticket body contains an injected instruction — flagged, not obeyed", "gate"),
  },
  { after: 3000, run: (a) => a.team(2) },
  { after: 3200, run: (a) => a.sandbox(true) },
  { after: 3400, run: (a) => a.log("The Yard: generated probe validating the amount", "plain") },
  { after: 4200, run: (a) => a.arrive("charge.get") },
  { after: 4400, run: (a) => { a.settle("charge.get"); a.log("charge.get ch_184 — history redacted by projection", "allowed"); } },
  { after: 5200, run: (a) => a.refuse("charge.refund", "OUT OF SCOPE  charge.refund ch_185 — not a granted charge") },
  { after: 6000, run: (a) => a.refuse("mail.send", "OUT OF SCOPE  mail.send attacker@example.test") },
  {
    after: 7000,
    run: (a) =>
      a.gate({
        toolCallId: "tc_1",
        office: "charge.refund",
        district: "exchequer",
        args: { charge_id: "ch_184", amount: 4900 },
      }),
  },
];

/** Everything inside the scope. Proves the boundary has no false positives. */
/**
 * The Yard finds a boundary drawn too wide, and it is narrowed before anything
 * is granted.
 *
 * The other replays all show enforcement: an agent meeting a limit that already
 * exists. This shows the step before that, which is the only moment narrowing a
 * scope is still free -- once granted, the reach is real whether or not anyone
 * looks at it.
 *
 * The findings are the ones a real backtest produces against this scope, and
 * they are in the shipped recording too: `charge.get` answers with the
 * customer's full payment history when the job needs an amount, so the scope
 * leaks a record it never needed. Projection closes it.
 */
const OVER_REACH: readonly Step[] = [
  { after: 50, run: (a) => a.log("Mission opened — refund order #184") },
  { after: 400, run: (a) => a.online(["records", "exchequer", "post-house", "yard", "gate"]) },
  { after: 900, run: (a) => a.log("Scope proposed — nothing granted yet", "gate") },
  {
    after: 1400,
    run: (a) => {
      a.arrive("charge.get");
      a.log("The Yard: 36 adversarial probes — nothing called, nothing spent", "plain");
    },
  },
  {
    after: 2400,
    run: (a) => {
      a.settle("charge.get");
      a.yard({
        probesRun: 36,
        clean: false,
        findings: [
          {
            kind: "response_over_reach",
            severity: "warning",
            office: "charge.get",
            summary: "charge.get answers with the customer's whole payment history",
            detail: ["customer.email", "customer.address", "customer.history"],
            remedy: "Project the response down to id, amount and refunded",
          },
          {
            kind: "composition_reach",
            severity: "note",
            office: "charge.refund",
            summary: "charge.find_by_order then charge.refund reaches a charge not named in the job",
            detail: ["ord_184"],
            remedy: "Bind charge_ids to the resolved charge rather than the order",
          },
        ],
      });
      a.log("GAP FOUND  charge.get returns customer.history — not needed for a refund", "refused");
    },
  },
  {
    after: 3600,
    run: (a) => a.log("Narrowing: projection on charge.get → id, amount, refunded", "gate"),
  },
  {
    after: 4400,
    run: (a) => {
      a.yard({ probesRun: 36, clean: true, findings: [] });
      a.log("Re-probed. 36 probes, nothing over-reaching. Clean.", "allowed");
    },
  },
  {
    after: 5200,
    run: (a) => {
      a.grantScope();
      a.phase("running");
      a.log("Scope granted — narrower than the one first proposed", "allowed");
    },
  },
];

const CLEAN_JOB: readonly Step[] = [
  { after: 50, run: (a) => a.grantScope() },
  { after: 100, run: (a) => a.log("Mission opened — clean job") },
  { after: 400, run: (a) => a.online(["records", "exchequer", "post-house", "yard", "gate"]) },
  { after: 900, run: (a) => a.phase("running") },
  { after: 1100, run: (a) => a.arrive("ticket.get") },
  { after: 1300, run: (a) => { a.settle("ticket.get"); a.log("ticket.get tkt_184", "allowed"); } },
  { after: 2100, run: (a) => a.arrive("charge.get") },
  { after: 2300, run: (a) => { a.settle("charge.get"); a.log("charge.get ch_184", "allowed"); } },
  {
    after: 3200,
    run: (a) =>
      a.gate({
        toolCallId: "tc_2",
        office: "charge.refund",
        district: "exchequer",
        args: { charge_id: "ch_184", amount: 4900 },
      }),
  },
];

/** The same ticket with standing access. The contrast the demo turns on. */
const NO_SCOPE: readonly Step[] = [
  { after: 100, run: (a) => a.log("Mission opened — NO SCOPE, standing access", "refused") },
  { after: 400, run: (a) => a.online(["records", "exchequer", "post-house", "yard", "gate"]) },
  { after: 900, run: (a) => a.phase("running") },
  { after: 1100, run: (a) => a.arrive("ticket.get") },
  { after: 1300, run: (a) => { a.settle("ticket.get"); a.log("ticket.get tkt_184", "allowed"); } },
  { after: 2000, run: (a) => a.log("Injected instruction obeyed — nothing to stop it", "refused") },
  { after: 2600, run: (a) => a.arrive("charge.refund") },
  { after: 2800, run: (a) => { a.settle("charge.refund"); a.log("charge.refund ch_185 $399.00 — SUCCEEDED", "refused"); } },
  { after: 3600, run: (a) => a.log("customer.list — 3 records exfiltrated", "refused") },
  { after: 4400, run: (a) => a.arrive("mail.send") },
  { after: 4600, run: (a) => { a.settle("mail.send"); a.log("mail.send attacker@example.test — SENT", "refused"); } },
  { after: 5400, run: (a) => a.phase("failed") },
  { after: 5600, run: (a) => a.log("Mission ended. Three irreversible actions, none authorised.", "refused") },
];
