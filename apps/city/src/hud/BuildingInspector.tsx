import type { BuildingState } from "../building-state.js";
import { Window } from "./Window.js";
import { soundEngine } from "./sound-engine.js";

/**
 * What one building is, and what it may do.
 *
 * The city could previously answer "this is the Exchequer", which is a fact
 * about geography rather than authority. An operator deciding whether to grant
 * a scope, or reading one mid-mission, is asking something narrower: may the
 * agent refund *this* charge, for how much, how many times, and does it stop to
 * ask me. All of that was in the scope already and none of it was on screen.
 *
 * Money is shown as it is enforced. `4900` is the number the evaluator compares
 * against, and rendering it as `$49.00` while the boundary reasons in minor
 * units would put a different number in front of the operator than the one that
 * governs -- which is the exact gap between stated and actual authority this
 * project keeps arguing about. Both are shown, minor units first.
 */

const AUTHORITY_LABEL: Record<BuildingState["authority"], string> = {
  absent: "not in scope",
  proposed: "proposed",
  allowed: "granted",
  gated: "granted \u2022 countersign",
};

const ACTIVITY_LABEL: Record<BuildingState["activity"], string> = {
  idle: "idle",
  working: "working",
  waiting: "waiting for you",
  done: "done",
  refused: "refused",
};

/** `4900` -> `$49.00`. Presentation only; never used for a comparison. */
function asMajor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export function BuildingInspector(props: {
  state: BuildingState | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const building = props.state;
  if (!building) return null;

  return (
    <Window
      title={building.office}
      right={
        <button
          className="btn inspector__close"
          onClick={() => {
            soundEngine.playClick();
            props.onClose();
          }}
          aria-label="Close"
          title="Close details"
        >
          &times;
        </button>
      }
    >
      <div className={`inspector__badges inspector__badges--${building.authority}`}>
        <span className={`inspector__badge inspector__badge--${building.authority}`}>
          {AUTHORITY_LABEL[building.authority]}
        </span>
        <span className={`inspector__badge inspector__badge--activity-${building.activity}`}>
          {ACTIVITY_LABEL[building.activity]}
        </span>
      </div>

      {building.authority === "absent" ? (
        /* Not a lesser state to report. An office outside the scope is not
           merely disallowed -- it is absent from `tools/list`, so the agent
           cannot see that it exists. That is the product's central claim and it
           deserves saying rather than an empty panel. */
        <p className="inspector__absent">
          Outside the city limits. This office is not listed to the agent at all,
          so it cannot be called, retried, or discovered.
        </p>
      ) : (
        <>
          <div className="inspector__row">
            <span className="hud-label">Records</span>
            <span className="inspector__value">
              {building.resources.length > 0 ? building.resources.join(", ") : "none"}
            </span>
          </div>

          {building.maxAmountMinor !== null ? (
            <div className="inspector__row">
              <span className="hud-label">Ceiling</span>
              <span className="inspector__value">
                {building.maxAmountMinor} minor &bull; {asMajor(building.maxAmountMinor)}
              </span>
            </div>
          ) : null}

          <div className="inspector__row">
            <span className="hud-label">Calls</span>
            <span className="inspector__value">
              {building.callsUsed}
              {building.callBudget !== null ? ` of ${building.callBudget}` : " \u2022 no budget"}
            </span>
          </div>

          {building.authority === "gated" ? (
            <p className="inspector__note">
              Every call here pauses for a countersign bound to its exact arguments.
            </p>
          ) : null}
        </>
      )}

      {building.refusal ? (
        <div className="inspector__refusal">
          <span className="hud-label">Last refusal</span>
          <span>{building.refusal}</span>
        </div>
      ) : null}
    </Window>
  );
}
