import { useState } from "react";
import type { BacktestReport } from "@scope-city/yard";
import type { CounterfactualView } from "../counterfactual-view.js";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";

/**
 * The moment the product exists for.
 *
 * Everything before this is derivation; everything after is enforcement. This
 * screen is the only place a human decides, and it is deliberately the only
 * path to a running agent: until Grant is pressed, no TrueForge session exists
 * and the proxy has never heard of this mission.
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
  /** Draws the annexation on the map while a candidate is being considered. */
  onPreview: (preview: { office: string; districts: readonly string[] } | null) => void;
}): React.JSX.Element {
  const [asked, setAsked] = useState<CounterfactualView | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const ask = async (office: string): Promise<void> => {
    soundEngine.playClick();
    setAsking(office);
    const answer = await props.onAsk(office);
    setAsked(answer);
    setAsking(null);
    props.onPreview(answer ? { office, districts: answer.newDistricts } : null);
  };

  const clear = (): void => {
    soundEngine.playClick();
    setAsked(null);
    props.onPreview(null);
  };

  const blocking = props.report?.findings.filter((f) => f.severity !== "note") ?? [];

  return (
    <Window
      title="GRANT THE SCOPE"
      right={
        <span className="status-chip status-chip--reconnecting">
          <span className="status-chip__dot" />awaiting you
        </span>
      }
    >
      <div className="review__job">{props.job}</div>
      <div className="review__meta">
        {props.scopeId} &bull; expires {Math.round(props.expiresInMs / 60000)} min after granting
      </div>

      <div className="review__section">
        <span className="hud-label">Offices</span>
        {props.offices.map((office) => (
          <div key={office} className="review__row">
            <span className="review__office">{office}</span>
            <span className="review__limits">
              {props.maxAmountMinor[office] !== undefined
                ? `\u2264 ${props.maxAmountMinor[office]} minor `
                : ""}
              {props.maxCalls[office] !== undefined ? `\u00d7${props.maxCalls[office]} ` : ""}
              {props.countersignRequired.includes(office) ? "&bull; countersign" : ""}
            </span>
          </div>
        ))}
      </div>

      {Object.keys(props.resources).length > 0 ? (
        <div className="review__section">
          <span className="hud-label">Records</span>
          {Object.entries(props.resources).map(([office, records]) => (
            <div key={office} className="review__row">
              <span className="review__office">{office}</span>
              <span className="review__limits">{records.join(", ")}</span>
            </div>
          ))}
        </div>
      ) : null}

      {props.report && props.report.findings.length > 0 ? (
        <div className="review__findings">
          <span className="hud-label">
            The Yard &bull; {blocking.length ? `${blocking.length} to review` : "notes only"}
          </span>
          {props.report.findings.slice(0, 3).map((finding, idx) => (
            <div
              key={`${finding.kind}-${idx}`}
              className={`review__finding review__finding--${finding.severity}`}
            >
              <strong>{finding.summary}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="review__clean">The Yard &bull; 46 probes passed cleanly</div>
      )}

      {props.candidates.length > 0 ? (
        <div className="review__section">
          <span className="hud-label">Counterfactuals &bull; what if we also granted...</span>
          <div className="review__candidates">
            {props.candidates.map((office) => (
              <button
                key={office}
                type="button"
                className={`btn btn--mini ${asked?.office === office ? "btn--primary" : ""}`}
                disabled={asking !== null}
                onClick={() => void ask(office)}
              >
                {asking === office ? "probing..." : `+ ${office}`}
              </button>
            ))}
          </div>
          {asked ? (
            <div className="review__cf">
              <div className="review__cf-summary">{asked.summary}</div>
              <div className="review__cf-delta">
                {asked.newDistricts.length > 0
                  ? `Annexes ${asked.newDistricts.join(", ")} to the city map`
                  : "Within already granted districts"}
              </div>
              <button className="btn review__cf-clear" type="button" onClick={clear}>
                Clear preview
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="review__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            soundEngine.playCountersign();
            props.onGrant();
          }}
        >
          Grant this scope
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            soundEngine.playRefusal();
            props.onDeny();
          }}
        >
          Deny
        </button>
      </div>

      <div className="review__hint">
        Once granted, tools outside this scope are absent from the agent&rsquo;s session.
      </div>
    </Window>
  );
}
