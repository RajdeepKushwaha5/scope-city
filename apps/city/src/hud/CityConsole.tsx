import { Meter, Stat, Window } from "./Window.js";
import type { GateRequest, LogLine } from "../useMission.js";

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
  treasury: number;
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
}): React.JSX.Element {
  const total = 10 * 60 * 1000;
  const remaining = props.expiresIn ?? 0;

  return (
    <Window
      title="Scope City"
      right={
        <span className={`status-chip status-chip--${props.connection}`}>
          <span className="status-chip__dot" />
          {props.connection}
        </span>
      }
    >
      <div className="console__masthead">
        <div className="console__name">SCOPE CITY</div>
        <div className="console__branch">MAIN CITY · OPERATOR CONSOLE</div>
      </div>

      <div className="console__crew">
        <span className="console__portrait" aria-hidden="true">
          <span className="crew-card__head" />
          <span className="crew-card__body" />
        </span>
        <div>
          <span className="hud-label">Crew on duty</span>
          <strong>Boundary agent</strong>
          <small>{PHASE_LABEL[props.phase] ?? props.phase.toUpperCase()}</small>
        </div>
      </div>

      <div className="console__job">{props.job}</div>

      <Stat label="In the field">{props.fieldSize || "—"}</Stat>
      <Stat label="The Yard">{props.sandboxOpen ? "open" : "closed"}</Stat>
      <Stat label="Treasury">${props.treasury.toFixed(4)}</Stat>

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
            {props.lines.map((line, index) => (
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
