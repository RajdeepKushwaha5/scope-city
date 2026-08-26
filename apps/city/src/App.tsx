import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./hud/hud.css";
import { pickBuilding, isMeaningful } from "./render/pick.js";
import { cityFor } from "./render/scene.js";
import { buildingStates } from "./building-state.js";
import { drawScene, fitCamera, type Figure, type SceneState } from "./render/scene.js";
import { DISTRICT_PLOTS, layOutCity, plotFor } from "./render/world.js";
import { CityConsole } from "./hud/CityConsole.js";
import { ScopePanel } from "./hud/ScopePanel.js";
import { ScopeReview } from "./hud/ScopeReview.js";
import { BuildingInspector } from "./hud/BuildingInspector.js";
import { YardPanel } from "./hud/YardPanel.js";
import { DistrictScan } from "./hud/DistrictScan.js";
import { MissionOrder } from "./hud/MissionOrder.js";
import { CitySnapshot } from "./hud/CitySnapshot.js";
import { useMission } from "./useMission.js";
import { useLiveMission } from "./useLiveMission.js";
import { useRecordedMission } from "./useRecordedMission.js";

/**
 * The city.
 *
 * The canvas draws the world and the HUD windows float over it. Everything the
 * HUD shows comes from the same mission state the canvas renders, so the two
 * can never disagree about what the agent is doing -- which matters, because
 * the whole point of the interface is that you can trust what you are looking
 * at.
 */
/**
 * The shipped recording.
 *
 * Named here rather than inlined at the call site so the deployed asset has
 * one place to change, and so a build that ships a different capture does not
 * need a component edit to find it.
 */
const RECORDING_URL = "/replays/refund-184.json";

/**
 * Offices worth asking "what if" about.
 *
 * A short, curated list rather than every office the city has. The question is
 * only interesting for permissions someone might plausibly add and regret --
 * `customer.list` takes no record id and so cannot be narrowed at all, which is
 * the most instructive thing the counterfactual has to say.
 */
const COUNTERFACTUAL_CANDIDATES = [
  "customer.list",
  "mail.send",
  "mail.list",
  "ticket.close",
] as const;

