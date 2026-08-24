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
  gate: GateRequest | null;
  pendingGateCount: number;
  onApprove: () => void;
  onDeny: () => void;
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
    </Window>
  );
}
