import { useState } from "react";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";
import {
  CrewModal,
  effortLabel,
  effortSpriteUrl,
  type EffortLevel,
} from "./CrewModal.js";

const DEFAULT_ORDER = "Refund order #184 and notify its owner";

export function MissionOrder(props: {
  active: boolean;
  connection: "offline" | "connecting" | "live" | "reconnecting";
  error: string | null;
  onLaunch: (order: string, effort: EffortLevel) => Promise<void>;
  onStop: () => Promise<void>;
  onPoisonedReplay: () => void;
  onCleanReplay: () => void;
  onNoScopeReplay: () => void;
  onResetView: () => void;
  canDispatch?: boolean;
  onRecordedReplay: () => void;
  recordedPlaying: boolean;
  recordedVerdict: { readonly ok: boolean; readonly entries?: number; readonly reason?: string } | null;
}): React.JSX.Element {
  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [crewOpen, setCrewOpen] = useState(false);
  // Medium rather than high. The default is what most runs will use, and high
  // effort is the first thing to exhaust a free-tier key mid-mission.
  const [thinkingEffort, setThinkingEffort] = useState<EffortLevel>("medium");

  const canDispatch = props.canDispatch ?? true;

  return (
    <>
      <CrewModal
        open={crewOpen}
        selected={thinkingEffort}
        onSelect={(level) => setThinkingEffort(level)}
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
          <span className="hud-label">Effort</span>
          {/* A real button rather than a div wearing role="button". The
              synthetic version had to reimplement Enter and Space by hand and
              still missed the parts a button gets for free. */}
          {/* Locked once the mission is running.
              The effort travelled with the dispatch, so letting it change
              afterwards would leave this panel reporting a setting the run in
              flight was never given -- the same gap between stated and actual
              that removing the model picker was about. Disabled rather than
              hidden, so the operator can still read what was used. */}
          <button
            type="button"
            className={`crew-card${props.active ? " crew-card--locked" : " crew-card--clickable"}`}
            disabled={props.active}
            onClick={() => {
              soundEngine.playClick();
              setCrewOpen(true);
            }}
            title={
              props.active
                ? "Set when this mission was dispatched"
                : "Choose how hard the model thinks on this mission"
            }
          >
            <div className="crew-card__avatar-box">
              <img
                src={effortSpriteUrl(thinkingEffort)}
                alt=""
                className="crew-card__avatar-img"
              />
            </div>
            <div className="crew-card__detail">
              <strong>
                {effortLabel(thinkingEffort)} effort{props.active ? " · in use" : ""}
              </strong>
              {/* The model is stated because it is fixed, and saying so is the
                  honest version of the picker this replaced. */}
              <small>gemini-2.5-flash &bull; 4 rotating keys</small>
            </div>
            <span className="crew-card__edit-btn">&#9998; Change</span>
          </button>
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
              placeholder="What should the crew build?"
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
              disabled={!order.trim() || !canDispatch}
              title={
                canDispatch
                  ? undefined
                  : "Needs a local control plane, a TrueForge instance and a model key"
              }
              onClick={() => {
                soundEngine.playClick();
                void props.onLaunch(order.trim(), thinkingEffort);
              }}
            >
              Dispatch
            </button>
          )}
        </div>

        {canDispatch ? null : (
          <div className="order__offline">
            No control plane on this deployment. A live mission needs a TrueForge
            instance, a model key and a Stripe test key.
          </div>
        )}

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
                ? "No server needed \u2022 a captured TrueForge session"
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
