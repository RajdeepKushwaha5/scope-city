import { describe, expect, it, vi } from "vitest";
import { QuotaLedger } from "@scope-city/ledger";
import { buildRegistry, type OfficeSpec, type Scope } from "@scope-city/scope";
import { MissionRegistry, missionFromPath, newMissionId, type Mission } from "../src/index.js";

const NOW = 1_700_000_000_000;

const registry = buildRegistry([
  {
    office: "charge.refund",
    district: "exchequer",
    mutating: true,
    args: {
      charge_id: { kind: "resource", resourceClass: "charge_ids", required: true },
      amount: { kind: "amount_minor", required: true },
    },
    responseFields: ["id", "status"],
    freeTextFields: [],
  },
] satisfies OfficeSpec[]);

function scopeFor(missionId: string): Scope {
  return {
    missionId,
    scopeId: "SC-1",
    agent: "a",
    job: "j",
    state: "active",
    offices: ["charge.refund"],
    resources: { charge_ids: ["ch_184"] },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1 },
      maxResponseBytes: 64_000,
    },
    projection: { "charge.refund": ["id", "status"] },
    countersignRequired: [],
    expiresAt: NOW + 600_000,
    grantedBy: "operator",
    grantedAt: NOW,
    version: 1,
  };
}

function mission(id = newMissionId()): Mission {
  return {
    id,
    scope: scopeFor(id),
    registry,
    ledger: new QuotaLedger(),
    upstream: vi.fn(async () => ({ id: "re_1", status: "succeeded" })),
    countersign: vi.fn(async (r: { fingerprint: string }) => ({
      approved: true,
      fingerprint: r.fingerprint,
    })),
    emit: vi.fn(),
    createdAt: NOW,
  };
}

describe("mission ids", () => {
  it("are long enough that guessing one is not a strategy", () => {
    const id = newMissionId();
    expect(id).toMatch(/^m_[0-9a-f]{48}$/);
  });

  it("do not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newMissionId()));
    expect(ids.size).toBe(500);
  });
});

describe("MissionRegistry", () => {
  it("hands back a mission by id", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);
    expect(registryOfMissions.get(m.id)).toBe(m);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    // An unknown mission and a forgotten one look identical to a caller, and
    // neither should produce a stack trace over the wire.
    expect(new MissionRegistry().get("m_" + "0".repeat(48))).toBeUndefined();
  });

  it("refuses to register the same id twice", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);
    expect(() => registryOfMissions.register(m)).toThrow(/already registered/);
  });

  it("keeps two concurrent missions from seeing each other", () => {
    const registryOfMissions = new MissionRegistry();
    const a = mission();
    const b = mission();
    registryOfMissions.register(a);
    registryOfMissions.register(b);

    a.ledger.claim({
      missionId: a.id,
      office: "charge.refund",
      ceiling: 1,
      idempotencyKey: "k",
      nonce: "n",
      now: NOW,
    });

    // Two judges on the same public URL must not spend each other's budget.
    expect(a.ledger.consumed(a.id)["charge.refund"]).toBe(1);
    expect(b.ledger.consumed(b.id)["charge.refund"] ?? 0).toBe(0);
  });

  it("forgets a mission and its counters together", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);
    m.ledger.claim({
      missionId: m.id,
      office: "charge.refund",
      ceiling: 1,
      idempotencyKey: "k",
      nonce: "n",
      now: NOW,
    });

    registryOfMissions.forget(m.id);

    expect(registryOfMissions.get(m.id)).toBeUndefined();
    expect(m.ledger.consumed(m.id)).toEqual({});
  });

  it("swaps a scope in place when the operator grants a new one", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);

    const revoked = { ...m.scope, state: "revoked" as const, version: 2 };
    expect(registryOfMissions.updateScope(m.id, revoked)).toBe(true);
    expect(registryOfMissions.get(m.id)?.scope.state).toBe("revoked");
  });

  it("reports failure when asked to update a mission that is gone", () => {
    expect(new MissionRegistry().updateScope("m_" + "0".repeat(48), scopeFor("x"))).toBe(false);
  });
});

describe("sweeping", () => {
  it("drops missions past their age and leaves fresh ones alone", () => {
    const registryOfMissions = new MissionRegistry();
    const old = mission();
    const fresh: Mission = { ...mission(), createdAt: NOW + 9_000 };
    registryOfMissions.register(old);
    registryOfMissions.register(fresh);

    const dropped = registryOfMissions.sweep(NOW + 10_000, 5_000);

    expect(dropped).toBe(1);
    expect(registryOfMissions.get(old.id)).toBeUndefined();
    expect(registryOfMissions.get(fresh.id)).toBeDefined();
  });
});

describe("missionFromPath", () => {
  it("finds the mission named in a proxy url", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);

    expect(missionFromPath(registryOfMissions, `/mission/${m.id}/mcp`)).toBe(m);
    expect(missionFromPath(registryOfMissions, `/mission/${m.id}`)).toBe(m);
  });

  it("ignores a path with no mission in it", () => {
    expect(missionFromPath(new MissionRegistry(), "/healthz")).toBeUndefined();
  });

  it("ignores a malformed id rather than trying to look it up", () => {
    const registryOfMissions = new MissionRegistry();
    expect(missionFromPath(registryOfMissions, "/mission/m_short/mcp")).toBeUndefined();
    expect(missionFromPath(registryOfMissions, "/mission/../../etc/passwd")).toBeUndefined();
  });
});

describe("a mission and its scope are one identity", () => {
  // Found by Qodo review. Missions are keyed by mission.id but the ledger is
  // keyed by scope.missionId; if those diverge, quota is counted against one
  // mission and forgotten with another.
  it("refuses to register a scope belonging to a different mission", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    const wrong: Mission = { ...m, scope: scopeFor(newMissionId()) };

    expect(() => registryOfMissions.register(wrong)).toThrow(/not/);
  });

  it("refuses to swap in a scope belonging to a different mission", () => {
    const registryOfMissions = new MissionRegistry();
    const m = mission();
    registryOfMissions.register(m);

    expect(() => registryOfMissions.updateScope(m.id, scopeFor(newMissionId()))).toThrow(
      /quota would be counted against the wrong mission/,
    );
  });
});
