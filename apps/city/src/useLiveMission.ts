import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityFeedEvent } from "@scope-city/mission";
import { initialLiveCityState, reduceLiveCity, scopeViewFromWire } from "./live-state.js";
import { OFFICES, type ScopeView } from "./useMission.js";
import { LaunchGuard } from "./launch-guard.js";

interface LaunchResponse {
  readonly missionId: string;
  readonly eventUrl: string;
  readonly scope: Parameters<typeof scopeViewFromWire>[0];
}

export function useLiveMission() {
  const [active, setActive] = useState(false);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [state, setState] = useState(initialLiveCityState);
  const [connection, setConnection] = useState<"offline" | "connecting" | "live" | "reconnecting">("offline");
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const launchGuardRef = useRef(new LaunchGuard());

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => () => {
    launchGuardRef.current.cancel();
    closeSource();
  }, [closeSource]);

  useEffect(() => {
    if (!scope || state.status === "cancelled" || state.status === "failed" || state.status === "completed") {
      setExpiresIn(null);
      return;
    }
    const deadline = scope.expiresAt ?? Date.now() + scope.expiresInMs;
    const tick = () => setExpiresIn(Math.max(0, deadline - Date.now()));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [scope, state.status]);

  useEffect(() => {
    if (!state.refusedAt) return;
    const timer = window.setTimeout(
      () => setState((current) => ({ ...current, refusedAt: null })),
      1600,
    );
    return () => window.clearTimeout(timer);
  }, [state.refusedAt]);

  const connect = useCallback(
    (url: string) => {
      closeSource();
      const source = new EventSource(url);
      sourceRef.current = source;
      setConnection("connecting");
      source.onopen = () => {
        setConnection("live");
        setError(null);
      };
      source.addEventListener("mission", (message) => {
        try {
          const event = JSON.parse((message as MessageEvent<string>).data) as CityFeedEvent;
          setState((current) => reduceLiveCity(current, event));
        } catch {
          setError("The mission stream sent an unreadable event.");
        }
      });
      source.onerror = () => setConnection("reconnecting");
    },
    [closeSource],
  );

  const launch = useCallback(async (order: string) => {
    const launchVersion = launchGuardRef.current.begin();
    closeSource();
    setActive(true);
    setMissionId(null);
    setScope(null);
    setState(initialLiveCityState);
    setError(null);
    setConnection("connecting");

    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const body = (await response.json()) as LaunchResponse & { error?: string; detail?: string };
      if (!launchGuardRef.current.isCurrent(launchVersion)) {
        if (response.ok && body.missionId) {
          await fetch(`/api/missions/${body.missionId}/cancel`, { method: "POST" }).catch(() => undefined);
        }
        return;
      }
      if (!response.ok) throw new Error(body.detail ?? body.error ?? `launch failed (${response.status})`);
      setMissionId(body.missionId);
      setScope(scopeViewFromWire(body.scope));
      connect(body.eventUrl);
    } catch (cause) {
      if (!launchGuardRef.current.isCurrent(launchVersion)) return;
      setActive(false);
      setConnection("offline");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [closeSource, connect]);

  const countersign = useCallback(
    async (approved: boolean) => {
      if (!missionId || !state.gate) return;
      const response = await fetch(`/api/missions/${missionId}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolCallId: state.gate.toolCallId, approved }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "The gate decision was not accepted.");
      }
    },
    [missionId, state.gate],
  );

  const leave = useCallback(async () => {
    launchGuardRef.current.cancel();
    closeSource();
    if (missionId && (state.status === "starting" || state.status === "running")) {
      await fetch(`/api/missions/${missionId}/cancel`, { method: "POST" }).catch(() => undefined);
    }
    setActive(false);
    setMissionId(null);
    setScope(null);
    setState(initialLiveCityState);
    setConnection("offline");
  }, [closeSource, missionId, state.status]);

  const scopeEffective = Boolean(
    scope &&
      !state.scopeExpired &&
      state.status !== "cancelled" &&
      state.status !== "failed" &&
      state.status !== "completed" &&
      expiresIn !== 0,
  );
  const granted = useMemo(
    () => (scopeEffective
      ? ["records", "exchequer", "post-house"]
      : []),
    [scopeEffective],
  );

  return {
    active,
    connection,
    error,
    launch,
    leave,
    phase: state.phase,
    scope,
    scopeState: scopeEffective ? "granted" as const : "none" as const,
    online: state.online,
    offices: OFFICES,
    figures: state.figures,
    gate: state.gate,
    pendingGateCount: state.pendingGates.length,
    gateDistricts: state.gate ? [state.gate.district] : [],
    log: state.log,
    refusedAt: state.refusedAt,
    sandboxOpen: state.sandboxOpen,
    treasury: 0,
    inspecting,
    expiresIn,
    job: scope?.job ?? "No live mission",
    granted,
    proposed: [] as readonly string[],
    inspect: setInspecting,
    propose: () => undefined,
    grant: () => undefined,
    denyScope: () => undefined,
    revoke: leave,
    countersign,
    runPoisonedTicket: () => undefined,
    runCleanJob: () => undefined,
    runNoScope: () => undefined,
  };
}
