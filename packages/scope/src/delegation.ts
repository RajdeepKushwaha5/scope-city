import type { Scope } from "./schema.js";
import type { OfficeRegistry, OfficeSpec } from "./office-spec.js";

export interface ReadDelegationPlan {
  readonly source: string;
  readonly target: string;
}

function isRead(spec: OfficeSpec | undefined): spec is OfficeSpec {
  return spec !== undefined && !spec.mutating;
}

/**
 * Select two independent investigations only when registry contracts prove
 * both offices are read-only and the verifier can return the promised facts.
 */
export function planReadDelegation(
  scope: Scope,
  registry: OfficeRegistry,
): ReadDelegationPlan | null {
  const target = registry.get("charge.get");
  if (
    !scope.offices.includes("charge.get") ||
    !isRead(target) ||
    !target.responseFields.includes("amount") ||
    !target.responseFields.includes("refunded")
  ) {
    return null;
  }

  const source = ["ticket.get", "charge.find_by_order"].find((office) => {
    if (!scope.offices.includes(office)) return false;
    return isRead(registry.get(office));
  });

  return source ? { source, target: "charge.get" } : null;
}
