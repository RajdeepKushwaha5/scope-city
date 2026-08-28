import type { ScopeView } from "./useMission.js";

/**
 * The line written into the operator's log when a scope is granted.
 *
 * Its own function because the counts have to describe the scope that was
 * actually granted, and that is not always the one this demo starts with. The
 * over-reach run proposes a wide scope, has the Yard find a gap in it, and
 * narrows it -- so the operator can grant either, and a fixed sentence saying
 * "3 offices allowed, 2 gated" described the narrow one while the wide one was
 * on the map. That is the log telling them something other than what they just
 * did, in the one place a record of it is being kept.
 */
export function grantLine(scope: ScopeView): string {
  const allowed = scope.offices.filter((o) => o.disposition === "allowed").length;
  const gated = scope.offices.filter((o) => o.disposition === "gated").length;

  return `Scope granted. ${allowed} offices allowed, ${gated} gated, everything else absent.`;
}
