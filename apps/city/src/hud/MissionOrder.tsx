import { useState } from "react";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";
import {
  CrewModal,
  CREW_MEMBERS,
  crewSpriteUrl,
  effortLabel,
  type CrewId,
  type EffortLevel,
  type CrewMember,
} from "./CrewModal.js";

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
  canDispatch?: boolean;
  onRecordedReplay: () => void;
  recordedPlaying: boolean;
  recordedVerdict: { readonly ok: boolean; readonly entries?: number; readonly reason?: string } | null;
}): React.JSX.Element {
  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [crewOpen, setCrewOpen] = useState(false);
  const [crewMember, setCrewMember] = useState<CrewMember>(CREW_MEMBERS[1]!);
  const [thinkingEffort, setThinkingEffort] = useState<EffortLevel>("high");

  const canDispatch = props.canDispatch ?? true;

  return (
    <>
      <CrewModal
        open={crewOpen}
        selectedId={crewMember.id}
        thinkingLevel={thinkingEffort}
        onSelectSpecialist={(s) => setCrewMember(s)}
        onSelectThinking={(l) => setThinkingEffort(l)}
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
            title="Click to choose your specialist crew and thinking effort"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setCrewOpen(true);
            }}
          >
            <div className="crew-card__avatar-box">
              <img
                src={crewSpriteUrl(crewMember.id, thinkingEffort)}
                alt={crewMember.name}
                className="crew-card__avatar-img"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <strong>{crewMember.name}</strong>
                <span className="status-chip status-chip--tiny">
                  {crewMember.title}
                </span>
              </div>
              <small>
                {effortLabel(thinkingEffort)} effort &bull; {crewMember.model}
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
                void props.onLaunch(order.trim());
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
