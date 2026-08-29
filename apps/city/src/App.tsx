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
import { FieldPanel } from "./hud/FieldPanel.js";
import { YardPanel } from "./hud/YardPanel.js";
import { DistrictScan } from "./hud/DistrictScan.js";
import { GateBeacon } from "./hud/GateBeacon.js";
import { ScenarioBanner, type Scenario } from "./hud/ScenarioBanner.js";
import { placeTooltip } from "./hud/tooltip-placement.js";
import { MissionOrder } from "./hud/MissionOrder.js";
import { CitySnapshot } from "./hud/CitySnapshot.js";
import { MapControls } from "./hud/MapControls.js";
import { IntroDialogue } from "./hud/IntroDialogue.js";
import { CommandPalette, type CommandItem } from "./hud/CommandPalette.js";
import { ShutterFlash } from "./hud/ShutterFlash.js";
import { readSetting, writeSetting } from "./safe-storage.js";
import { useMission } from "./useMission.js";
import { useLiveMission } from "./useLiveMission.js";
import { useRecordedMission } from "./useRecordedMission.js";
import { useControlPlane } from "./use-control-plane.js";
import { toScreen } from "./iso/projection.js";
import { nextOfficeIndex } from "./map-keyboard.js";
import { aModalIsOpen, opensCommandPalette } from "./command-shortcut.js";

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
 *
 * Built from `BASE_URL` rather than written as `/replays/...`, because judge
 * mode is served from a subdirectory on GitHub Pages. A root-absolute path
 * resolves to the wrong host directory there, and the failure is a fetch that
 * 404s while the city renders perfectly around a replay button that does
 * nothing.
 */
