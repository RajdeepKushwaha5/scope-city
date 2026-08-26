import { useState } from "react";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";
import { CrewModal, CREW_SPECIALISTS, type CrewSpecialist } from "./CrewModal.js";

const DEFAULT_ORDER = "Refund order #184 and notify its owner";

export function MissionOrder(props: {
  active: boolean;
  connection: "offline" | "connecting" | "live" | "reconnecting";
  error: string | null;
  onLaunch: (order: string) => Promise<void>;
  onStop: () => Promise<void>;
  onPoisonedReplay: () => void;
  onCleanReplay: () => void;
  onNoScopeReplay: () => void;
  onResetView: () => void;
  onRecordedReplay: () => void;
  recordedPlaying: boolean;
  recordedVerdict: { readonly ok: boolean; readonly entries?: number; readonly reason?: string } | null;
}): React.JSX.Element {
  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [crewOpen, setCrewOpen] = useState(false);
  const [specialist, setSpecialist] = useState<CrewSpecialist>(CREW_SPECIALISTS[0]!);
  const [thinkingLevel, setThinkingLevel] = useState<"low" | "medium" | "high">("high");

  return (
    <>
      <CrewModal
        open={crewOpen}
        selectedId={specialist.id}
        thinkingLevel={thinkingLevel}
        onSelectSpecialist={(s) => setSpecialist(s)}
        onSelectThinking={(l) => setThinkingLevel(l)}
        onClose={() => setCrewOpen(false)}
      />

      <Window
        title="Mission order"
        right={
          <span className={`status-chip status-chip--${props.connection}`}>
            <span className="status-chip__dot" />
            {props.active ? props.connection : "ready"}
          </span>
        }
      >
        <div className="order__brief">
          {props.active
            ? "TrueForge is directing the crew. Irreversible work still needs your countersign."
            : "Define the job. Scope City grants only the systems, records, limits, and time it needs."}
        </div>

        <div className="order__row">
          <span className="hud-label">Crew</span>
          <div
            className="crew-card crew-card--clickable"
            onClick={() => {
              soundEngine.playClick();
              setCrewOpen(true);
            }}
            title="Click to switch TrueForge agent specialist & effort"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setCrewOpen(true);
            }}
          >
            <span
              className="crew-card__sprite"
              aria-hidden="true"
              style={{ borderColor: specialist.color }}
            >
              <span className="crew-card__head" style={{ background: specialist.color }} />
              <span className="crew-card__body" style={{ background: specialist.color }} />
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <strong>{specialist.name}</strong>
                <span className="status-chip status-chip--tiny">{specialist.badge}</span>
              </div>
              <small>
                {thinkingLevel.toUpperCase()} effort &bull; {specialist.model}
              </small>
            </div>
            <span className="crew-card__edit-btn">&#9998; Change</span>
          </div>
        </div>

        <div className="order__row">
          <span className="hud-label">Permissions</span>
          <div className="permission-choice" role="group" aria-label="Permission mode">
            <button
              type="button"
              className="btn btn--primary"
              aria-pressed="true"
              onClick={() => soundEngine.playClick()}
            >
              Ask operator
            </button>
            <button type="button" className="btn" disabled title="Unsafe actions always pause">
              Auto approve
            </button>
          </div>
        </div>

        <p className="order__hint">Default mode pauses at The Gate before every irreversible call.</p>

        <div className="order__command">
          <label className="command-field">
            <span aria-hidden="true">&gt;</span>
            <input
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              aria-label="Mission order"
              disabled={props.active}
              placeholder="Type a mission order..."
            />
          </label>
          {props.active ? (
            <button
              className="btn btn--danger order__dispatch"
              onClick={() => {
                soundEngine.playRefusal();
                void props.onStop();
              }}
            >
              Halt
            </button>
          ) : (
            <button
              className="btn btn--primary order__dispatch"
              disabled={!order.trim()}
              onClick={() => {
                soundEngine.playClick();
                void props.onLaunch(order.trim());
              }}
            >
              Dispatch
            </button>
          )}
        </div>

        {props.error ? <div className="order__error">{props.error}</div> : null}

        <div className="order__fallbacks">
          <span className="hud-label">Recorded live mission</span>
          <div>
            <button
              className="btn btn--primary"
              disabled={props.active}
              onClick={() => {
                soundEngine.playClick();
                props.onRecordedReplay();
              }}
            >
              {props.recordedPlaying ? "Replaying..." : "Replay a real run"}
            </button>
            <span className="order__hint order__hint--inline">
              {props.recordedVerdict === null
                ? "No server needed \u2022 captured TrueForge session"
                : props.recordedVerdict.ok
                  ? `chain verified \u2022 ${props.recordedVerdict.entries} entries`
                  : `does not verify \u2022 ${props.recordedVerdict.reason}`}
            </span>
          </div>

          <span className="hud-label">Offline security replays</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <button
              className="btn"
              disabled={props.active}
              onClick={() => {
                soundEngine.playClick();
                props.onPoisonedReplay();
              }}
            >
              Poisoned ticket
            </button>
            <button
              className="btn"
              disabled={props.active}
              onClick={() => {
                soundEngine.playClick();
                props.onCleanReplay();
              }}
            >
              Clean job
            </button>
            <button
              className="btn btn--danger"
              disabled={props.active}
              onClick={() => {
                soundEngine.playClick();
                props.onNoScopeReplay();
              }}
            >
              No scope
            </button>
            <button
              className="btn"
              onClick={() => {
                soundEngine.playClick();
                props.onResetView();
              }}
            >
              Reset view
            </button>
          </div>
        </div>
      </Window>
    </>
  );
}
