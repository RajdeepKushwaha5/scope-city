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
  const adversary = report?.adversary;

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

          {/*
           * What the local model tried, and what the evaluator did with it.
           *
           * The panel showed a probe count and the findings, which between them
           * say nothing about the half of the Yard that is interesting to
           * watch: a model on this machine read the job and the ticket -- the
           * injected one -- and wrote calls aimed at getting more than the job
           * needed. Every one went through the same evaluator the proxy uses.
           *
           * The refusals are the point. "0 holes" reads as nothing having
           * happened; a list of attacks refused by name is the wall doing its
           * job, in public, before anyone granted anything.
           *
           * The `why` is a model's words, produced from text an attacker may
           * have written. It is rendered as text beside the evaluator's own
           * verdict, and it is never what decides the verdict.
           */}
          {adversary ? (
            <div className="yard__adversary">
              {adversary.declined ? (
                <div className="yard__adversary-head">
                  local adversary did not run · {adversary.declined}
                </div>
              ) : (
                <>
                  <div className="yard__adversary-head">
                    {adversary.model} wrote {adversary.admitted} attack
                    {adversary.admitted === 1 ? "" : "s"} on this machine ·{" "}
                    {adversary.holes === 0
                      ? "none got through"
                      : `${adversary.holes} got through`}
                  </div>
                  {adversary.attempts.map((attempt, i) => (
                    <div className="yard__attempt" key={`${attempt.office}-${i}`}>
                      <span
                        className={`yard__verdict yard__verdict--${attempt.refused ? "refused" : "allowed"}`}
                      >
                        {attempt.refused ? "refused" : "allowed"}
                      </span>
                      <span className="yard__office">{attempt.office}</span>
                      {attempt.reason ? (
                        <span className="yard__reason">{attempt.reason}</span>
                      ) : null}
                      <span className="yard__why">{attempt.why}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : null}

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
