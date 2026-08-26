import type { CityFeedEvent } from "@scope-city/mission";
import type { BacktestReport } from "@scope-city/yard";
import type { Figure } from "./render/scene.js";
import { plotFor } from "./render/world.js";
import { OFFICES, type GateRequest, type LogLine, type Phase, type ScopeView } from "./useMission.js";

export interface LiveCityState {
  readonly phase: Phase;
  readonly status:
    | "idle"
    | "proposed"
    | "denied"
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  readonly detail: string | null;
  readonly online: readonly string[];
  readonly figures: readonly Figure[];
  readonly gate: GateRequest | null;
  readonly pendingGates: readonly GateRequest[];
  readonly log: readonly LogLine[];
  readonly refusedAt: { readonly u: number; readonly v: number } | null;
  readonly sandboxOpen: boolean;
  readonly scopeExpired: boolean;
  /** The Yard's verdict, once it arrives. Null before the backtest is replayed. */
  readonly yard: BacktestReport | null;
  /** The scope as proposed or granted, straight from the feed. */
  readonly proposedScope: WireScope | null;
  /** The lease term offered at proposal, fixed rather than counting down. */
  readonly proposedTtlMs: number | null;
  /**
   * What has happened at each office, keyed by office id.
   *
   * Tracked here rather than derived from the log because the log is a list of
   * lines for a human and this is state for a renderer: counting settled calls
   * by re-parsing prose would break the first time a message was reworded.
   */
  readonly officeActivity: Readonly<Record<string, OfficeActivity>>;
  /** The most recent sandbox check, shown beside the gate it justifies. */
  readonly verification: {
    readonly script: string;
    readonly output: string;
    readonly passed: boolean;
  } | null;
}

/**
 * Whether the scope is still conferring anything.
 *
 * One definition, used by everything that draws authority, because the
 * alternative is several: the building states treated any retained scope as
 * granted while the city view had already closed it, so after expiry or
 * cancellation the map fogged over and every building still reported its old
 * limits and its countersign.
 *
 * A closed scope is not a smaller scope. Expired, revoked, denied, or simply
 * finished, the authority is gone, and anything still describing it is
 * describing what the agent *used to* be able to do.
 */
export function scopeIsOpen(state: LiveCityState): boolean {
  if (state.proposedScope === null) return false;
  if (state.scopeExpired) return false;
  return (
    state.status === "proposed" ||
    state.status === "starting" ||
    state.status === "running"
  );
}

export interface OfficeActivity {
  /** Calls the ledger has settled here. */
  readonly calls: number;
  /** True between the agent arriving and finishing. */
  readonly busy: boolean;
  /** Why the boundary last refused a call here, if it did. */
  readonly refusal: string | null;
}

/** Records something happening at one office, leaving the others untouched. */
function atOffice(
  state: LiveCityState,
  office: string,
  change: Partial<OfficeActivity>,
): LiveCityState {
  const current = state.officeActivity[office] ?? { calls: 0, busy: false, refusal: null };
  return {
    ...state,
    officeActivity: { ...state.officeActivity, [office]: { ...current, ...change } },
  };
}

export const initialLiveCityState: LiveCityState = {
  phase: "drafting",
  status: "idle",
  detail: null,
  online: [],
  figures: [],
  gate: null,
  pendingGates: [],
  log: [],
  refusedAt: null,
  sandboxOpen: false,
  scopeExpired: false,
  yard: null,
  proposedScope: null,
  proposedTtlMs: null,
  verification: null,
  officeActivity: {},
};

