import { Stat, Window } from "./Window.js";
import { plotFor } from "../render/world.js";

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
  structureCount: number;
  dispositions: readonly { office: string; disposition: "allowed" | "gated" | "blocked" }[];
  inspecting: string | null;
}): React.JSX.Element {
  const counts = new Map<string, number>();
  const inspectedPlot = props.inspecting ? plotFor(props.inspecting) : undefined;
  const reachable = new Set(
    props.dispositions
      .filter((entry) => entry.disposition !== "blocked")
      .map((entry) => entry.office),
  );
  for (const entry of props.offices.filter((office) => reachable.has(office.office))) {
    counts.set(entry.district, (counts.get(entry.district) ?? 0) + 1);
  }

  return (
    <Window title="DISTRICT SCAN" right={<span>{props.online.length ? `${props.online.length} ONLINE` : "CITY READY"}</span>}>
      <div className="big">{props.structureCount}</div>
      <div style={{ color: "var(--ink-dim)", marginBottom: 8 }}>structures mapped</div>

      {props.online.length === 0 ? (
        <div className="empty">City fabric ready. Dispatch a mission to bring systems online.</div>
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
        <div className="district-selection">
          <strong>{inspectedPlot?.title ?? props.inspecting}</strong>
          <span>Selected district · inspect its live authority and traffic in the console.</span>
        </div>
      ) : null}
    </Window>
  );
}
