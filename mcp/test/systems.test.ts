import { describe, expect, it } from "vitest";
import { evaluate, project, type Scope } from "@scope-city/scope";
import {
  IRREVERSIBLE_OFFICES,
  MUTATING_OFFICES,
  OFFICE_SPECS,
  createOutbox,
  exchequerSystem,
  fixtureCharges,
  officeRegistry,
  postHouseSystem,
  recordsSystem,
} from "../src/index.js";

const NOW = 1_700_000_000_000;
const registry = officeRegistry();

function office(system: { offices: readonly { office: string; call: (a: Record<string, unknown>) => Promise<unknown> }[] }, id: string) {
  const handler = system.offices.find((o) => o.office === id);
  if (!handler) throw new Error(`no office ${id}`);
  return handler;
}

describe("Records", () => {
  it("returns the ticket including the body a customer controls", async () => {
    const result = (await office(recordsSystem(), "ticket.get").call({ ticket_id: "tkt_184" })) as {
      body: string;
    };
    expect(result.body).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
  });

  it("does not sanitise the injected text, because that is not where the defence lives", async () => {
    // If this ever starts stripping the attack, the demo stops proving
    // anything: the point is that the text arrives intact and is harmless.
    const result = (await office(recordsSystem(), "ticket.get").call({ ticket_id: "tkt_184" })) as {
      body: string;
    };
    expect(result.body).toContain("attacker@example.test");
  });

  it("rejects an unknown ticket", async () => {
    await expect(office(recordsSystem(), "ticket.get").call({ ticket_id: "nope" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("The Exchequer", () => {
  it("returns far more than a sensible scope should allow", async () => {
    const result = (await office(exchequerSystem(), "charge.get").call({
      charge_id: "ch_184",
    })) as { customer: { address: string; history: unknown[] } };

    expect(result.customer.address).toBeTruthy();
    expect(result.customer.history.length).toBeGreaterThan(0);
  });

  it("refunds and tracks the refunded total", async () => {
    const charges = fixtureCharges();
    const system = exchequerSystem(charges);
    await office(system, "charge.refund").call({ charge_id: "ch_184", amount: 2000 });
    expect(charges.get("ch_184")?.refundedMinor).toBe(2000);
  });

  it("refuses to refund more than remains", async () => {
    const system = exchequerSystem();
    await expect(
      office(system, "charge.refund").call({ charge_id: "ch_184", amount: 5000 }),
    ).rejects.toThrow(/only 4900 remains/);
  });

  it("refuses a non-integer amount", async () => {
    const system = exchequerSystem();
    await expect(
      office(system, "charge.refund").call({ charge_id: "ch_184", amount: 49.5 }),
    ).rejects.toThrow(/minor units/);
  });
});

describe("Post House", () => {
  it("records what was sent and returns only an id", async () => {
    const outbox = createOutbox();
    const result = await office(postHouseSystem(outbox), "mail.send").call({
      to: "customer@example.test",
      body: "Your refund is on its way.",
    });

    expect(result).toEqual({ id: "msg_1", to: "customer@example.test" });
    expect(outbox.sent).toHaveLength(1);
  });
});

describe("the registry lines up with the systems", () => {
  it("declares a spec for every office the systems expose", () => {
    const exposed = [
      ...recordsSystem().offices,
      ...exchequerSystem().offices,
      ...postHouseSystem().offices,
    ].map((o) => o.office);

    for (const id of exposed) {
      expect(registry.has(id), `no office spec for ${id}`).toBe(true);
    }
  });

  it("declares no spec for an office no system implements", () => {
    const exposed = new Set(
      [
        ...recordsSystem().offices,
        ...exchequerSystem().offices,
        ...postHouseSystem().offices,
      ].map((o) => o.office),
    );

    for (const spec of OFFICE_SPECS) {
      expect(exposed.has(spec.office), `${spec.office} is policed but unimplemented`).toBe(true);
    }
  });

  it("treats irreversible offices as a strict subset of mutating ones", () => {
    for (const id of IRREVERSIBLE_OFFICES) {
      expect(MUTATING_OFFICES).toContain(id);
    }
    // Closing a ticket mutates but can be undone, so the sets must differ.
    expect(MUTATING_OFFICES.length).toBeGreaterThan(IRREVERSIBLE_OFFICES.length);
  });
});

describe("end to end: a real response, policed by a real scope", () => {
  const scope: Scope = {
    missionId: "m_0123456789abcdef",
    scopeId: "SC-184",
    agent: "refund-agent",
    job: "Refund order #184",
    state: "active",
    offices: ["ticket.get", "charge.get", "charge.refund", "mail.send"],
    resources: {
      ticket_ids: ["tkt_184"],
      charge_ids: ["ch_184"],
      mail_to: ["customer@example.test"],
    },
    limits: {
      maxAmountMinor: { "charge.refund": 4900 },
      maxCalls: { "charge.refund": 1, "mail.send": 1 },
      maxResponseBytes: 64_000,
    },
    projection: {
      "ticket.get": ["id", "subject", "body", "order_id"],
      "charge.get": ["id", "amount", "customer.email"],
      "charge.refund": ["id", "charge_id", "amount", "status"],
      "mail.send": ["id", "to"],
    },
    countersignRequired: [...IRREVERSIBLE_OFFICES],
    expiresAt: NOW + 600_000,
    grantedBy: "operator:test",
    grantedAt: NOW,
    version: 1,
  };

  it("strips the address and history the Exchequer volunteered", async () => {
    const raw = await office(exchequerSystem(), "charge.get").call({ charge_id: "ch_184" });
    const projected = project({ scope, office: "charge.get", registry, response: raw });

    expect(projected.value).toEqual({
      id: "ch_184",
      amount: 4900,
      customer: { email: "customer@example.test" },
    });
    expect(projected.redacted).toEqual(
      expect.arrayContaining(["customer.address", "customer.history"]),
    );
  });

  it("refuses the refund the poisoned ticket is asking for", () => {
    const decision = evaluate({
      scope,
      call: { office: "charge.refund", args: { charge_id: "ch_185", amount: 39_900 }, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });

    expect(decision).toMatchObject({ allowed: false, reason: "resource_not_in_scope" });
  });

  it("refuses customer.list outright, since the scope never granted it", () => {
    const decision = evaluate({
      scope,
      call: { office: "customer.list", args: {}, attemptedAt: NOW },
      registry,
      consumed: {},
      now: NOW,
    });

    expect(decision).toMatchObject({ allowed: false, reason: "office_not_in_scope" });
  });
});
