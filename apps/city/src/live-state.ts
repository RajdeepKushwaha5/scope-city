import type { CityFeedEvent } from "@scope-city/mission";
import type { Figure } from "./render/scene.js";
import { plotFor } from "./render/world.js";
import { OFFICES, type GateRequest, type LogLine, type Phase, type ScopeView } from "./useMission.js";

export interface LiveCityState {
  readonly phase: Phase;
  readonly status: "idle" | "starting" | "running" | "completed" | "failed" | "cancelled";
  readonly detail: string | null;
  readonly online: readonly string[];
  readonly figures: readonly Figure[];
  readonly gate: GateRequest | null;
  readonly log: readonly LogLine[];
  readonly refusedAt: { readonly u: number; readonly v: number } | null;
  readonly sandboxOpen: boolean;
  readonly scopeExpired: boolean;
}

export const initialLiveCityState: LiveCityState = {
  phase: "drafting",
  status: "idle",
  detail: null,
  online: [],
  figures: [],
  gate: null,
  log: [],
  refusedAt: null,
  sandboxOpen: false,
  scopeExpired: false,
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
      { ...state, scopeExpired: true, gate: null, phase: "done" },
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
      ...(feed.status === "cancelled" || feed.status === "failed" ? { gate: null } : {}),
    };
  }

  if (feed.type === "proxy") {
    const event = feed.event;
    switch (event.type) {
      case "call.allowed":
        return addLog(moveAgent(state, event.office), `ALLOWED  ${event.office}`, "allowed", event.at);
      case "call.out_of_scope": {
        const plot = event.district ? plotFor(event.district) : undefined;
        return addLog(
          { ...state, refusedAt: plot ? plot.landmark : state.refusedAt },
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
      return moveAgent(state, event.office);
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
          },
        ],
      };
    }
    case "field.left":
      return { ...state, figures: state.figures.filter((figure) => figure.id !== event.threadId) };
    case "gate.raised": {
      const district = districtForOffice(event.office) ?? "gate";
      return {
        ...state,
        phase: "awaiting_countersign",
        gate: {
          toolCallId: event.toolCallId,
          office: event.office ?? "unknown tool",
          district,
          args: (event.args ?? {}) as Record<string, unknown>,
        },
      };
    }
    case "gate.cleared":
      return event.toolCallId === state.gate?.toolCallId
        ? { ...state, gate: null, phase: "running" }
        : state;
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

interface WireScope {
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
  readonly grantedAt: number;
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
    expiresInMs: Math.max(0, scope.expiresAt - scope.grantedAt),
    expiresAt: scope.expiresAt,
  };
}
