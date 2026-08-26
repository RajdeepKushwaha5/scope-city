import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./hud/hud.css";
import { pickBuilding, isMeaningful } from "./render/pick.js";
import { buildingStates } from "./building-state.js";
import { initialLiveCityState } from "./live-state.js";
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
import { ShutterFlash } from "./hud/ShutterFlash.js";
import { HoverTooltip, type HoverInfo } from "./hud/HoverTooltip.js";
import { CommandPalette, type CommandItem } from "./hud/CommandPalette.js";
import { IntroDialogue } from "./hud/IntroDialogue.js";
import { TopNav } from "./hud/TopNav.js";
import { MapControls } from "./hud/MapControls.js";
import { soundEngine } from "./hud/sound-engine.js";
import { toScreen } from "./iso/projection.js";
import { useMission } from "./useMission.js";
import { useLiveMission } from "./useLiveMission.js";
import { useRecordedMission } from "./useRecordedMission.js";
import { readSetting, writeSetting } from "./safe-storage.js";

/**
 * The city.
 *
 * The canvas draws the world and the HUD windows float over it. Everything the
 * HUD shows comes from the same mission state the canvas renders, so the two
 * can never disagree about what the agent is doing.
 */
const RECORDING_URL = "/replays/refund-184.json";

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
  const [flashActive, setFlashActive] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  // Read through the safe wrapper: this runs during the first render, and a
  // browser with storage blocked throws on the property access rather than
  // returning null -- which would white-screen the page before it drew anything.
  const [introOpen, setIntroOpen] = useState(() => readSetting("scope_city_welcomed") === null);
  const [activeScenario, setActiveScenario] = useState<"recorded" | "clean" | "poisoned" | "noscope" | null>(null);

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const replay = useMission();
  const live = useLiveMission();
  const recorded = useRecordedMission();

  const mission = live.active
    ? live
    : recorded.playing || recorded.record
      ? {
          ...replay,
          ...recorded.view,
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

  // --- keyboard shortcut for command palette (Ctrl+K / Cmd+K) ----------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // --- runtime states ---------------------------------------------------

  const rawCityState = live.active
    ? live.rawState
    : recorded.playing || recorded.record
      ? recorded.state
      : initialLiveCityState;

  const runtimeStates = useMemo(
    () => buildingStates(rawCityState, mission.offices),
    [rawCityState, mission.offices],
  );

  const scene: SceneState = useMemo(
    () => ({
      online: mission.online,
      granted: mission.granted,
      proposed: preview ? [...mission.granted, ...preview.districts] : mission.granted,
      offices: mission.offices,
      figures: mission.figures,
      gates: mission.gate ? [mission.gate.office] : [],
      refusedAt: mission.refusedAt,
      scopeState: preview ? "proposed" : mission.scopeState,
      buildings: runtimeStates,
      selected: selectedOffice,
      phase: mission.phase === "drafting" ? 0 : 1,
      counterfactual: preview ?? undefined,
    }),
    [
      mission.online,
      mission.granted,
      mission.offices,
      mission.figures,
      mission.gate,
      mission.refusedAt,
      mission.scopeState,
      runtimeStates,
      selectedOffice,
      mission.phase,
      preview,
    ],
  );

  // --- the render loop --------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

  const toWorld = useCallback(
    (clientX: number, clientY: number) => ({
      x: (clientX - size.width / 2 - camera.x) / camera.zoom,
      y: (clientY - size.height / 2 - camera.y) / camera.zoom,
    }),
    [camera, size],
  );

  const focusOn = useCallback(
    (u: number, v: number) => {
      const p = toScreen(u, v, 0);
      setCamera({
        x: -p.x * 1.5,
        y: -p.y * 1.5,
        zoom: 1.5,
      });
    },
    [],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const start = dragRef.current;
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          moved: start.moved || Math.abs(dx) + Math.abs(dy) > 3,
        };
        setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
        setHoverInfo(null);
        return;
      }

      // Hover calculation when not dragging
      const world = toWorld(e.clientX, e.clientY);
      const { building, cell } = pickBuilding(layOutCity(mission.offices), world.x, world.y);

      if (isMeaningful(building) && building.office) {
        const office = building.office;
        const state = runtimeStates.get(office);
        setHoverInfo({
          title: office,
          subtitle: `District: ${building.district}`,
          badge: state ? state.authority : undefined,
          screenX: e.clientX,
          screenY: e.clientY,
        });
        return;
      }

      const plot = DISTRICT_PLOTS.find(
        (p) => cell.u >= p.u0 && cell.u <= p.u1 && cell.v >= p.v0 && cell.v <= p.v1,
      );

      if (plot) {
        const inScope = mission.granted.includes(plot.id);
        setHoverInfo({
          title: plot.title,
          subtitle: `District plot (${plot.id})`,
          badge: inScope ? "IN SCOPE" : "FOGGED",
          screenX: e.clientX,
          screenY: e.clientY,
        });
        return;
      }

      setHoverInfo(null);
    },
    [toWorld, mission.offices, mission.granted, runtimeStates],
  );

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
    setHoverInfo(null);
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
    setFlashActive(true);
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

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const world = toWorld(e.clientX, e.clientY);
      const { building, cell } = pickBuilding(layOutCity(mission.offices), world.x, world.y);

      if (isMeaningful(building)) {
        soundEngine.playClick();
        setSelectedOffice(building.office);
        mission.inspect(building.district);
        return;
      }

      setSelectedOffice(null);
      const plot = DISTRICT_PLOTS.find(
        (p) => cell.u >= p.u0 && cell.u <= p.u1 && cell.v >= p.v0 && cell.v <= p.v1,
      );
      if (plot) {
        soundEngine.playClick();
      }
      mission.inspect(plot?.id ?? null);
    },
    [toWorld, mission],
  );

  // --- command palette items --------------------------------------------

  const commandItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // Districts
    for (const plot of DISTRICT_PLOTS) {
      items.push({
        id: `district-${plot.id}`,
        title: plot.title,
        category: "Districts",
        detail: `District plot (${plot.id})`,
        onSelect: () => {
          focusOn(plot.landmark.u, plot.landmark.v);
          mission.inspect(plot.id);
        },
      });
    }

    // Offices
    for (const entry of mission.offices) {
      const state = runtimeStates.get(entry.office);
      items.push({
        id: `office-${entry.office}`,
        title: entry.office,
        category: "Offices",
        detail: `District: ${entry.district} \u2022 ${state?.authority ?? "outside scope"}`,
        onSelect: () => {
          setSelectedOffice(entry.office);
          mission.inspect(entry.district);
          const plot = plotFor(entry.district);
          if (plot) focusOn(plot.landmark.u, plot.landmark.v);
        },
      });
    }

    // Actions & Replays
    items.push(
      {
        id: "action-snapshot",
        title: "Take City Snapshot",
        category: "Actions",
        detail: "Export a high-res PNG map",
        onSelect: takeSnapshot,
      },
      {
        id: "action-reset-camera",
        title: "Reset View",
        category: "Actions",
        detail: "Fit the entire city island on screen",
        onSelect: () => setCamera(fitCamera(size)),
      },
      {
        id: "replay-recorded",
        title: "Replay Verified Live Run",
        category: "Replays",
        detail: "Refund order #184 with hash-chain verification",
        onSelect: () => void recorded.play(RECORDING_URL),
      },
      {
        id: "replay-poisoned",
        title: "Replay Poisoned Ticket",
        category: "Replays",
        detail: "Demonstrate prompt injection hitting absent tool limits",
        onSelect: replay.runPoisonedTicket,
      },
      {
        id: "replay-clean",
        title: "Replay Clean Job",
        category: "Replays",
        detail: "Legitimate support refund inside bounds",
        onSelect: replay.runCleanJob,
      },
      {
        id: "replay-noscope",
        title: "Replay No Scope Failure",
        category: "Replays",
        detail: "Demonstrate immediate refusal when ungranted",
        onSelect: replay.runNoScope,
      },
    );

    return items;
  }, [mission.offices, runtimeStates, focusOn, mission, takeSnapshot, size, recorded, replay]);

  const handleIntroChoice = (option: "recorded" | "clean" | "poisoned" | "explore") => {
    setIntroOpen(false);
    if (typeof window !== "undefined") {
      writeSetting("scope_city_welcomed", "true");
    }
    setActiveScenario(option === "explore" ? null : option);
    if (option === "recorded") {
      void recorded.play(RECORDING_URL);
    } else if (option === "clean") {
      replay.runCleanJob();
    } else if (option === "poisoned") {
      replay.runPoisonedTicket();
    } else if (option === "explore") {
      setCamera(fitCamera(size));
    }
  };

  const handleSelectScenario = (scenario: "recorded" | "clean" | "poisoned" | "noscope") => {
    setActiveScenario(scenario);
    if (scenario === "recorded") {
      void recorded.play(RECORDING_URL);
    } else if (scenario === "clean") {
      replay.runCleanJob();
    } else if (scenario === "poisoned") {
      replay.runPoisonedTicket();
    } else if (scenario === "noscope") {
      replay.runNoScope();
    }
  };

  const zoomIn = () => setCamera((c) => ({ ...c, zoom: Math.min(3, c.zoom * 1.25) }));
  const zoomOut = () => setCamera((c) => ({ ...c, zoom: Math.max(0.35, c.zoom * 0.8) }));
  const followAgent = () => {
    if (mission.figures.length > 0) {
      const fig = mission.figures[0];
      if (fig) focusOn(fig.u, fig.v);
    }
  };

  return (
    <>
      <div className="hud-vignette" aria-hidden="true" />
      <div className="hud-scanline" aria-hidden="true" />
      <ShutterFlash active={flashActive} onComplete={() => setFlashActive(false)} />
      <HoverTooltip info={hoverInfo} />

      <TopNav
        connection={live.connection}
        activeScenario={activeScenario}
        onSelectScenario={handleSelectScenario}
        onOpenCommand={() => setCmdOpen(true)}
        onOpenIntro={() => setIntroOpen(true)}
        onTakeSnapshot={takeSnapshot}
        onResetView={() => setCamera(fitCamera(size))}
      />

      <IntroDialogue
        open={introOpen}
        onDismiss={() => {
          if (typeof window !== "undefined") {
            writeSetting("scope_city_welcomed", "true");
          }
          setIntroOpen(false);
        }}
        onSelectOption={handleIntroChoice}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        items={commandItems}
      />

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

      <MapControls
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetView={() => setCamera(fitCamera(size))}
        onFollowAgent={followAgent}
        hasAgent={mission.figures.length > 0}
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
            onOpenCommand={() => setCmdOpen(true)}
            onResetView={() => setCamera(fitCamera(size))}
            verification={mission.verification}
          />
        </div>
      </div>
    </>
  );
}

export function districtCell(district: string): Figure | null {
  const plot = plotFor(district);
  if (!plot) return null;
  return { id: district, u: plot.landmark.u, v: plot.landmark.v, kind: "agent" };
}
