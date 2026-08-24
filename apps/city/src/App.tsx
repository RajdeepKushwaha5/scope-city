import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./hud/hud.css";
import { pickCell } from "./iso/projection.js";
import { drawScene, fitCamera, type Figure, type SceneState } from "./render/scene.js";
import { DISTRICT_PLOTS, plotFor } from "./render/world.js";
import { CityConsole } from "./hud/CityConsole.js";
import { ScopePanel } from "./hud/ScopePanel.js";
import { GatePanel } from "./hud/GatePanel.js";
import { RecordPanel } from "./hud/RecordPanel.js";
import { DistrictScan } from "./hud/DistrictScan.js";
import { useMission, type LogLine } from "./useMission.js";

/**
 * The city.
 *
 * The canvas draws the world and the HUD windows float over it. Everything the
 * HUD shows comes from the same mission state the canvas renders, so the two
 * can never disagree about what the agent is doing -- which matters, because
 * the whole point of the interface is that you can trust what you are looking
 * at.
 */
export function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const mission = useMission();

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

  const scene: SceneState = useMemo(
    () => ({
      online: mission.online,
      granted: mission.granted,
      offices: mission.offices,
      figures: mission.figures,
      gates: mission.gateDistricts,
      refusedAt: mission.refusedAt,
      scopeState: mission.scopeState,
    }),
    [mission],
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
    dragRef.current = { x: e.clientX - 0, y: e.clientY - 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    setCamera((c) => ({
      ...c,
      zoom: Math.min(3, Math.max(0.35, c.zoom * (e.deltaY > 0 ? 0.9 : 1.1))),
    }));
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current) return;
      const cell = pickCell(
        (e.clientX - size.width / 2 - camera.x) / camera.zoom,
        (e.clientY - size.height / 2 - camera.y) / camera.zoom,
      );
      const plot = DISTRICT_PLOTS.find(
        (p) => cell.u >= p.u0 && cell.u <= p.u1 && cell.v >= p.v0 && cell.v <= p.v1,
      );
      mission.inspect(plot?.id ?? null);
    },
    [camera, size, mission],
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
        onWheel={onWheel}
        onClick={onClick}
      />

      <div className="hud">
        <div style={{ gridColumn: 1, gridRow: 1, display: "grid", gap: 12 }}>
          <DistrictScan
            online={mission.online}
            granted={mission.granted}
            offices={mission.offices}
            inspecting={mission.inspecting}
          />
          <ScopePanel
            scope={mission.scope}
            scopeState={mission.scopeState}
            onPropose={mission.propose}
            onGrant={mission.grant}
            onDeny={mission.denyScope}
            onRevoke={mission.revoke}
          />
        </div>

        <div style={{ gridColumn: 1, gridRow: 3 }}>
          <RecordPanel lines={mission.log as LogLine[]} />
        </div>

        <div style={{ gridColumn: 3, gridRow: 1, display: "grid", gap: 12 }}>
          <CityConsole
            phase={mission.phase}
            job={mission.job}
            treasury={mission.treasury}
            fieldSize={mission.figures.length}
            sandboxOpen={mission.sandboxOpen}
            expiresIn={mission.expiresIn}
          />
          {mission.gate ? (
            <GatePanel
              gate={mission.gate}
              onApprove={() => mission.countersign(true)}
              onDeny={() => mission.countersign(false)}
            />
          ) : null}
        </div>

        <div style={{ gridColumn: 3, gridRow: 3, alignSelf: "end" }}>
          <div className="window">
            <div className="window__bar">
              <span>DEMO</span>
              <span className="window__rule" />
            </div>
            <div className="window__body">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn--primary" onClick={mission.runPoisonedTicket}>
                  Poisoned ticket
                </button>
                <button className="btn" onClick={mission.runCleanJob}>
                  Clean job
                </button>
                <button className="btn btn--danger" onClick={mission.runNoScope}>
                  No scope
                </button>
                <button className="btn" onClick={() => setCamera(fitCamera(size))}>
                  Reset view
                </button>
              </div>
            </div>
          </div>
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
