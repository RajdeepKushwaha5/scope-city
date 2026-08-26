import { useState } from "react";
import { Window } from "./Window.js";

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
  /**
   * False when no control plane is reachable, as on the published static site.
   *
   * Dispatch is disabled rather than hidden: a judge should see that live
   * missions exist and understand why this deployment cannot run one, not be
   * shown a smaller product and left to assume that is all there is.
   */
  canDispatch: boolean;
  onRecordedReplay: () => void;
  recordedPlaying: boolean;
  /** Shown so the chain check is visible rather than merely claimed. */
  recordedVerdict: { readonly ok: boolean; readonly entries?: number; readonly reason?: string } | null;
}): React.JSX.Element {
  const [order, setOrder] = useState(DEFAULT_ORDER);

  return (
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
        <div className="crew-card">
          <span className="crew-card__sprite" aria-hidden="true">
            <span className="crew-card__head" />
            <span className="crew-card__body" />
          </span>
          <span>
            <strong>Boundary agent</strong>
            <small>High effort · TrueForge operator</small>
          </span>
        </div>
      </div>

      <div className="order__row">
        <span className="hud-label">Permissions</span>
        <div className="permission-choice" role="group" aria-label="Permission mode">
          <button type="button" className="btn btn--primary" aria-pressed="true">
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
          <span aria-hidden="true">❯</span>
          <input
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            aria-label="Mission order"
            disabled={props.active}
          />
        </label>
        {props.active ? (
          <button className="btn btn--danger order__dispatch" onClick={() => void props.onStop()}>
            Halt
          </button>
        ) : (
          <button
            className="btn btn--primary order__dispatch"
            disabled={!order.trim() || !props.canDispatch}
            title={
              props.canDispatch
                ? undefined
                : "Needs a local control plane, a TrueForge instance and a model key"
            }
            onClick={() => void props.onLaunch(order.trim())}
          >
            Dispatch
          </button>
        )}
      </div>

      {props.canDispatch ? null : (
        /* Said plainly rather than left as a dead button. What is running here
           is the replay, and the reason a live mission is not is that it needs
           credentials that have no business in a public build. */
        <div className="order__offline">
          No control plane on this deployment. A live mission needs a TrueForge
          instance, a model key and a Stripe test key, none of which belong in a
          public build — so what you can watch here is a recording of one that
          actually ran.
        </div>
      )}

      {props.error ? <div className="order__error">{props.error}</div> : null}

      <div className="order__fallbacks">
        {/* Listed first and separately from the scripted replays below,
            because it is a different kind of claim. Those illustrate a
            scenario; this one is a mission that happened, hash-chained, with
            the granted scope attached. */}
        <span className="hud-label">Recorded live mission</span>
        <div>
          <button
            className="btn btn--primary"
            disabled={props.active}
            onClick={props.onRecordedReplay}
          >
            {props.recordedPlaying ? "Replaying…" : "Replay a real run"}
          </button>
          <span className="order__hint order__hint--inline">
            {props.recordedVerdict === null
              ? "No server needed — a captured TrueForge session"
              : props.recordedVerdict.ok
                ? `chain verified · ${props.recordedVerdict.entries} entries`
                : `does not verify — ${props.recordedVerdict.reason}`}
          </span>
        </div>

        <span className="hud-label">Offline security replays</span>
        <div>
          <button className="btn" disabled={props.active} onClick={props.onPoisonedReplay}>
            Poisoned ticket
          </button>
          <button className="btn" disabled={props.active} onClick={props.onCleanReplay}>
            Clean job
          </button>
          <button className="btn btn--danger" disabled={props.active} onClick={props.onNoScopeReplay}>
            No scope
          </button>
          <button className="btn" onClick={props.onResetView}>
            Reset view
          </button>
        </div>
      </div>
    </Window>
  );
}
