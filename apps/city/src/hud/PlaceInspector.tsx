import type { BuildingState } from "../building-state.js";
import { DISTRICT_NOTES, type Place } from "../place.js";
import { Window } from "./Window.js";

/**
 * What is here, when what is here is not an office.
 *
 * Nine of the city's structures are offices and the rest were mute. Clicking
 * one did nothing at all, which taught the operator that the map does not
 * answer -- and having learned that, they stop clicking the nine that do.
 *
 * The temptation is to give every rooftop a capability. That would be the
 * fabrication this whole project argues against: an interface whose job is to
 * be trusted about authority cannot invent some. So the answer here is the true
 * one that was missing anyway. The districts are the metaphor -- four systems
 * the harness connected, and two stages of the boundary itself -- and nothing
 * on screen had ever explained them. A newcomer clicking a house now learns
 * what the neighbourhood is and which offices stand in it, which is the fact
 * they were short of.
 */

const AUTHORITY_LABEL: Record<BuildingState["authority"], string> = {
  absent: "not in scope",
  proposed: "proposed",
  allowed: "granted",
  gated: "gated",
};

export function PlaceInspector(props: {
  place: Place;
  /** Every office in the city, so the district's own can be picked out. */
  offices: readonly { office: string; district: string }[];
  states: ReadonlyMap<string, BuildingState>;
  online: readonly string[];
  onSelectOffice: (office: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const here = props.offices.filter((entry) => entry.district === props.place.district);
  const note = props.place.district ? DISTRICT_NOTES[props.place.district] : undefined;
  const online = props.place.district !== null && props.online.includes(props.place.district);

  return (
    <Window
      title={props.place.title}
      right={
        <button className="btn inspector__close" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      }
    >
      <div className="inspector__badges">
        <span className="inspector__badge">{props.place.detail}</span>
        {props.place.district ? (
          <span className={`inspector__badge inspector__badge--activity-${online ? "working" : "idle"}`}>
            {online ? "server online" : "not connected"}
          </span>
        ) : null}
      </div>

      {note ? <p className="inspector__note">{note}</p> : null}

      {props.place.district === null ? (
        /* Outside every district, and that is not a gap in the data. The island
           is bigger than the six systems on it, which is the shape of the real
           thing: most of what a company runs is not wired to the agent. */
        <p className="inspector__absent">
          No system stands here. The city is larger than what the harness has
          connected, and only the districts are reachable at all.
        </p>
      ) : here.length === 0 ? (
        <p className="inspector__absent">
          No offices. This district is a stage of the boundary rather than a
          system the agent calls into.
        </p>
      ) : (
        <>
          <div className="inspector__row">
            <span className="hud-label">Offices</span>
            <span className="inspector__value">{here.length}</span>
          </div>
          <div className="place__offices">
            {here.map((entry) => {
              const state = props.states.get(entry.office);
              const authority = state?.authority ?? "absent";
              return (
                <button
                  key={entry.office}
                  type="button"
                  className="place__office"
                  onClick={() => props.onSelectOffice(entry.office)}
                >
                  <span className="place__office-name">{entry.office}</span>
                  <span className={`inspector__badge inspector__badge--${authority}`}>
                    {AUTHORITY_LABEL[authority]}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Window>
  );
}
