import { describe, expect, it, vi } from "vitest";
import type { Scope } from "@scope-city/scope";
import {
  expireLiveMission,
  retireMission,
  type ExpiringLiveMission,
  type ManagedLiveMission,
} from "../src/live-lifecycle.js";

function mission(): ManagedLiveMission {
  return {
    id: "m_test",
    status: "running",
    feed: { append: vi.fn() },
    gates: { cancelAll: vi.fn() },
  };
}

describe("retireMission", () => {
  for (const status of ["completed", "failed", "cancelled"] as const) {
    it(`revokes registry access before publishing ${status}`, () => {
      const live = mission();
      const order: string[] = [];
      live.gates.cancelAll = vi.fn(() => order.push("gates"));
      live.feed.append = vi.fn(() => order.push("status"));
      const registry = { forget: vi.fn(() => order.push("registry")) };

      expect(retireMission(live, registry, status)).toBe(true);
      expect(live.status).toBe(status);
      expect(order).toEqual(["gates", "registry", "status"]);
      expect(registry.forget).toHaveBeenCalledWith("m_test");
    });
  }

  it("does not let a late completion overwrite cancellation", () => {
    const live = mission();
    const registry = { forget: vi.fn() };
    retireMission(live, registry, "cancelled");

    expect(retireMission(live, registry, "completed")).toBe(false);
    expect(live.status).toBe("cancelled");
    expect(registry.forget).toHaveBeenCalledTimes(1);
  });

  it("revokes an expired scope and cancels its running TrueForge session", async () => {
    const live = {
      ...mission(),
      scope: { missionId: "m_test", state: "granted" } as Scope,
      sessionId: "session_1",
    } satisfies ExpiringLiveMission;
    const registry = { updateScope: vi.fn(() => true), forget: vi.fn() };
    const cancel = vi.fn(async () => undefined);

    await expect(expireLiveMission(live, registry, cancel, 184)).resolves.toBe(true);

    expect(registry.updateScope.mock.calls[0]?.[1]).toMatchObject({ state: "expired" });
    expect(registry.forget).toHaveBeenCalledWith("m_test");
    expect(cancel).toHaveBeenCalledWith("session_1");
    expect(live.status).toBe("cancelled");
  });
});
