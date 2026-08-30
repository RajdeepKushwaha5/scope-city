import { useState } from "react";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";
import {
  CrewModal,
  effortLabel,
  EffortGauge,
  type EffortLevel,
} from "./CrewModal.js";

const DEFAULT_ORDER = "Refund order #184 and notify its owner";

/**
 * One line naming the models a mission will actually run on.
 *
 * Three states, and they are three different sentences. Null is "nobody to
 * ask" -- the deployed city has no control plane, so it cannot know and must
 * not claim. Empty is a real answer: a harness with only an opt-in model
 * registered discovers no rotation candidates, and a mission there will fail to
 * find one, which the operator should be told before they press Dispatch.
 */
export function modelSummary(models: readonly string[] | null | undefined): string {
  if (models === null || models === undefined) return "model set by the harness this connects to";
  if (models.length === 0) return "no models in rotation — dispatch will fail";
  if (models.length === 1) return `${models[0]} • one model`;
  return `${models.length} models in rotation • ${models[0]} and ${models.length - 1} more`;
}

export function MissionOrder(props: {
  active: boolean;
  connection: "offline" | "connecting" | "live" | "reconnecting";
  error: string | null;
  onLaunch: (order: string, effort: EffortLevel) => Promise<void>;
  /**
   * The models the control plane says it will rotate over, or null when there
   * is nobody to ask -- a static deployment, or a server that does not report
   * them. Null and empty are different: a machine with only a local model
   * registered really does discover no rotation candidates.
   */
  models?: readonly string[] | null;
  /** Which crew is on duty, and how to change it. Owned by `App`. */
  effort: EffortLevel;
  onEffort: (effort: EffortLevel) => void;
  /**
   * The form cannot be edited, but there may be no live mission to halt.
   *
   * Separate from `active`, and the separation is the point. Folding a replay
   * into `active` locked the form correctly and also swapped Dispatch for a
   * Halt button that calls `live.leave` -- with no live mission, an emergency
   * control that looks like it works and stops nothing. `active` still means
   * "a live mission is running"; this means "do not let anyone type".
   */
  locked?: boolean;
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

  /*
   * The crew is `App`'s now, not this panel's.
   *
   * It was local state here, and the console on the other side of the screen
   * drew its own portrait from a placeholder -- so the two panels could not
   * have agreed even in principle about who was on duty. Lifting it is the
   * smallest change that makes one answer, and the effort is a property of the
   * mission rather than of the form that starts it.
   */
  const thinkingEffort = props.effort;
  const setThinkingEffort = props.onEffort;

  const canDispatch = props.canDispatch ?? true;

  /*
   * Three states, not two, and collapsing them broke the demo.
   *
   * `active` is a live mission: everything closes, because a second dispatch
   * would run two missions at once and the replay buttons would swap the city
   * out from under one that is really happening.
   *
   * `locked` is a replay on screen. It closes the order and the crew, because
   * a live mission must not be launched on top of a replay -- but it must not
   * close the replay buttons themselves. They are how an operator leaves a
   * replay, and the demo is two scripted runs back to back.
   *
   * Folding the two together disabled every scenario button for the rest of the
   * session: the scoped run parks at the Gate awaiting a countersign, so the
   * lock never lifted and the second half of the comparison could not be
   * started without reloading the page.
   */
  const running = props.locked ?? false;
  const frozen = props.active || running;
  /** Closed only by a live mission. A replay is a thing you switch away from. */
  const switchingBlocked = props.active;

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
            className={`crew-card${frozen ? " crew-card--locked" : " crew-card--clickable"}`}
            disabled={frozen}
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
              <EffortGauge effort={thinkingEffort} className="crew-card__avatar-img" />
            </div>
            <div className="crew-card__detail">
              <strong>
                {effortLabel(thinkingEffort)} effort{props.active ? " · in use" : ""}
              </strong>
              {/*
                * What is actually registered, not a string literal.
                *
                * This read "gemini-2.5-flash - 4 rotating keys" whatever the
                * server was running, and it was wrong in three separate ways at
                * once. Set fewer than four Gemini keys and the slots without
                * one are skipped, so the count was a guess. Set GEMINI_MODEL
                * and the model id was a guess. Point SCOPE_MODELS at the local
                * slot and both were -- the panel named a hosted model while a
                * Qwen on the operator's laptop did the work.
                *
                * A figure the interface asserts and does not measure is the
                * thing this project is an argument against, sitting in the
                * panel that dispatches the mission.
                */}
              <small title={props.models?.join(", ") ?? undefined}>{modelSummary(props.models)}</small>
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
              disabled={frozen}
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
              /* `frozen` too. Every other control on this panel had it and
                 Dispatch did not, so with a control plane available an operator
                 could launch a live mission on top of a playing replay -- the
                 recording hidden, its timers still running underneath. */
              disabled={frozen || !order.trim() || !canDispatch}
              title={
                frozen
                  ? "A replay is playing"
                  : canDispatch
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
              disabled={switchingBlocked}
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

          {/*
            * The same ticket, twice, in the order that makes the point.
            *
            * These sat in a row of equals -- "Poisoned ticket", "Clean job",
            * "No scope" -- and a visitor pressed whichever was first, which
            * showed a mission succeeding. That is the least surprising thing
            * here. Run without the boundary first and the second run has
            * something to be different *from*; run it second and it is a
            * curiosity rather than the answer.
            */}
          <span className="hud-label">The same ticket, twice</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <button
              className="btn btn--danger"
              disabled={switchingBlocked}
              onClick={() => {
                soundEngine.playClick();
                props.onNoScopeReplay();
              }}
            >
              1 · Without a scope
            </button>
            <button
              className="btn"
              disabled={switchingBlocked}
              onClick={() => {
                soundEngine.playClick();
                props.onPoisonedReplay();
              }}
            >
              2 · With a scope
            </button>
            <button
              className="btn"
              disabled={switchingBlocked}
              onClick={() => {
                soundEngine.playClick();
                props.onCleanReplay();
              }}
            >
              Clean job
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
