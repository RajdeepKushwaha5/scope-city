import { Meter, Stat, Window } from "./Window.js";

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
  sandboxOpen: boolean;
  expiresIn: number | null;
}): React.JSX.Element {
  const total = 10 * 60 * 1000;
  const remaining = props.expiresIn ?? 0;

  return (
    <Window title="CITY CONSOLE" right={<span style={{ color: "var(--accent)" }}>LIVE</span>}>
      <div className="big" style={{ color: "var(--accent)" }}>
        {PHASE_LABEL[props.phase] ?? props.phase.toUpperCase()}
      </div>
      <div style={{ color: "var(--ink-dim)", marginBottom: 10 }}>{props.job}</div>

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
    </Window>
  );
}