function districtForOffice(office: string | null): string | null {
  return OFFICES.find((entry) => entry.office === office)?.district ?? null;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

function addLog(
  state: LiveCityState,
  what: string,
  kind: LogLine["kind"],
  at: number,
): LiveCityState {
  return { ...state, log: [...state.log, { at: time(at), what, kind }] };
}

function moveAgent(state: LiveCityState, office: string): LiveCityState {
  const district = districtForOffice(office);
  const plot = district ? plotFor(district) : undefined;
  if (!plot) return state;
  return {
    ...state,
    figures: [
      { id: "agent", u: plot.landmark.u - 2, v: plot.landmark.v, kind: "agent" },
      ...state.figures.filter((figure) => figure.kind !== "agent"),
    ],
  };
}

/** Pure event fold: reconnecting and replaying the same feed builds the same city. */
export function reduceLiveCity(state: LiveCityState, feed: CityFeedEvent): LiveCityState {
  if (feed.type === "scope.expired") {
    return addLog(
      { ...state, scopeExpired: true, gate: null, pendingGates: [], phase: "done" },
      "Scope expired. Every office is unreachable again.",
      "refused",
      feed.at,
    );
  }
  if (feed.type === "mission.status") {
    const phase: Phase =
      feed.status === "failed"
        ? "failed"
        : feed.status === "completed" || feed.status === "cancelled"
          ? "done"
          : feed.status === "running"
            ? "running"
            : "drafting";
    return {
      ...state,
      status: feed.status,
      phase,
      detail: feed.detail ?? null,
      ...(feed.status === "cancelled" || feed.status === "failed" || feed.status === "completed"
        ? { gate: null, pendingGates: [] }
        : {}),
    };
  }

  if (feed.type === "proxy") {
    const event = feed.event;
    switch (event.type) {
      case "call.allowed":
        // A settled call clears any earlier refusal at this office: the agent
        // tried something out of scope, was refused, and then did something
        // permitted. Leaving the building red would report the refusal as the
        // current state when it is history.
        return addLog(
          atOffice(moveAgent(state, event.office), event.office, {
            calls: (state.officeActivity[event.office]?.calls ?? 0) + 1,
            busy: false,
            refusal: null,
          }),
          `ALLOWED  ${event.office}`,
          "allowed",
          event.at,
        );
      case "call.out_of_scope": {
        const plot = event.district ? plotFor(event.district) : undefined;
        return addLog(
          atOffice(
            { ...state, refusedAt: plot ? plot.landmark : state.refusedAt },
            event.office,
            { busy: false, refusal: event.detail },
          ),
          `OUT OF SCOPE  ${event.office} — ${event.detail}`,
          "refused",
          event.at,
        );
      }
      case "response.injection_detected":
        return addLog(
          state,
          `INJECTION FLAGGED in ${event.office} — instruction-shaped data was not trusted`,
          "gate",
          event.at,
        );
      case "response.redacted":
        return addLog(
          state,
          `REDACTED  ${event.office} — ${event.redacted.join(", ")}`,
          "plain",
          event.at,
        );
      case "upstream.failed":
        return addLog(state, `UPSTREAM FAILED  ${event.office} — ${event.message}`, "refused", event.at);
      default:
        return state;
    }
  }

  // The scope arrives on the feed rather than only in the launch response, so a
  // browser reconnecting mid-review replays the proposal instead of finding an
  // empty panel and a mission it cannot explain.
  if (feed.type === "scope.proposed") {
    return {
      ...addLog(state, `SCOPE PROPOSED  ${feed.scope.scopeId}`, "plain", Date.now()),
      proposedScope: feed.scope,
      // Captured when the proposal arrives, because the lease has not started.
      //
      // Showing `expiresAt - now` counted down while the operator read the Yard
      // report, so a ten-minute lease advertised nine and then eight -- while
      // the server restarts the clock at grant and hands over the full term.
      // The number on the review screen has to be the term being offered, not a
      // countdown on a lease nobody has taken out.
      proposedTtlMs: Math.max(0, feed.scope.expiresAt - Date.now()),
    };
  }

  if (feed.type === "scope.granted") {
    return addLog(
      { ...state, proposedScope: feed.scope },
      `SCOPE GRANTED  ${feed.scope.scopeId}`,
      "allowed",
      feed.at,
    );
  }

  if (feed.type === "scope.denied") {
    // Closed, not merely logged. A denial that left the scope effective would
    // keep the limits drawn and the lease counting down for authority nobody
    // granted -- the most misleading thing this reducer could do.
    return addLog(
      { ...state, scopeExpired: true },
      "SCOPE DENIED  the agent was never dispatched",
      "refused",
      feed.at,
    );
  }

  if (feed.type === "yard.report") {
    // Logged as well as stored, so the findings land in THE RECORD in the order
    // they were produced -- before the first call -- rather than only appearing
    // in a panel that a viewer may never open.
    const lines = feed.report.clean
      ? [`YARD  ${feed.report.probesRun} probes, no holes`]
      : [
          `YARD  ${feed.report.probesRun} probes, ${feed.report.findings.length} finding(s)`,
          ...feed.report.findings
            .filter((finding) => finding.severity !== "note")
            .map((finding) => `YARD  ${finding.severity.toUpperCase()}  ${finding.summary}`),
        ];

    return lines.reduce<LiveCityState>(
      (acc, line) => addLog(acc, line, "plain", Date.now()),
      { ...state, yard: feed.report },
    );
  }

  const event = feed.event;
  switch (event.type) {
    case "mission.started":
      return { ...state, phase: "running" };
    case "district.online":
      return {
        ...state,
        online: event.district === "scope-city-live"
          ? ["records", "exchequer", "post-house", "gate"]
          : [...new Set([...state.online, event.district])],
      };
    case "agent.arrived":
      return atOffice(moveAgent(state, event.office), event.office, { busy: true });
    case "agent.finished":
      return atOffice(state, event.office, { busy: false });
    case "field.joined": {
      const index = state.figures.filter((figure) => figure.kind === "team").length;
      const plot = plotFor("exchequer")!;
      return {
        ...state,
        figures: [
          ...state.figures.filter((figure) => figure.id !== event.threadId),
          {
            id: event.threadId,
            u: plot.landmark.u + 1 + index,
            v: plot.landmark.v + 2,
            kind: "team",
            // The harness names the threads it spawns, and those names are the
            // assignments from the brief. Carried through so the map can say
            // which figure is doing what.
            title: event.title,
          },
        ],
      };
    }
    case "field.left":
      return { ...state, figures: state.figures.filter((figure) => figure.id !== event.threadId) };
    case "gate.raised": {
      const district = districtForOffice(event.office) ?? "gate";
      const gate = {
        toolCallId: event.toolCallId,
        office: event.office ?? "unknown tool",
        district,
        args: (event.args ?? {}) as Record<string, unknown>,
      };
      if (state.gate?.toolCallId === gate.toolCallId || state.pendingGates.some(
        (pending) => pending.toolCallId === gate.toolCallId,
      )) return state;
      return {
        ...state,
        phase: "awaiting_countersign",
        gate: state.gate ?? gate,
        pendingGates: state.gate ? [...state.pendingGates, gate] : state.pendingGates,
      };
    }
    case "gate.cleared": {
      if (event.toolCallId === state.gate?.toolCallId) {
        const [next, ...remaining] = state.pendingGates;
        return {
          ...state,
          gate: next ?? null,
          pendingGates: remaining,
          phase: next ? "awaiting_countersign" : "running",
        };
      }
      return {
        ...state,
        pendingGates: state.pendingGates.filter((gate) => gate.toolCallId !== event.toolCallId),
      };
    }
    case "gate.abandoned": {
      // Logged as a refusal, because that is what happened to the call, and
      // worded so nobody reads it as one. "Refused" would credit an operator
      // with a decision they never made; the run ended with the question still
      // standing, which is a fact about the people rather than the agent.
      const seconds = Math.round(event.waitedMs / 1000);

      // Promoted the same way a decision promotes, because abandonment removes
      // a gate exactly as a decision does. Nulling the active one without
      // pulling the next up left the city showing no gate at all while another
      // was still waiting -- and still in `awaiting_countersign`, holding for a
      // question it had stopped displaying.
      const remaining = state.pendingGates.filter(
        (gate) => gate.toolCallId !== event.toolCallId,
      );
      const wasActive = state.gate?.toolCallId === event.toolCallId;
      const [next, ...rest] = remaining;

      const cleared = wasActive
        ? {
            ...state,
            gate: next ?? null,
            pendingGates: rest,
            phase: next ? ("awaiting_countersign" as const) : ("running" as const),
          }
        : { ...state, pendingGates: remaining };

      return addLog(
        cleared,
        `THE GATE  ${event.office ?? "unknown tool"} — unanswered after ${seconds}s, nothing ran`,
        "refused",
        event.at,
      );
    }
    case "yard.verified":
      // Stored as well as logged. The gate needs it beside the decision it
      // justifies; the log needs it in sequence, so the record shows the
      // check happening before the approval rather than after.
      return addLog(
        { ...state, verification: { script: event.script, output: event.output, passed: event.passed } },
        `SANDBOX  ${event.passed ? "verified" : "CHECK FAILED"}`,
        event.passed ? "allowed" : "refused",
        event.at,
      );

    case "yard.opened":
      return {
        ...state,
        sandboxOpen: true,
        online: [...new Set([...state.online, "yard"])],
      };
    case "transmission":
      return event.text.trim()
        ? addLog(state, event.text.trim(), "plain", event.at)
        : state;
    default:
      return state;
  }
}

export interface WireScope {
  readonly scopeId: string;
  readonly job: string;
  readonly offices: readonly string[];
  readonly countersignRequired: readonly string[];
  readonly resources: Readonly<Record<string, readonly string[]>>;
  readonly limits: {
    readonly maxAmountMinor?: Readonly<Record<string, number>>;
    readonly maxCalls?: Readonly<Record<string, number>>;
  };
  readonly expiresAt: number;
  /**
   * Null while the scope is only proposed.
   *
   * A scope waiting on a human has not been granted, so there is no grant time
   * to report. Typing this as a plain number let a proposal be treated as a
   * grant with a timestamp of zero, which reads on screen as a lease that
   * expired decades ago.
   */
  readonly grantedAt: number | null;
}

export function scopeViewFromWire(scope: WireScope): ScopeView {
  const exposed = new Set(scope.offices);
  const gated = new Set(scope.countersignRequired);
  return {
    id: scope.scopeId,
    job: scope.job,
    offices: OFFICES.map((entry) => ({
      office: entry.office,
      disposition: !exposed.has(entry.office)
        ? "blocked" as const
        : gated.has(entry.office)
          ? "gated" as const
          : "allowed" as const,
    })),
    resources: scope.resources,
    limits: [
      ...Object.entries(scope.limits.maxAmountMinor ?? {}).map(
        ([office, amount]) => `${office} ≤ $${(amount / 100).toFixed(2)}`,
      ),
      ...Object.entries(scope.limits.maxCalls ?? {}).map(
        ([office, count]) => `${office} × ${count}`,
      ),
    ],
    // Measured from the grant when there is one, and from now when the scope
    // is still a proposal -- the lease has not started ticking yet, so the
    // honest number is its full length.
    expiresInMs: Math.max(0, scope.expiresAt - (scope.grantedAt ?? Date.now())),
    expiresAt: scope.expiresAt,
  };
}
