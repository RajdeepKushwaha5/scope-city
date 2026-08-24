import type { BacktestReport } from "@scope-city/yard";
import { Window } from "./Window.js";

/**
 * The Yard's verdict, shown before the agent does anything.
 *
 * Placed above the record rather than beside it because the ordering is the
 * argument: these findings were known *before* the grant, which is the only
 * time they could have changed the decision.
 *
 * A clean report is rendered as loudly as a dirty one. "No holes in 46 probes"
 * is the sentence that makes every other panel believable, and hiding it when
 * nothing is wrong would leave the operator unable to tell a scope that is
 * sound from one that was never examined.
 */
export function YardPanel(props: { report: BacktestReport | null }): React.JSX.Element {
  const report = props.report;

  return (
    <Window
      title="THE YARD"
      right={
        report ? (
          <span className={`status-chip status-chip--${report.clean ? "live" : "reconnecting"}`}>
            <span className="status-chip__dot" />
            {report.clean ? "no holes" : `${report.findings.filter((f) => f.severity !== "note").length} to review`}
          </span>
        ) : null
      }
    >
      {!report ? (
        <div className="empty">Runs before the scope is granted.</div>
      ) : (
        <>
          <div className="yard__probes">
            {report.probesRun} adversarial probes · nothing called, nothing spent
          </div>

          {report.findings.length === 0 ? (
            <div className="empty">Nothing to report.</div>
          ) : (
            <div className="yard__list">
              {report.findings.map((finding, i) => (
                <div key={`${finding.kind}-${i}`} className={`yard__item yard__item--${finding.severity}`}>
                  <div className="yard__head">
                    <span className={`yard__sev yard__sev--${finding.severity}`}>
                      {finding.severity}
                    </span>
                    <span className="yard__office">{finding.office}</span>
                  </div>
                  <div className="yard__summary">{finding.summary}</div>
                  {finding.detail && finding.detail.length > 0 ? (
                    <div className="yard__detail">{finding.detail.join(" · ")}</div>
                  ) : null}
                  {finding.remedy ? <div className="yard__remedy">{finding.remedy}</div> : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Window>
  );
}
