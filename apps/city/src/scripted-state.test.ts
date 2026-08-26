import { describe, expect, it } from "vitest";
import { buildingStates } from "./building-state.js";
import { scriptedRawState } from "./scripted-state.js";
import { OFFICES, type ScopeView } from "./useMission.js";

const scope: ScopeView = {
  id: "SC-184",
  job: "Refund order #184",
  offices: [
    { office: "ticket.get", disposition: "allowed" },
    { office: "charge.refund", disposition: "gated" },
  ],
  resources: { ticket_ids: ["tkt_184"], charge_ids: ["ch_184"] },
  limits: ["1 refund"],
  expiresInMs: 60_000,
};

const state = (overrides: Partial<Parameters<typeof scriptedRawState>[0]> = {}) => scriptedRawState({
  phase: "running",
  scope,
  scopeState: "granted",
  online: ["records", "exchequer"],
  figures: [],
  gate: null,
  log: [],
  refusedAt: null,
  sandboxOpen: false,
  expiresAt: 70_000,
  officeActivity: { "ticket.get": { calls: 0, busy: true, refusal: null } },
  now: 10_000,
  ...overrides,
});

describe("scripted mission runtime state", () => {
  it("does not inherit the inactive recorded reducer's empty authority", () => {
    const buildings = buildingStates(state(), OFFICES);
    expect(buildings.get("ticket.get")?.authority).toBe("allowed");
    expect(buildings.get("charge.refund")?.authority).toBe("gated");
    expect(buildings.get("ticket.get")?.activity).toBe("working");
  });

  it("reports a scripted gate as waiting at the exact office", () => {
    const gate = { toolCallId: "tc-1", office: "charge.refund", district: "exchequer", args: {} };
    const buildings = buildingStates(state({ gate }), OFFICES);
    expect(buildings.get("charge.refund")?.activity).toBe("waiting");
  });
});
