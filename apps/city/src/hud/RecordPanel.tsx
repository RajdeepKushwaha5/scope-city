import { Window } from "./Window.js";
import type { LogLine } from "../useMission.js";

/** Everything that happened, newest first. */
export function RecordPanel(props: { lines: readonly LogLine[] }): React.JSX.Element {
  return (
    <Window title="THE RECORD" right={<span>{props.lines.length}</span>}>
      {props.lines.length === 0 ? (
        <div className="empty">Nothing yet.</div>
      ) : (
        <div className="log" style={{ maxHeight: 220 }}>
          {props.lines.map((line, i) => (
            <div key={`${line.at}-${i}`} className={`log__line log__line--${line.kind}`}>
              <span className="log__at">{line.at}</span>
              <span className="log__what">{line.what}</span>
            </div>
          ))}
        </div>
      )}
    </Window>
  );
}
