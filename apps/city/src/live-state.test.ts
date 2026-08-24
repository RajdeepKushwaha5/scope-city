import { describe, expect, it } from "vitest";
import { initialLiveCityState, reduceLiveCity } from "./live-state.js";

describe("live city event fold", () => {
  it("raises and clears only the matching visible gate", () => {
    const raised = reduceLiveCity(initialLiveCityState, {
      type: "world",
      event: {
        type: "gate.raised",
        threadId: "main",
        toolCallId: "tc_1",
        office: "charge.refund",
        args: { amount: 4900 },
        at: 1,
      },
    });
    expect(raised.phase).toBe("awaiting_countersign");
    expect(raised.gate?.district).toBe("exchequer");

    const stale = reduceLiveCity(raised, {
      type: "world",
      event: { type: "gate.cleared", toolCallId: "tc_other", approved: true, at: 2 },
    });
    expect(stale.gate).toEqual(raised.gate);

    const cleared = reduceLiveCity(stale, {
      type: "world",
      event: { type: "gate.cleared", toolCallId: "tc_1", approved: true, at: 3 },
    });
    expect(cleared.gate).toBeNull();
  });

  it("renders proxy refusals as boundary events", () => {
    const state = reduceLiveCity(initialLiveCityState, {
      type: "proxy",
      event: {
        type: "call.out_of_scope",
        missionId: "m_1",
        office: "charge.get",
        district: "exchequer",
        reason: "resource_not_in_scope",
        detail: "charge ch_185 is outside charge_ids",
        at: 1,
      },
    });
    expect(state.log.at(-1)?.kind).toBe("refused");
    expect(state.log.at(-1)?.what).toMatch(/OUT OF SCOPE/);
    expect(state.refusedAt).not.toBeNull();
  });

  it("maps the one proxy connection to the systems it actually fronts", () => {
    const state = reduceLiveCity(initialLiveCityState, {
      type: "world",
      event: { type: "district.online", district: "scope-city-live", at: 1 },
    });
    expect(state.online).toEqual(["records", "exchequer", "post-house", "gate"]);
  });

  it("drops the visible boundary and pending gate when the server expires scope", () => {
    const state = reduceLiveCity(
      { ...initialLiveCityState, phase: "awaiting_countersign", gate: {
        toolCallId: "tc_1",
        office: "charge.refund",
        district: "exchequer",
        args: {},
      } },
      { type: "scope.expired", at: 1 },
    );
    expect(state.scopeExpired).toBe(true);
    expect(state.gate).toBeNull();
  });
});
