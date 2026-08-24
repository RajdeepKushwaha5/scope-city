import { Window } from "./Window.js";
import type { GateRequest } from "../useMission.js";

/**
 * The one moment the interface raises its voice.
 *
 * The exact call is shown verbatim, because this is what the operator is being
 * asked to authorise and a summary would be a different thing from what runs.
 * The countersign is bound to this exact call downstream, so what is printed
 * here is precisely what may execute.
 */
export function GatePanel(props: {
  gate: GateRequest;
  onApprove: () => void;
  onDeny: () => void;
}): React.JSX.Element {
  const { gate } = props;

  return (
    <Window title="THE GATE" tone="gate" collapsible={false}
      right={<span style={{ color: "var(--danger)" }}>HELD</span>}>
      <div style={{ color: "var(--danger)" }}>Irreversible. Awaiting countersign.</div>

      <pre className="gate__call">
{gate.office}({Object.entries(gate.args)
  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  .join(", ")})
      </pre>

      <div style={{ color: "var(--ink-dim)", fontSize: 15 }}>
        Nothing has run. Refusing costs nothing.
      </div>

      <div className="gate__actions">
        <button className="btn btn--primary" onClick={props.onApprove}>
          Countersign
        </button>
        <button className="btn btn--danger" onClick={props.onDeny}>
          Refuse
        </button>
      </div>
    </Window>
  );
}
