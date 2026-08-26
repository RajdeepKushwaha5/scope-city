import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityFeedEvent } from "@scope-city/mission";
import { cityViewFrom } from "./city-view.js";
import { initialLiveCityState, reduceLiveCity, scopeViewFromWire } from "./live-state.js";
import { OFFICES, type ScopeView } from "./useMission.js";
import { LaunchGuard } from "./launch-guard.js";
import type { CounterfactualView } from "./counterfactual-view.js";

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

  const launch = useCallback(async (order: string, effort?: string) => {
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
        // Omitted when the operator expressed no preference, so the server
        // sees "no effort" rather than the empty string.
        body: JSON.stringify(effort ? { order, effort } : { order }),
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

  /**
   * Grants the proposed scope, which is what actually starts the agent.
   *
   * Kept separate from launching on purpose. Launching derives a scope and
   * runs the Yard over it; nothing is registered with the proxy and no
   * TrueForge session exists until this call. That gap is the product: the
   * operator sees the authority before anything can use it.
   */
  const grant = useCallback(async () => {
    if (!missionId) return;
    try {
      const response = await fetch(`/api/missions/${missionId}/grant`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The scope could not be granted.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [missionId]);

  /** Refuses the proposed scope. Nothing was ever registered, so nothing is revoked. */
  const denyScope = useCallback(async () => {
    if (!missionId) return;
    await fetch(`/api/missions/${missionId}/deny`, { method: "POST" }).catch(() => undefined);
  }, [missionId]);

  /**
   * Asks what one more office would cost, before it is granted.
   *
   * Answered by the server against the proposed scope, using the same engine
   * the backtest uses, so the "what if" and the report cannot disagree.
   */
  const askCounterfactual = useCallback(
    async (office: string) => {
      if (!missionId) return null;
      try {
        const response = await fetch(`/api/missions/${missionId}/counterfactual`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ office }),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { counterfactual?: unknown };
        return (body.counterfactual ?? null) as CounterfactualView | null;
      } catch {
        return null;
      }
    },
    [missionId],
  );

  /**
   * Closes the city limits now instead of waiting out the lease.
   *
   * The server moves the scope to `expired` through the same path its timer
   * uses, so what happens afterwards is the real refusal rather than a
   * demonstration of one.
   */
  const expireNow = useCallback(async () => {
    if (!missionId) return;

    // Failures are surfaced, not swallowed.
    //
    // This button exists to be pressed while somebody is watching, and a
    // silent catch made a failed request indistinguishable from a working one:
    // the limits stay open, nothing is said, and the honest reading on camera
    // is that the enforcement did not fire. Whatever went wrong, the operator
    // needs to know the scope is still live.
    try {
      const response = await fetch(`/api/missions/${missionId}/expire`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The scope could not be expired.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [missionId]);

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

  // Presentation comes from the shared mapping, so a recorded replay of this
  // mission renders identically to the mission itself.
  const view = cityViewFrom({ state, scope, expiresIn, idleJob: "No live mission" });

  return {
    ...view,
    active,
    connection,
    error,
    launch,
    leave,
    missionId,
    awaitingGrant: state.status === "proposed",
    proposedScope: state.proposedScope,
    proposedTtlMs: state.proposedTtlMs,
    report: state.yard,
    verification: state.verification,
    // The raw reducer state, for views that derive rather than read.
    rawState: state,
    inspecting,
    inspect: setInspecting,
    grant,
    denyScope,
    askCounterfactual,
    propose: () => undefined,
    revoke: leave,
    countersign,
    expireNow,
    runPoisonedTicket: () => undefined,
    runCleanJob: () => undefined,
    runNoScope: () => undefined,
  };
}
