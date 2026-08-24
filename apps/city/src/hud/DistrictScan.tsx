import { Stat, Window } from "./Window.js";

/**
 * What the harness has actually connected.
 *
 * Districts appear here because an MCP server came online, not because someone
 * drew them -- so this panel is a readout of the world rather than a legend
 * for it.
 */
export function DistrictScan(props: {
  online: readonly string[];
  granted: readonly string[];
  offices: readonly { office: string; district: string }[];
  inspecting: string | null;
}): React.JSX.Element {
  const counts = new Map<string, number>();
  for (const entry of props.offices) {
    counts.set(entry.district, (counts.get(entry.district) ?? 0) + 1);
  }

  return (
    <Window title="DISTRICT SCAN" right={<span>{props.online.length} ONLINE</span>}>
      <div className="big">{props.offices.length}</div>
      <div style={{ color: "var(--ink-dim)", marginBottom: 8 }}>offices mapped</div>

      {props.online.length === 0 ? (
        <div className="empty">Waiting for MCP servers.</div>
      ) : (
        props.online.map((district) => (
          <Stat key={district} label={district}>
            <span
              style={{
                color: props.granted.includes(district) ? "var(--good)" : "var(--ink-dim)",
              }}
            >
              {counts.get(district) ?? 0} {props.granted.includes(district) ? "in scope" : "fogged"}
            </span>
          </Stat>
        ))
      )}

      {props.inspecting ? (
        <div style={{ marginTop: 8, color: "var(--accent)" }}>▸ {props.inspecting}</div>
      ) : null}
    </Window>
  );
}