const RECORDING_URL = `${import.meta.env.BASE_URL}replays/refund-184.json`;

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
  const [commandOpen, setCommandOpen] = useState(false);

  /*
   * Ctrl/Cmd+K, and it has to live here.
   *
   * The palette listens for Escape itself, but nothing listened for the
   * keystroke that opens it -- that was a button on the top bar, and removing
   * the bar took the only `setCommandOpen(true)` in the app with it. The
   * palette became unreachable, and with it the over-reach run, which has no
   * button of its own. There is a control for it in the console title bar too,
   * because a feature reachable only by a keystroke nobody mentioned is close
   * enough to absent.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The decision lives in `command-shortcut.ts` and is tested there. It
      // also declines while a dialogue is open: the palette renders above
      // everything, so it used to stack over the intro and the crew sheet with
      // both of their key handlers still bound underneath.
      if (!opensCommandPalette(event, aModalIsOpen())) return;
      // Only once we are taking it. The browser's own binding wins otherwise,
      // and a dialogue -- unlike the canvas -- has text worth searching.
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [flashing, setFlashing] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeScenario, setActiveScenario] =
    useState<Scenario | null>(null);

  // Read through the safe wrapper because this runs during the first render,
  // and a browser with storage blocked throws on the property access rather
  // than returning null -- which would white-screen the page before it drew
  // anything, on the one URL a judge opens.
  const [introOpen, setIntroOpen] = useState(() => readSetting("scope_city_welcomed") === null);
  const [hovered, setHovered] = useState<{ office: string; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<{ office: string; districts: readonly string[] } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const replay = useMission();
  const live = useLiveMission();
  const recorded = useRecordedMission();
  const controlPlane = useControlPlane();

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
  const officeBuildings = useMemo(
    () => cityFor(mission.offices).buildings.filter((building) => isMeaningful(building)),
    [mission.offices],
  );

  // --- canvas sizing ----------------------------------------------------

  useEffect(() => {
    const measure = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
      // The hover carries client coordinates captured when the pointer last
      // moved. A resize does not move the pointer, so those coordinates now
      // describe a position in the old viewport -- and the tooltip would be
      // placed from them against the new one, deciding which way to flip on
      // stale numbers. The pointer is somewhere else relative to the city now
      // anyway, so the honest state is no hover until it moves again.
      setHovered(null);
    };
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
  // Whichever mission is on screen. Deriving from the live state while a
  // recording played meant judge mode drew the idle live mission -- every
  // office "not in scope" -- beside a replay showing the opposite. Named once
  // now that two things read it, so they cannot pick different missions.
  const currentRaw = useMemo(
    () =>
      live.active
        ? live.rawState
        : recorded.playing || recorded.record
          ? recorded.state
          : replay.rawState,
    [live.active, live.rawState, recorded.playing, recorded.record, recorded.state, replay.rawState],
  );

  const runtimeStates = useMemo(
    () => buildingStates(currentRaw, mission.offices),
    [currentRaw, mission.offices],
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
      hovered: hovered?.office ?? null,
      counterfactual: preview,
    }),
    [mission, runtimeStates, selectedOffice, hovered, preview],
  );

  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedOffice(null);
      setHovered(null);
      mission.inspect(null);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [mission]);

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

  /** Canvas coordinates with the camera transform undone. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => ({
      x: (clientX - size.width / 2 - camera.x) / camera.zoom,
      y: (clientY - size.height / 2 - camera.y) / camera.zoom,
    }),
    [camera, size],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) {
      const world = toWorld(e.clientX, e.clientY);
      const { building } = pickBuilding(cityFor(mission.offices).buildings, world.x, world.y);
      setHovered(
        isMeaningful(building)
          ? { office: building.office!, x: e.clientX, y: e.clientY }
          : null,
      );
      return;
    }
    setHovered(null);
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: start.moved || Math.abs(dx) + Math.abs(dy) > 3,
    };
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, [mission.offices, toWorld]);

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

  const onPointerLeave = useCallback(() => {
    if (!dragRef.current) setHovered(null);
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
    // The shutter fires here or nowhere. A flash component that renders but is
    // never triggered is the same dead control as a button that does nothing --
    // it just fails silently instead of visibly.
    setFlashing(true);
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

  const focusBuilding = useCallback(
    (building: (typeof officeBuildings)[number]) => {
      const point = toScreen(building.cell.u, building.cell.v, building.height / 2);
      const zoom = Math.max(camera.zoom, 1.35);
      setSelectedOffice(building.office!);
      mission.inspect(building.district!);
      setCamera({ x: -point.x * zoom, y: -point.y * zoom, zoom });
    },
    [camera.zoom, mission],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const world = toWorld(e.clientX, e.clientY);
      const { building } = pickBuilding(cityFor(mission.offices).buildings, world.x, world.y);
      if (isMeaningful(building)) focusBuilding(building);
    },
    [focusBuilding, mission.offices, toWorld],
  );

  const onMapKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (officeBuildings.length === 0) return;
      const current = officeBuildings.findIndex((building) => building.office === selectedOffice);
      if ((event.key === "Enter" || event.key === " ") && current >= 0) {
        event.preventDefault();
        focusBuilding(officeBuildings[current]!);
        return;
      }

      const next = nextOfficeIndex(event.key, current, officeBuildings.length);
      if (next === null) {
        return;
      }

      event.preventDefault();
      const building = officeBuildings[next]!;
      setSelectedOffice(building.office!);
      setHovered(null);
      mission.inspect(building.district!);
    },
    [focusBuilding, mission, officeBuildings, selectedOffice],
  );

  const hoveredState = hovered ? runtimeStates.get(hovered.office) : null;
  // Flipped to the other side of the cursor near an edge, so a building at the
  // city limits does not describe itself off the screen.
  const tooltipAt = placeTooltip(hovered ?? { x: 0, y: 0 }, size);

  const dismissIntro = useCallback(() => {
    setIntroOpen(false);
    writeSetting("scope_city_welcomed", "true");
  }, []);

  /**
   * The four things a visitor can start, in one place.
   *
   * Every one of these already existed as a handler; the top nav and the intro
   * simply reach the same ones, so a scenario cannot behave differently
   * depending on which control started it.
   */
  const runScenario = useCallback(
    (scenario: Scenario) => {
      setActiveScenario(scenario);
      // A different run is a different claim about what is about to happen, so
      // dismissing one banner must not suppress the next.
      setBannerDismissed(false);
      if (scenario === "recorded") {
        void recorded.play(RECORDING_URL);
        return;
      }

      // Stop the recording before starting a scripted run.
      //
      // The city reads from the recorded player whenever it holds a record, so
      // starting a scripted scenario without clearing it left the previous
      // replay on screen while the new one ran underneath -- the operator
      // picked a run and watched a different one.
      recorded.stop();

      if (scenario === "clean") replay.runCleanJob();
      else if (scenario === "poisoned") replay.runPoisonedTicket();
      else if (scenario === "overreach") replay.runOverReach();
      else replay.runNoScope();
    },
    [recorded, replay],
  );

  const commandItems: readonly CommandItem[] = useMemo(
    () => [
      /*
       * The two halves of the argument, first and adjacent.
       *
       * These were two entries in a list of five, in the order they happened to
       * be written -- "No scope" last, described neutrally. They are not five
       * things. They are one experiment run twice: the same poisoned ticket,
       * once with a boundary and once without, and the difference between them
       * is the entire claim this project makes.
       *
       * Presented as equals, a visitor clicked whichever was first and watched
       * a mission succeed, which is the least surprising outcome here. Named as
       * a pair, the palette itself asks the question the demo answers.
       */
      {
        id: "noscope",
        title: "1 · Without a scope",
        category: "The comparison",
        detail: "The same ticket, and the agent obeys it. This is a normal integration.",
        onSelect: () => runScenario("noscope"),
      },
      {
        id: "poisoned",
        title: "2 · With a scope",
        category: "The comparison",
        detail: "The same ticket, refused at the city limits. Nothing was denied — it was absent.",
        onSelect: () => runScenario("poisoned"),
      },
      {
        id: "recorded",
        title: "Replay a real run",
        category: "Replays",
        detail: "A captured mission with a verified hash chain",
        onSelect: () => runScenario("recorded"),
      },
      {
        id: "clean",
        title: "Clean job",
        category: "Replays",
        detail: "Everything inside the scope",
        onSelect: () => runScenario("clean"),
      },
      {
        id: "overreach",
        title: "Over-reach found",
        category: "Replays",
        detail: "The Yard finds a gap before anything is granted",
        onSelect: () => runScenario("overreach"),
      },
      {
        id: "reset",
        title: "Reset view",
        category: "Actions",
        detail: "Fit the whole island",
        onSelect: () => setCamera(fitCamera(size)),
      },
      {
        id: "snapshot",
        title: "Take a snapshot",
        category: "Actions",
        detail: "Download the city as a PNG",
        onSelect: takeSnapshot,
      },
    ],
    [runScenario, size, takeSnapshot],
  );

  return (
    <>
      {/*
        * No bar across the top, so the city runs to the edge of the screen.
        *
        * There was one, and almost everything on it was a second copy of a
        * control that already existed: the scenario pills are in the mission
        * panel and the command palette, the snapshot is its own panel, the
        * city's name and connection are the console's own title bar, and
        * Ctrl+K opens the palette without a button to press. Two surfaces for
        * one control is how they drift -- the bar was still offering "Poisoned
        * Ticket" and "No Scope" after those runs had been renamed and paired
        * as one comparison, so a visitor could start the same run from two
        * places and be told two different things about it.
        *
        * What it cost was the top of the map, permanently, on every screen.
        */}
      <canvas
        ref={canvasRef}
        className="world"
        style={{ width: size.width, height: size.height, cursor: hovered ? "pointer" : "grab" }}
        tabIndex={0}
        aria-label={`Interactive Scope City map. Use arrow keys to inspect offices and Enter to focus.${selectedOffice ? ` Selected office: ${selectedOffice}.` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onMapKeyDown}
      />

      {hovered && hoveredState ? (
        <div
          className={`map-tooltip map-tooltip--${hoveredState.activity}`}
          style={{ left: tooltipAt.left, top: tooltipAt.top }}
          role="status"
        >
          <strong>{hovered.office}</strong>
          <span>{hoveredState.authority} · {hoveredState.activity}</span>
          <small>Click to inspect · double-click to focus</small>
        </div>
      ) : null}

      <MapControls
        onZoomIn={() => setCamera((c) => ({ ...c, zoom: Math.min(3, c.zoom * 1.2) }))}
        onZoomOut={() => setCamera((c) => ({ ...c, zoom: Math.max(0.35, c.zoom / 1.2) }))}
        onResetView={() => setCamera(fitCamera(size))}
      />

      <IntroDialogue
        open={introOpen}
        onDismiss={dismissIntro}
        onSelectOption={(option) => {
          dismissIntro();
          if (option !== "explore") runScenario(option);
        }}
      />

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={commandItems}
      />

      <ShutterFlash active={flashing} onComplete={() => setFlashing(false)} />

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
            <FieldPanel
              figures={mission.figures}
              threadWork={currentRaw.threadWork}
              threadTitles={currentRaw.threadTitles}
              scope={mission.scope}
            />
            <YardPanel report={mission.yard} />
          </div>

          <div className="hud__order">
            <MissionOrder
              active={live.active}
              connection={live.connection}
              error={live.error ?? recorded.error}
              /* Every path that starts a run goes through `runScenario`, or the
                 banner keeps describing whatever ran last. A live mission is
                 not one of the scripted scenarios, so it clears the billing
                 rather than inheriting it -- a banner promising a refusal over
                 a real run is worse than no banner. */
              onLaunch={async (order, effort) => {
                setActiveScenario(null);
                await live.launch(order, effort);
              }}
              onStop={live.leave}
              onPoisonedReplay={() => runScenario("poisoned")}
              onCleanReplay={() => runScenario("clean")}
              onNoScopeReplay={() => runScenario("noscope")}
              onResetView={() => setCamera(fitCamera(size))}
              onRecordedReplay={() => runScenario("recorded")}
              canDispatch={controlPlane === "available"}
              recordedPlaying={recorded.playing}
              recordedVerdict={recorded.verdict}
            />
          </div>
        </div>

        <ScenarioBanner
          scenario={bannerDismissed ? null : activeScenario}
          onDismiss={() => setBannerDismissed(true)}
        />

        <GateBeacon
          gate={mission.gate}
          offices={mission.offices}
          camera={camera}
          size={size}
        />

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
            onOpenIntro={() => setIntroOpen(true)}
            onOpenCommand={() => setCommandOpen(true)}
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
