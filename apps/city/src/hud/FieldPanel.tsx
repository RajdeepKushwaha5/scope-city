import { Window } from "./Window.js";
import { crewFrom, outsideScope, type CrewMember } from "../crew.js";
import type { Figure } from "../render/scene.js";
import { OFFICES, type ScopeView } from "../useMission.js";

/**
 * The crew, and the one thing that binds them.
 *
 * The map already draws a figure per thread, which shows that delegation
 * happened. This answers the question delegation raises, which nothing in the
 * interface answered before: *if the agent can create workers while it runs,
 * what stops one of them doing something nobody approved?*
 *
 * Every row ends at the same line. That is the whole design -- the threads are
 * listed separately and then visibly join, because the property being shown is
 * that there is no per-subagent permission to get wrong. A child inherits the
 * session's tools and reaches the same proxy, so it is judged against the scope
 * the operator granted the root, and nothing about it was negotiated apart.
 *
 * The verdict at the bottom is computed, never asserted. A panel that says "all
 * within scope" because someone typed those words is worth nothing; this one
 * compares where the subagents actually went against what was actually granted,
 * and is built to say the opposite if it ever has to.
 */
export function FieldPanel(props: {
  figures: readonly Figure[];
  threadWork: Readonly<Record<string, readonly string[]>>;
  threadTitles: Readonly<Record<string, string | null>>;
  scope: ScopeView | null;
}): React.JSX.Element | null {
  const crew = crewFrom(props.figures, props.threadWork, props.threadTitles);

  // Nothing to say until the agent delegates. A panel explaining that one
  // thread is bound by one scope is a panel stating the obvious, and the
  // interface has enough to read during a mission already.
  if (crew.delegated === 0) return null;

  const granted = (props.scope?.offices ?? [])
    .filter((entry) => entry.disposition !== "blocked")
    .map((entry) => entry.office);
  // Only the offices the proxy actually judges can be breached. A worker that
  // ran a sandbox check called `exec`, which the scope was never asked about.
  const breaches = outsideScope(crew, granted, OFFICES.map((entry) => entry.office));
  const dispositions = new Map(
    (props.scope?.offices ?? []).map((entry) => [entry.office, entry.disposition] as const),
  );

  return (
    <Window
      title="THE FIELD"
      right={
        <span style={{ color: "var(--ink-dim)" }}>
          {crew.members.length} THREAD{crew.members.length === 1 ? "" : "S"}
        </span>
      }
    >
      <ol className="crew">
        {crew.members.map((member) => (
          <CrewRow key={member.threadId} member={member} dispositions={dispositions} />
        ))}
      </ol>

      <div className={`crew__bind ${breaches.length > 0 ? "crew__bind--broken" : ""}`}>
        <span className="crew__brace" aria-hidden="true" />
        <div>
          {breaches.length === 0 ? (
            <>
              <strong>One scope{props.scope ? ` — ${props.scope.id}` : ""}.</strong>{" "}
              {/* Stated as a count of threads rather than a reassurance, so the
                  sentence is checkable against the rows directly above it. */}
              All {crew.members.length} threads judged by the same limits. The{" "}
              {crew.delegated} delegated {crew.delegated === 1 ? "worker" : "workers"} reached{" "}
              {crew.delegatedOffices.length === 0
                ? "no offices"
                : `only ${crew.delegatedOffices.join(", ")}`}
              , every one of them inside it.
            </>
          ) : (
            <>
              <strong>A worker reached outside the scope.</strong> {breaches.join(", ")}{" "}
              {breaches.length === 1 ? "was" : "were"} never granted. This should be impossible;
              the boundary has a hole.
            </>
          )}
        </div>
      </div>
    </Window>
  );
}

function CrewRow(props: {
  member: CrewMember;
  dispositions: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const { member } = props;

  return (
    <li className={`crew__row ${member.isRoot ? "crew__row--root" : ""}`}>
      <span className="crew__mark" aria-hidden="true">
        {member.isRoot ? "▣" : "▸"}
      </span>
      <span className="crew__name">
        {member.title}
        {member.isRoot ? null : (
          <span className="crew__badge">{member.active ? "working" : "done"}</span>
        )}
      </span>
      <span className="crew__offices">
        {member.offices.length === 0 ? (
          <span className="crew__idle">no calls yet</span>
        ) : (
          member.offices.map((office) => {
            // An office the scope never named is not "allowed" -- it is the
            // harness's own tool. `create_sub_agent` and `exec` show up on the
            // root's row and are exactly that: delegation and the sandbox,
            // neither of which the operator granted. Colouring them green
            // would claim the scope approved something it never saw.
            const disposition = props.dispositions.get(office);
            return (
              <span
                key={office}
                className={`tag ${disposition ? `tag--${disposition}` : "tag--harness"}`}
                title={disposition ? undefined : "a harness capability, not a scoped office"}
              >
                {office}
              </span>
            );
          })
        )}
      </span>
    </li>
  );
}
