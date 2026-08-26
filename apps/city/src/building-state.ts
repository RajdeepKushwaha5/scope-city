import { scopeIsOpen, type LiveCityState } from "./live-state.js";

/**
 * What a building is, right now.
 *
 * The city drew authority at district granularity: a whole district lit or
 * fogged, which answers "may the agent touch the Exchequer" when the question
 * an operator actually has is "may it refund *this* charge, and how many times,
 * and does it stop to ask me". Every one of those answers already existed in
 * the scope and the event feed; nothing rendered them per building.
 *
 * Two axes rather than one, because they are independent and conflating them
 * loses the distinction that matters. *Authority* is what the scope permits and
 * changes only when a scope is granted or revoked. *Activity* is what the agent
 * is doing and changes constantly. A gated office sitting idle and a gated
 * office waiting on a countersign are the same authority and very different
 * situations.
 */

/** What the scope permits here. Slow-moving. */
export type BuildingAuthority =
  /** Not in the scope at all. The agent cannot see it in `tools/list`. */
  | "absent"
  /** In a scope awaiting a human decision. */
  | "proposed"
  /** Granted, and calls go straight through. */
  | "allowed"
  /** Granted, but every call stops for a countersign. */
  | "gated";

/** What is happening here. Fast-moving. */
export type BuildingActivity =
  | "idle"
  | "working"
  /** A call is paused at The Gate waiting for a person. */
  | "waiting"
  | "done"
  /** The boundary refused a call. */
  | "refused";

export interface BuildingState {
  readonly office: string;
  readonly authority: BuildingAuthority;
  readonly activity: BuildingActivity;
  /** Calls the ledger has settled, and the ceiling if the scope set one. */
  readonly callsUsed: number;
  readonly callBudget: number | null;
  /** Amount ceiling in integer minor units, when this office takes an amount. */
  readonly maxAmountMinor: number | null;
  /** The exact records this office may touch, flattened for display. */
  readonly resources: readonly string[];
  /** Why the last call was refused, when it was. */
  readonly refusal: string | null;
}

const EMPTY: readonly string[] = [];

/**
 * Derives every building's state from the mission state.
 *
 * A derivation rather than a second store, deliberately. Keeping per-building
 * state alongside the reducer would create two descriptions of one mission that
 * drift the first time an event is handled in one and not the other -- and the
 * drift would show as a building whose colour disagrees with the log beside it,
 * which is worse than no colour at all.
 */
export function buildingStates(
  state: LiveCityState,
  offices: readonly { office: string; district: string; consumes?: readonly string[] }[],
): ReadonlyMap<string, BuildingState> {
  const scope = state.proposedScope;
  // Shared with the city view rather than judged again here. Two definitions of
  // "still granted" drift, and the drift shows as a building claiming authority
  // the fogged ground around it says has gone.
  const granted = scopeIsOpen(state);
  const inScope = new Set(scope?.offices ?? []);
  const gated = new Set(scope?.countersignRequired ?? []);

  // A scope still awaiting a decision confers nothing yet, and showing it as
  // `allowed` would tell the operator they had granted something they have not.
  const pending = state.status === "proposed";

  const waitingOn = state.gate?.office ?? null;
  const map = new Map<string, BuildingState>();

  for (const { office, consumes } of offices) {
    const authority: BuildingAuthority = !granted || !inScope.has(office)
      ? "absent"
      : pending
        ? "proposed"
        : gated.has(office)
          ? "gated"
          : "allowed";

    const record = state.officeActivity[office];

    const activity: BuildingActivity =
      waitingOn === office
        ? "waiting"
        : record?.refusal
          ? "refused"
          : record?.busy
            ? "working"
            : record && record.calls > 0
              ? "done"
              : "idle";

    map.set(office, {
      office,
      authority,
      activity,
      callsUsed: record?.calls ?? 0,
      callBudget: scope?.limits.maxCalls?.[office] ?? null,
      maxAmountMinor: scope?.limits.maxAmountMinor?.[office] ?? null,
      resources: resourcesFor(scope, office, consumes ?? []),
      refusal: record?.refusal ?? null,
    });
  }

  return map;
}

/**
 * The record ids this office can actually reach.
 *
 * Only the classes it takes an argument for. Flattening every granted resource
 * onto every building was quietly wrong in the worst direction: `charge.refund`
 * reported that it could reach ticket ids and email addresses, overstating
 * authority on the one screen whose entire job is stating it precisely.
 *
 * Classes are flattened *within* that filter, because an operator reading one
 * building does not care which class an id belongs to -- they care whether the
 * list is one charge or every charge.
 */
function resourcesFor(
  scope: LiveCityState["proposedScope"],
  office: string,
  consumes: readonly string[],
): readonly string[] {
  if (!scope || !scope.offices.includes(office)) return EMPTY;
  return consumes.flatMap((cls) => scope.resources[cls] ?? []);
}
