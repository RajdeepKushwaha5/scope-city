import { useState } from "react";
import { Meter, Stat, Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";
import type { GateRequest, LogLine } from "../useMission.js";
import { effortLabel, effortSpriteUrl, type EffortLevel } from "./CrewModal.js";

const PHASE_LABEL: Record<string, string> = {
  drafting: "DRAFTING",
  proposed: "AWAITING GRANT",
  running: "IN THE FIELD",
  awaiting_countersign: "HELD AT THE GATE",
  done: "COMPLETE",
  failed: "FAILED",
};

export function CityConsole(props: {
  phase: string;
  job: string;
  treasury: number | null;
  /** The crew on duty, so the portrait matches the one in the mission order. */
  effort: EffortLevel;
  fieldSize: number;
  structureCount: number;
  sandboxOpen: boolean;
  expiresIn: number | null;
  connection: "offline" | "connecting" | "live" | "reconnecting";
  lines: readonly LogLine[];
  /**
   * Null during an offline replay, which has neither a server-side record to
   * download nor a server-held scope to expire.
   */
  missionId: string | null;
  gate: GateRequest | null;
  pendingGateCount: number;
  onApprove: () => void;
  onDeny: () => void;
  onExpireNow: () => void;
  /**
   * The agent's working from the sandbox, when it ran one.
   *
   * Shown beside the gate rather than in the log, because an operator asked to
   * approve an irreversible transfer on the strength of a check they cannot
   * see is not really checking.
   */
  verification: {
    readonly script: string;
    readonly output: string;
    readonly passed: boolean;
  } | null;
  /** Absent in the scripted replays, which have nothing to explain. */
  onOpenIntro?: () => void;
  /** Opens the command palette, which is otherwise only a keystroke. */
  onOpenCommand?: () => void;
}): React.JSX.Element {
  const [sound, setSound] = useState(() => soundEngine.isEnabled());
  const total = 10 * 60 * 1000;
  const remaining = props.expiresIn ?? 0;

  return (
    <Window
      title="Scope City"
      right={
        <>
          <span className={`status-chip status-chip--${props.connection}`}>
            <span className="status-chip__dot" />
            {props.connection}
          </span>
          {/*
            * The two controls that had nowhere else to live.
            *
            * A full-width bar used to carry these, and everything else on it
            * was a second copy of a control that already existed in a panel or
            * the palette. These two were the exceptions, so they moved into
            * the title bar of the window that already names the city.
            */}
          <button
            type="button"
            className={`window__icon${sound ? "" : " window__icon--off"}`}
            aria-label={sound ? "Mute" : "Unmute"}
            title={sound ? "Mute" : "Unmute"}
            onClick={() => {
              const next = soundEngine.toggle();
              setSound(next);
              if (next) soundEngine.playClick();
            }}
          >
            {/* One glyph in both states, struck through when muted. It was
                a play triangle and a cross, and a cross in the corner of a
                panel is the control that closes it -- so the first icon in the
                title bar read as "close the console". */}
            {"♪"}
          </button>
          {props.onOpenCommand ? (
            <button
              type="button"
              className="window__icon"
              aria-label="Open the command palette"
              title="Command palette (Ctrl+K)"
              onClick={() => {
                soundEngine.playClick();
                props.onOpenCommand?.();
              }}
            >
              {"⌘"}
            </button>
          ) : null}
          {props.onOpenIntro ? (
            <button
              type="button"
              className="window__icon"
              aria-label="What am I looking at?"
              title="What am I looking at?"
              onClick={() => {
                soundEngine.playClick();
                props.onOpenIntro?.();
              }}
            >
              ?
            </button>
          ) : null}
        </>
      }
    >
      <div className="console__masthead">
        <div className="console__name">SCOPE CITY</div>
        <div className="console__branch">MAIN CITY · OPERATOR CONSOLE</div>
      </div>

      <div className="console__crew">
        {/*
          * The same sprite the mission order shows, rather than two absolutely
          * positioned boxes approximating a person.
          *
          * There has been artwork for the crew in `public/crew` all along and
          * this panel did not use it: it drew a 10x9px tan rectangle for a head
          * and a 14x15px blue one for a body, which is why the console appeared
          * to be missing its portrait. It was not missing -- it was a
          * placeholder that outlived the asset it was standing in for.
          *
          * Keyed off the same effort the operator picked, so the two panels
          * cannot show different crews.
          */}
        <span className="console__portrait">
          <img className="console__portrait-img" src={effortSpriteUrl(props.effort)} alt="" />
        </span>
        <div>
          <span className="hud-label">Crew on duty</span>
          <strong>Boundary agent</strong>
          <small>
            {effortLabel(props.effort)} effort &middot;{" "}
            {PHASE_LABEL[props.phase] ?? props.phase.toUpperCase()}
          </small>
        </div>
      </div>

      <div className="console__job">{props.job}</div>

      <Stat label="In the field">{props.fieldSize || "—"}</Stat>
      <Stat label="The Yard">{props.sandboxOpen ? "open" : "closed"}</Stat>
      {/* Named for what it is. "Treasury" reads as a balance you draw down;
          this is what the model has cost. And an em dash where nothing is
          measuring it, rather than a zero that looks like a reading. */}
      <Stat label="Model spend">
        {props.treasury === null ? "not metered" : `$${props.treasury.toFixed(4)}`}
      </Stat>

      {props.expiresIn === null ? null : (
        <div style={{ marginTop: 10 }}>
          <Stat label="Scope expires in">
            {Math.floor(remaining / 60000)}:
            {String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}
          </Stat>
          <Meter
            value={remaining / total}
            tone={remaining < total * 0.2 ? "bad" : remaining < total * 0.5 ? "warn" : "good"}
          />
          {props.missionId ? (
            /* Closes the limits now rather than waiting out the lease on
               camera. The server expires the scope through the same path its
               timer uses, so what follows is the real refusal. */
            <button className="btn console__expire" type="button" onClick={props.onExpireNow}>
              Close the limits now
            </button>
          ) : null}
        </div>
      )}

      {props.gate && props.verification ? (
        /* The working, next to the decision it justifies.
           An operator asked to approve an irreversible transfer on the strength
           of a check they cannot see is not really checking. */
        <div className={`proof proof--${props.verification.passed ? "pass" : "fail"}`}>
          <div className="proof__head">
            <span>Daytona sandbox</span>
            <span className="proof__verdict">
              {props.verification.passed ? "verified" : "check failed"}
            </span>
          </div>
          {props.verification.script ? (
            <pre className="proof__script">{props.verification.script.slice(0, 600)}</pre>
          ) : null}
          <pre className="proof__output">{props.verification.output.slice(0, 400)}</pre>
        </div>
      ) : null}

      {props.gate ? (
        <div className="console__permit">
          <div className="console__permit-title">
            <span>⚠ Permit · {props.gate.office}</span>
            <span>HELD{props.pendingGateCount ? ` · ${props.pendingGateCount} QUEUED` : ""}</span>
          </div>
          <pre className="gate__call">
{props.gate.office}({Object.entries(props.gate.args)
  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  .join(", ")})
          </pre>
          <div className="gate__actions">
            <button className="btn btn--primary" onClick={props.onApprove}>Countersign</button>
            <button className="btn btn--danger" onClick={props.onDeny}>Refuse</button>
          </div>
        </div>
      ) : null}

      <div className="console__radio">
        <div className="console__section-title">
          <span>Transmissions</span>
          <span>{props.lines.length}</span>
        </div>
        {props.lines.length === 0 ? (
          <div className="empty">The radio is quiet.</div>
        ) : (
          <div className="log">
            {/*
              * Newest first, reversed here rather than in the stylesheet.
              *
              * Entries are appended, so the array runs oldest to newest. Doing
              * the flip in the DOM means the newest line is the first child and
              * an untouched scroller is already showing it; doing it with
              * `column-reverse` instead leaves the container anchored at the
              * far end of the flex flow, which is the oldest.
              */}
            {/*
              * Keyed by where the line sits in the source array, not by where
              * it lands after the flip.
              *
              * The source is append-only, so an entry's original index never
              * changes. Its reversed index changes on every append -- so keying
              * on that gave every row a new key each time a line arrived, and
              * React tore down and rebuilt the whole log instead of adding one
              * node. The cost grew with the mission, and anything living in the
              * DOM, a text selection included, went with it.
              */}
            {props.lines
              .map((line, index) => [line, index] as const)
              .reverse()
              .map(([line, index]) => (
                <div key={`${line.at}-${index}`} className={`log__line log__line--${line.kind}`}>
                  <span className="log__at">{line.at}</span>
                  <span className="log__what">{line.what}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="console__footer">
        <span>Permits · operator</span>
        <span>{props.structureCount} structures</span>
      </div>

      {/* The record, and a way to take it away.
          Not a convenience: a mission that stops when the tab closes has
          produced no evidence, and "what was the agent actually able to touch"
          is the question nobody can answer after an incident. A plain link
          rather than a fetch-and-blob, so the browser saves the same bytes the
          server verified with nothing in between to reshape them. */}
      {props.missionId ? (
        <div className="record__footer">
          <a
            className="btn record__download"
            href={`/api/missions/${props.missionId}/record`}
            download
          >
            Download the record
          </a>
          <span className="record__hint">Hash-chained · includes the granted scope</span>
        </div>
      ) : null}
    </Window>
  );
}