export function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [selectedOffice, setSelectedOffice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ office: string; districts: readonly string[] } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const replay = useMission();
  const live = useLiveMission();
  const recorded = useRecordedMission();

  // Live wins, then a recorded run, then the scripted replays. Ordered by how
  // much each one proves: a live mission is happening, a recording happened,
  // and a scripted replay illustrates.
  const mission = live.active
    ? live
    : recorded.playing || recorded.record
      ? {
          ...replay,
          ...recorded.view,
          // Controls are inert during a recorded replay.
          //
          // Spreading the scripted replay's handlers under the recorded view
          // left buttons that mutated one mission's state while the HUD
          // rendered another's -- a Grant that appeared to do nothing, and a
          // countersign that quietly advanced a scripted run nobody was
          // watching. A recording is a past mission: there is nothing left to
          // decide about it, and the honest control is one that does not
          // pretend otherwise.
          propose: () => undefined,
          grant: () => undefined,
          denyScope: () => undefined,
          revoke: recorded.stop,
          countersign: async () => undefined,
          expireNow: async () => undefined,
          runPoisonedTicket: () => undefined,
          runCleanJob: () => undefined,
          runNoScope: () => undefined,
        }
      : replay;
  const structureCount = useMemo(
    // Six landmarks, four Exchequer wings, and eleven coastal structures.
    () => layOutCity(mission.offices).length + DISTRICT_PLOTS.length + 15,
    [mission.offices],
  );

  // --- canvas sizing ----------------------------------------------------

  useEffect(() => {
    const measure = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (size.width > 0 && camera.zoom === 1 && camera.x === 0) {
      setCamera(fitCamera(size));
    }
  }, [size, camera.zoom, camera.x]);

  // --- the render loop --------------------------------------------------

  // Derived once per state change and shared by the canvas and the inspector,
  // so the marker on a roof and the panel beside it cannot disagree.
  const runtimeStates = useMemo(
    // From whichever mission is on screen. Deriving from the live state while a
    // recording played meant judge mode drew the idle live mission -- every
    // office "not in scope" -- beside a replay showing the opposite.
    () => buildingStates(live.active ? live.rawState : recorded.state, mission.offices),
    [live.active, live.rawState, recorded.state, mission.offices],
  );

  const scene: SceneState = useMemo(
    () => ({
      online: mission.online,
      granted: mission.granted,
      proposed: mission.proposed,
      offices: mission.offices,
      figures: mission.figures,
      gates: mission.gateDistricts,
      refusedAt: mission.refusedAt,
      scopeState: mission.scopeState,
      buildings: runtimeStates,
      selected: selectedOffice,
      counterfactual: preview,
    }),
    [mission, runtimeStates, selectedOffice, preview],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw at device resolution and scale down, or the pixel work is soft on
    // any display with a fractional device pixel ratio.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;

    let frame = 0;
    const loop = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, scene, camera, size, time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frame);
  }, [scene, camera, size]);

  // --- camera controls --------------------------------------------------

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: start.moved || Math.abs(dx) + Math.abs(dy) > 3,
    };
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    suppressClickRef.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    suppressClickRef.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    setCamera((c) => ({
      ...c,
      zoom: Math.min(3, Math.max(0.35, c.zoom * (e.deltaY > 0 ? 0.9 : 1.1))),
    }));
  }, []);

  const takeSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scope-city-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }, "image/png");
  }, []);

  /** Canvas coordinates with the camera transform undone. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => ({
      x: (clientX - size.width / 2 - camera.x) / camera.zoom,
      y: (clientY - size.height / 2 - camera.y) / camera.zoom,
    }),
    [camera, size],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const world = toWorld(e.clientX, e.clientY);
      const { building, cell } = pickBuilding(cityFor(mission.offices).buildings, world.x, world.y);

      // A building answers the narrow question -- may the agent refund *this*
      // charge -- and the district answers only where it stands. Prefer the
      // building, and fall back to the district so clicking open ground still
      // does something rather than nothing.
      if (isMeaningful(building)) {
        setSelectedOffice(building.office);
        mission.inspect(building.district);
        return;
      }

      setSelectedOffice(null);
      const plot = DISTRICT_PLOTS.find(
        (p) => cell.u >= p.u0 && cell.u <= p.u1 && cell.v >= p.v0 && cell.v <= p.v1,
      );
      mission.inspect(plot?.id ?? null);
    },
    [toWorld, mission],
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        className="world"
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onClick={onClick}
      />

      <div className="hud">
        <div className="hud__main">
          <div className="hud__scan-stack">
            <DistrictScan
              online={mission.online}
              granted={mission.granted}
              offices={mission.offices}
              structureCount={structureCount}
              dispositions={mission.scope?.offices ?? []}
              inspecting={mission.inspecting}
            />
            <CitySnapshot onSnapshot={takeSnapshot} />
            <ScopePanel
              scope={mission.scope}
              scopeState={mission.scopeState}
              onPropose={mission.propose}
              onGrant={mission.grant}
              onDeny={mission.denyScope}
              onRevoke={mission.revoke}
            />
            {live.awaitingGrant && live.proposedScope ? (
              <ScopeReview
                scopeId={live.proposedScope.scopeId}
                job={live.proposedScope.job}
                offices={live.proposedScope.offices}
                resources={live.proposedScope.resources}
                maxAmountMinor={live.proposedScope.limits.maxAmountMinor ?? {}}
                maxCalls={live.proposedScope.limits.maxCalls ?? {}}
                countersignRequired={live.proposedScope.countersignRequired}
                expiresInMs={live.proposedTtlMs ?? 0}
                report={live.report}
                candidates={COUNTERFACTUAL_CANDIDATES.filter(
                  (office) => !live.proposedScope!.offices.includes(office),
                )}
                onGrant={() => void live.grant()}
                onDeny={() => void live.denyScope()}
                onAsk={live.askCounterfactual}
                onPreview={setPreview}
              />
            ) : null}
            <BuildingInspector
              state={selectedOffice === null ? null : (runtimeStates.get(selectedOffice) ?? null)}
              onClose={() => setSelectedOffice(null)}
            />
            <YardPanel report={mission.yard} />
          </div>

          <div className="hud__order">
            <MissionOrder
              active={live.active}
              connection={live.connection}
              error={live.error ?? recorded.error}
              onLaunch={live.launch}
              onStop={live.leave}
              onPoisonedReplay={replay.runPoisonedTicket}
              onCleanReplay={replay.runCleanJob}
              onNoScopeReplay={replay.runNoScope}
              onResetView={() => setCamera(fitCamera(size))}
              onRecordedReplay={() => void recorded.play(RECORDING_URL)}
              recordedPlaying={recorded.playing}
              recordedVerdict={recorded.verdict}
            />
          </div>
        </div>

        <div className="hud__console">
          <CityConsole
            phase={mission.phase}
            job={mission.job}
            treasury={mission.treasury}
            fieldSize={mission.figures.length}
            structureCount={structureCount}
            sandboxOpen={mission.sandboxOpen}
            expiresIn={mission.expiresIn}
            connection={live.connection}
            lines={mission.log}
            gate={mission.gate}
            pendingGateCount={live.active ? live.pendingGateCount : 0}
            onApprove={() => mission.countersign(true)}
            onDeny={() => mission.countersign(false)}
            missionId={mission.missionId}
            onExpireNow={() => void mission.expireNow()}
            verification={mission.verification}
          />
        </div>
      </div>
    </>
  );
}

/** Where a district's landmark stands, for moving the agent to it. */
export function districtCell(district: string): Figure | null {
  const plot = plotFor(district);
  if (!plot) return null;
  return { id: district, u: plot.landmark.u, v: plot.landmark.v, kind: "agent" };
}
