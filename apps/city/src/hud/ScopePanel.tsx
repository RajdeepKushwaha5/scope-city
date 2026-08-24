import { Stat, Window } from "./Window.js";
import type { ScopeView } from "../useMission.js";

/**
 * The scope, as the operator reads it before granting.
 *
 * Dispositions are shown as three visibly different things rather than a list
 * with flags: allowed, gated, and blocked are different kinds of answer, and
 * an operator scanning this under time pressure should not have to read words
 * to tell them apart.
 */
export function ScopePanel(props: {
  scope: ScopeView | null;
  scopeState: "none" | "proposed" | "granted";
  onPropose: () => void;
  onGrant: () => void;
  onDeny: () => void;
  onRevoke: () => void;
}): React.JSX.Element {
  const { scope, scopeState } = props;

  return (
    <Window
      title="CITY LIMITS"
      right={
        <span style={{ color: scopeState === "granted" ? "var(--good)" : "var(--ink-dim)" }}>
          {scopeState.toUpperCase()}
        </span>
      }
    >
      {!scope ? (
        <>
          <div className="empty">No scope. Every office is unreachable.</div>
          <button className="btn btn--primary" onClick={props.onPropose} style={{ width: "100%" }}>
            Draft a scope
          </button>
        </>
      ) : (
        <>
          <Stat label="Scope">{scope.id}</Stat>

          <div style={{ margin: "8px 0 4px" }}>
            {scope.offices.map((entry) => (
              <span key={entry.office} className={`tag tag--${entry.disposition}`}>
                {entry.office}
              </span>
            ))}
          </div>

          <div style={{ color: "var(--ink-dim)", fontSize: 15, marginTop: 6 }}>
            {Object.entries(scope.resources).map(([cls, ids]) => (
              <div key={cls}>
                {cls}: {ids.join(", ")}
              </div>
            ))}
            {scope.limits.map((limit) => (
              <div key={limit}>{limit}</div>
            ))}
          </div>

          {scopeState === "proposed" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn--primary" onClick={props.onGrant}>
                Grant
              </button>
              <button className="btn btn--danger" onClick={props.onDeny}>
                Deny
              </button>
            </div>
          ) : null}

          {scopeState === "granted" ? (
            <button className="btn btn--danger" onClick={props.onRevoke} style={{ marginTop: 10 }}>
              Revoke
            </button>
          ) : null}
        </>
      )}
    </Window>
  );
}
