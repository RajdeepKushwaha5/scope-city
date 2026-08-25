import { useState } from "react";
import type { BacktestReport } from "@scope-city/yard";
import type { CounterfactualView } from "../counterfactual-view.js";
import { Window } from "./Window.js";

/**
 * The moment the product exists for.
 *
 * Everything before this is derivation; everything after is enforcement. This
 * screen is the only place a human decides, and it is deliberately the only
 * path to a running agent: until Grant is pressed, no TrueForge session exists
 * and the proxy has never heard of this mission.
 *
 * The counterfactual sits here rather than in a panel of its own because a
 * "what if" is only useful next to the decision it changes. Asking what
 * `customer.list` would cost is idle curiosity on a granted scope and a real
 * question on a proposed one.
 */
export function ScopeReview(props: {
  scopeId: string;
  job: string;
  offices: readonly string[];
  resources: Readonly<Record<string, readonly string[]>>;
  maxAmountMinor: Readonly<Record<string, number>>;
  maxCalls: Readonly<Record<string, number>>;
  countersignRequired: readonly string[];
  expiresInMs: number;
  report: BacktestReport | null;
  candidates: readonly string[];
  onGrant: () => void;
  onDeny: () => void;
  onAsk: (office: string) => Promise<CounterfactualView | null>;
}): React.JSX.Element {
  const [asked, setAsked] = useState<CounterfactualView | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const ask = async (office: string): Promise<void> => {
    setAsking(office);
    setAsked(await props.onAsk(office));
    setAsking(null);
  };

  const blocking = props.report?.findings.filter((f) => f.severity !== "note") ?? [];

  return (
    <Window
      title="GRANT THE SCOPE"
      right={<span className="status-chip status-chip--reconnecting">
        <span className="status-chip__dot" />awaiting you
      </span>}
    >
      <div className="review__job">{props.job}</div>
      <div className="review__meta">
        {props.scopeId} · expires {Math.round(props.expiresInMs / 60000)} min after granting
      </div>

      <div className="review__section">
        <span className="hud-label">Offices</span>
        {props.offices.map((office) => (
          <div key={office} className="review__row">
            <span className="review__office">{office}</span>
            <span className="review__limits">
              {props.maxAmountMinor[office] !== undefined
                ? `≤ ${props.maxAmountMinor[office]} minor `
                : ""}
              {props.maxCalls[office] !== undefined ? `× ${props.maxCalls[office]} ` : ""}
              {props.countersignRequired.includes(office) ? "· countersign" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="review__section">
        {/* Spelled out because "one charge" and "every charge" look identical
            in a summary, and the whole claim is that the operator can see the
            difference before agreeing to it. */}
        <span className="hud-label">Exactly these records</span>
        {Object.entries(props.resources).map(([cls, ids]) => (
          <div key={cls} className="review__row">
            <span className="review__office">{cls}</span>
            <span className="review__limits">{ids.join(", ")}</span>
          </div>
        ))}
      </div>

      {blocking.length > 0 ? (
        <div className="review__findings">
          <span className="hud-label">The Yard found</span>
          {blocking.map((f, i) => (
            <div key={i} className={`review__finding review__finding--${f.severity}`}>
              {f.summary}
            </div>
          ))}
        </div>
      ) : (
        <div className="review__clean">
          The Yard ran {props.report?.probesRun ?? 0} probes and found no holes.
        </div>
      )}

      <div className="review__section">
        <span className="hud-label">What if you also allowed…</span>
        <div className="review__candidates">
          {props.candidates.map((office) => (
            <button
              key={office}
              className="btn"
              disabled={asking !== null}
              onClick={() => void ask(office)}
            >
              + {office}
            </button>
          ))}
        </div>

        {asked ? (
          <div className="review__cf">
            <div className="review__cf-summary">{asked.summary}</div>
            <div className="review__cf-delta">
              offices {asked.before.offices}→{asked.after.offices} · fields{" "}
              {asked.before.exposedFields}→{asked.after.exposedFields} · chained paths{" "}
              {asked.before.chainedPaths}→{asked.after.chainedPaths}
            </div>
            {asked.newFindings.map((f, i) => (
              <div key={i} className={`review__finding review__finding--${f.severity}`}>
                {f.summary}
              </div>
            ))}
            <button className="btn review__cf-clear" onClick={() => setAsked(null)}>
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="review__actions">
        <button className="btn btn--primary" onClick={props.onGrant}>
          Grant
        </button>
        <button className="btn btn--danger" onClick={props.onDeny}>
          Deny
        </button>
      </div>
      <p className="review__hint">
        Nothing is running yet. No session exists and the proxy has never heard of this mission.
      </p>
    </Window>
  );
}
