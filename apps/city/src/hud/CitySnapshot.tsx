import { Window } from "./Window.js";

export function CitySnapshot(props: { onSnapshot: () => void }): React.JSX.Element {
  return (
    <Window title="Share city map" right={<span>PNG</span>}>
      <div className="snapshot-card">
        <span>Capture the complete Scope City island and mission boundary.</span>
        <button className="btn btn--primary" type="button" onClick={props.onSnapshot}>
          Snapshot
        </button>
      </div>
    </Window>
  );
}
