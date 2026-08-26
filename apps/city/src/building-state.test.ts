import { describe, expect, it } from "vitest";
import { buildingStates } from "./building-state.js";
import { initialLiveCityState, reduceLiveCity, type LiveCityState } from "./live-state.js";

const OFFICES = [
  { office: "charge.get", district: "exchequer", consumes: ["charge_ids"] },
  { office: "charge.refund", district: "exchequer", consumes: ["charge_ids"] },
  { office: "mail.send", district: "post-house", consumes: ["mail_to"] },
  { office: "customer.list", district: "exchequer", consumes: [] },
];

const scope = {
  missionId: "m".repeat(20),
  scopeId: "SC-1",
  agent: "a",
  job: "Refund order #184",
  state: "granted",
  offices: ["charge.get", "charge.refund", "mail.send"],
  resources: { charge_ids: ["ch_184"], mail_to: ["buyer@example.test"] },
  limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: { "charge.refund": 1 } },
  countersignRequired: ["charge.refund"],
  expiresAt: 2_000_000,
  grantedAt: 1_000_000,
  version: 1,
} as const;

const granted = (over: Partial<LiveCityState> = {}): LiveCityState => ({
  ...initialLiveCityState,
  status: "running",
  proposedScope: scope as never,
  ...over,
});

describe("authority", () => {
  it("marks an office the scope never granted as absent", () => {
    const states = buildingStates(granted(), OFFICES);
    expect(states.get("customer.list")?.authority).toBe("absent");
  });

  it("distinguishes a gated office from a plain one", () => {
    // Same authority in a summary, very different situations: one goes through,
    // the other stops to ask a person.
    const states = buildingStates(granted(), OFFICES);
    expect(states.get("charge.get")?.authority).toBe("allowed");
    expect(states.get("charge.refund")?.authority).toBe("gated");
  });

  it("confers nothing while the scope is only proposed", () => {
    // Showing a proposal as `allowed` would tell the operator they had granted
    // something they have not.
    const states = buildingStates(granted({ status: "proposed" }), OFFICES);
    expect(states.get("charge.refund")?.authority).toBe("proposed");
  });

  it("grants nothing at all before any scope exists", () => {
    const states = buildingStates(initialLiveCityState, OFFICES);
    for (const office of OFFICES) {
      expect(states.get(office.office)?.authority).toBe("absent");
    }
  });

  it("carries the ceilings the scope set", () => {
    const states = buildingStates(granted(), OFFICES);
    expect(states.get("charge.refund")?.maxAmountMinor).toBe(4900);
    expect(states.get("charge.refund")?.callBudget).toBe(1);
    expect(states.get("charge.get")?.maxAmountMinor).toBeNull();
  });

  it("reports the exact records reachable, not just that some are", () => {
    // One charge and every charge look identical in a summary, which is the
    // whole difference the product is about.
    const states = buildingStates(granted(), OFFICES);
    expect(states.get("charge.get")?.resources).toEqual(["ch_184"]);
    expect(states.get("customer.list")?.resources).toEqual([]);
  });

  it("reports only the classes an office takes an argument for", () => {
    // Flattening every granted resource onto every building was wrong in the
    // worst direction: charge.refund claimed it could reach an email address it
    // has no argument for, overstating authority on the one screen whose entire
    // job is stating it precisely.
    const states = buildingStates(granted(), OFFICES);
    expect(states.get("charge.refund")?.resources).toEqual(["ch_184"]);
    expect(states.get("mail.send")?.resources).toEqual(["buyer@example.test"]);
  });

  it("closes every building once the scope expires", () => {
    // A closed scope is not a smaller scope. Buildings reporting their old
    // limits after expiry describe what the agent *used to* be able to do.
    const expired = granted({ scopeExpired: true });
    for (const office of OFFICES) {
      expect(buildingStates(expired, OFFICES).get(office.office)?.authority).toBe("absent");
    }
  });

  it("closes every building once the mission has finished", () => {
    const done = granted({ status: "completed" });
    expect(buildingStates(done, OFFICES).get("charge.refund")?.authority).toBe("absent");
  });
});

describe("activity", () => {
  const run = (events: Parameters<typeof reduceLiveCity>[1][]): LiveCityState =>
    events.reduce(reduceLiveCity, granted());

  it("is idle before anything happens", () => {
    expect(buildingStates(granted(), OFFICES).get("charge.get")?.activity).toBe("idle");
  });

  it("goes busy while the agent is there", () => {
    const state = run([
      { type: "world", event: { type: "agent.arrived", threadId: "main", office: "charge.get", at: 1 } },
    ]);
    expect(buildingStates(state, OFFICES).get("charge.get")?.activity).toBe("working");
  });

  it("counts a settled call and reports it done", () => {
    const state = run([
      { type: "world", event: { type: "agent.arrived", threadId: "main", office: "charge.get", at: 1 } },
      { type: "proxy", event: { type: "call.allowed", missionId: "m", office: "charge.get", district: "exchequer", sequence: 0, at: 2 } as never },
    ]);
    const building = buildingStates(state, OFFICES).get("charge.get");
    expect(building?.activity).toBe("done");
    expect(building?.callsUsed).toBe(1);
  });

  it("shows a refusal, with its reason", () => {
    const state = run([
      { type: "proxy", event: { type: "call.out_of_scope", missionId: "m", office: "customer.list", district: "exchequer", reason: "office_not_in_scope", detail: "not granted", at: 2 } as never },
    ]);
    const building = buildingStates(state, OFFICES).get("customer.list");
    expect(building?.activity).toBe("refused");
    expect(building?.refusal).toBe("not granted");
  });

  it("clears a refusal once a later call succeeds there", () => {
    // The agent tried something out of scope, was refused, then did something
    // permitted. Leaving the building red reports history as the present.
    const state = run([
      { type: "proxy", event: { type: "call.out_of_scope", missionId: "m", office: "charge.get", district: "exchequer", reason: "resource_not_in_scope", detail: "nope", at: 2 } as never },
      { type: "proxy", event: { type: "call.allowed", missionId: "m", office: "charge.get", district: "exchequer", sequence: 0, at: 3 } as never },
    ]);
    const building = buildingStates(state, OFFICES).get("charge.get");
    expect(building?.activity).toBe("done");
    expect(building?.refusal).toBeNull();
  });

  it("shows the office a gate is waiting on", () => {
    const state: LiveCityState = granted({
      gate: {
        toolCallId: "call-1",
        office: "charge.refund",
        district: "exchequer",
        args: { charge_id: "ch_184", amount: 4900 },
      } as never,
    });
    expect(buildingStates(state, OFFICES).get("charge.refund")?.activity).toBe("waiting");
  });

  it("shows every queued approval as waiting, not working", () => {
    const state: LiveCityState = granted({
      gate: {
        toolCallId: "call-1",
        office: "charge.refund",
        district: "exchequer",
        args: {},
      },
      pendingGates: [{
        toolCallId: "call-2",
        office: "mail.send",
        district: "post-house",
        args: {},
      }],
      officeActivity: {
        "charge.refund": { calls: 0, busy: true, refusal: null },
        "mail.send": { calls: 0, busy: true, refusal: null },
      },
    });

    expect(buildingStates(state, OFFICES).get("charge.refund")?.activity).toBe("waiting");
    expect(buildingStates(state, OFFICES).get("mail.send")?.activity).toBe("waiting");
  });
});
