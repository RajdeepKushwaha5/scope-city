import { DISTRICT_PLOTS, isFacilityCell, type Building } from "./render/world.js";
import type { Cell } from "./iso/projection.js";

/**
 * What a building is, for every building rather than nine of them.
 *
 * The city draws about two hundred and forty structures and nine of them were
 * offices. Only those nine answered a hover or a click; the rest were painted
 * scenery that swallowed the pointer, so most of the map taught the operator
 * that the map does not respond -- and once you have learned that about a city,
 * you stop trying the buildings that do.
 *
 * The fix is not to invent a capability for every rooftop. Fabricating meaning
 * is the thing this project spends its whole argument objecting to, and an
 * operator who clicks a house and is told it is `charge.refund` has been lied
 * to about authority in the one interface whose job is to be trusted about it.
 *
 * So every building answers with something true. An office answers with itself.
 * Everything else answers with where it stands and what happens there -- which
 * is the fact a newcomer is actually missing, because the districts are the
 * metaphor and nothing on screen explained them.
 */

/**
 * What each district is, in the terms the product means them.
 *
 * Districts are not decoration and they are not all the same kind of thing:
 * four of them are systems the harness connected over MCP, and two are stages
 * of the boundary itself. Saying so is the difference between a legend and an
 * explanation.
 */
export const DISTRICT_NOTES: Readonly<Record<string, string>> = {
  records:
    "The ticket system. Everything the agent can read or write about a support case is here, and this is where an injected instruction arrives, because a ticket body is text a stranger wrote.",
  exchequer:
    "The payment processor. The only district holding an office that moves money, which is why it is also the only one with a permanent gate on it.",
  archive:
    "History. Read-only by construction: there is no office here that can alter what is already recorded.",
  "post-house":
    "Outbound mail. Irreversible in the way that matters -- a sent message cannot be recalled, and the recipient is an argument the scope pins down.",
  yard: "Where a scope is drafted before it is granted. A draft that reaches too wide is narrowed here, by a second reading, and the operator sees both.",
  gate: "Where an irreversible call stops and waits for a person. The countersign is bound to the exact arguments on screen, not to the office in general.",
};

/** A building the operator pointed at, described. */
export interface Place {
  readonly cell: Cell;
  /** The office, when the building is one. Null for everything else. */
  readonly office: string | null;
  /** The district it stands in, if any. */
  readonly district: string | null;
  /** One line, for the tooltip's first row and the inspector's title. */
  readonly title: string;
  /** One line under it. */
  readonly detail: string;
}

/** Coastal ground is reserved for the airport, the port and the naval yard. */
function facilityAt(cell: Cell): string | null {
  if (!isFacilityCell(cell.u, cell.v)) return null;
  if (cell.v >= 27 && cell.u <= 13) return "Airfield";
  if (cell.v >= 28 && cell.u >= 27) return "Container port";
  return "Naval yard";
}

export function districtAtCell(cell: Cell): string | null {
  const plot = DISTRICT_PLOTS.find(
    (p) => cell.u >= p.u0 && cell.u <= p.u1 && cell.v >= p.v0 && cell.v <= p.v1,
  );
  return plot?.id ?? null;
}

export function districtTitle(district: string | null): string {
  return DISTRICT_PLOTS.find((p) => p.id === district)?.title ?? "Outskirts";
}

/**
 * Describes whatever was picked, including nothing.
 *
 * `building` is null when the pointer is over open ground, and that still has
 * an answer -- the district is a fact about the cell, not about the structure
 * standing on it -- so a click on a park or a road says where it is rather than
 * dropping the selection silently.
 */
export function describePlace(building: Building | null, cell: Cell): Place {
  const at = building?.cell ?? cell;

  if (building?.kind === "office" && building.office) {
    return {
      cell: at,
      office: building.office,
      district: building.district,
      title: building.office,
      detail: districtTitle(building.district),
    };
  }

  const facility = facilityAt(at);
  if (facility) {
    return {
      cell: at,
      office: null,
      district: null,
      title: facility,
      // True, and worth saying rather than dressing up: these exist so the
      // island reads as a place. Claiming otherwise would be the fabrication
      // this file exists to avoid.
      detail: "Coastal works · scenery, not an office",
    };
  }

  const district = building?.district ?? districtAtCell(at);
  const kind = building === null ? "Open ground" : building.kind === "house" ? "House" : "City block";

  return {
    cell: at,
    office: null,
    district,
    title: districtTitle(district),
    detail: district === null ? kind : `${kind} · not an office`,
  };
}
