import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEASE_CEILING_MS } from "../src/derive-scope.js";

/**
 * The shipped recording has to be a run this code could still produce.
 *
 * It briefly was not. The lease ceiling was raised to thirty minutes so a
 * rate-limited mission would stop being cancelled mid-flight, the recording was
 * captured under that ceiling, and then the change was lost in a rebase while
 * the recording it produced stayed on main. What shipped was a control plane
 * that would refuse to grant the scope in its own evidence.
 *
 * That failure is quiet in the worst way: everything builds, every other test
 * passes, the replay plays back perfectly, and the only way to notice is to
 * recompute a duration nobody thinks to recompute. A judge reading the record
 * and then reading `BOUNDS` finds it in a minute.
 *
 * So the recording is held against the ceiling here. This is not a test of
 * arithmetic -- it is the claim that the artifact we offer as evidence and the
 * code we offer as the thing that produced it have not drifted apart.
 */

const recording = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../city/public/replays/refund-184.json", import.meta.url)),
    "utf8",
  ),
) as { readonly entries: readonly { readonly event?: Record<string, unknown> }[] };

/** The granted scope, read out of the record rather than assumed. */
function grantedScope(): { readonly grantedAt: number; readonly expiresAt: number } {
  for (const entry of recording.entries) {
    const scope = entry.event?.["scope"] as Record<string, unknown> | undefined;
    if (typeof scope?.["expiresAt"] === "number" && typeof scope["grantedAt"] === "number") {
      return scope as unknown as { grantedAt: number; expiresAt: number };
    }
  }
  throw new Error("the shipped recording carries no granted scope");
}

describe("the shipped recording is reproducible under the current ceiling", () => {
  it("was granted a lease this operator may still hand out", () => {
    const scope = grantedScope();
    const lease = scope.expiresAt - scope.grantedAt;

    expect(lease).toBeGreaterThan(0);
    expect(lease).toBeLessThanOrEqual(LEASE_CEILING_MS);
  });

  it("keeps the ceiling long enough to be worth having", () => {
    // Guards the other direction. Satisfying the test above by raising the
    // ceiling to a day would make the lease stop meaning anything, which is the
    // opposite of the point.
    expect(LEASE_CEILING_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
