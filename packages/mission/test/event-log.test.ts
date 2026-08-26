import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@scope-city/harness";
import { buildRegistry } from "@scope-city/scope";
import { MissionEventLog, MissionOrchestrator } from "../src/index.js";

const NOW = 1_700_000_000_000;

const event = (n: number): WorldEvent => ({
  type: "transmission",
  threadId: "root",
  text: `line ${n}`,
  at: NOW,
});

describe("what did I miss", () => {
  it("gives a fresh client everything", () => {
    const log = new MissionEventLog();
    log.append(event(1), NOW);
    log.append(event(2), NOW);

    const replay = log.since(0);

    expect(replay.events).toHaveLength(2);
    expect(replay.cursor).toBe(2);
    expect(replay.truncated).toBe(false);
  });

  it("gives a returning client only what it missed", () => {
    const log = new MissionEventLog();
    for (let i = 1; i <= 5; i += 1) log.append(event(i), NOW);

    const replay = log.since(3);

    expect(replay.events.map((e) => e.sequence)).toEqual([4, 5]);
  });

  it("gives a caught-up client nothing rather than repeating the last one", () => {
    const log = new MissionEventLog();
    log.append(event(1), NOW);
    expect(log.since(1).events).toEqual([]);
  });

  it("numbers from one, so zero can mean 'I have nothing'", () => {
    // Treating "no events" and "event zero" as the same thing is where the
    // off-by-one in every resume protocol comes from.
    const log = new MissionEventLog();
    expect(log.append(event(1), NOW).sequence).toBe(1);
  });
});

describe("bounded memory", () => {
  it("drops the oldest events past capacity", () => {
    const log = new MissionEventLog(3);
    for (let i = 1; i <= 5; i += 1) log.append(event(i), NOW);

    expect(log.size).toBe(3);
    expect(log.latest).toBe(5);
    expect(log.lossy).toBe(true);
  });

  it("tells a client its cursor is too old instead of handing it a gap", () => {
    // Stitching a stream with a hole in it produces a city that is quietly
    // wrong. Saying "start over" is the honest answer.
    const log = new MissionEventLog(3);
    for (let i = 1; i <= 6; i += 1) log.append(event(i), NOW);

    const replay = log.since(1);

    expect(replay.truncated).toBe(true);
    expect(replay.events).toHaveLength(3);
  });

  it("tells a fresh client when the retained suffix is not the whole history", () => {
    const log = new MissionEventLog(2);
    for (let i = 1; i <= 4; i += 1) log.append(event(i), NOW);

    const replay = log.since(0);

    expect(replay.truncated).toBe(true);
    expect(replay.events.map((entry) => entry.sequence)).toEqual([3, 4]);
  });

  it("does not claim truncation for a client that is merely behind", () => {
    const log = new MissionEventLog(10);
    for (let i = 1; i <= 5; i += 1) log.append(event(i), NOW);
    expect(log.since(2).truncated).toBe(false);
  });
});

describe("a reconnected client rebuilds the same city", () => {
  it("reaches identical state from a replayed log", () => {
    // This is the property the whole resume story rests on, and it holds
    // because MissionOrchestrator owns no I/O -- feeding it the same events in
    // the same order cannot produce anything else.
    const log = new MissionEventLog();

    const live: WorldEvent[] = [];
    const original = new MissionOrchestrator({
      emit: (e) => {
        live.push(e);
        log.append(e, NOW);
      },
    });

    original.ingest({ type: "turn.created", turn_id: "t1" }, NOW);
    original.ingest(
      { type: "mcp.initialize", thread_id: null, mcp_servers: [{ name: "records" }] },
      NOW,
    );
    original.ingest({ type: "sandbox.created", thread_id: null, sandbox_id: "sb_1" }, NOW);

    // A client that reconnects has the log, not the harness events.
    const replayed = log.since(0).events.map((e) => e.event);

    expect(replayed).toEqual(live);
    expect(original.snapshot().sandboxOpen).toBe(true);
    expect(original.snapshot().districts).toEqual(["records"]);
  });
});

const briefScope = {
  missionId: "m".repeat(20),
  scopeId: "SC-184",
  agent: "support",
  job: "Refund order #184 and notify its owner",
  state: "granted",
  offices: ["charge.find_by_order", "charge.refund", "mail.send"],
  resources: { order_ids: ["ord_184"], charge_ids: ["ch_184"], mail_to: ["buyer@example.test"] },
  limits: {
    maxAmountMinor: { "charge.refund": 4900 },
    maxCalls: { "charge.refund": 1, "mail.send": 1 },
    maxResponseBytes: 64_000,
  },
  projection: { "charge.refund": ["id", "amount"] },
  countersignRequired: ["charge.refund", "mail.send"],
  expiresAt: 2_000_000,
  grantedBy: "operator",
  grantedAt: 1_000_000,
  version: 1,
} as const;

describe("the mission brief", () => {
  it("states the exact identifiers the scope granted", async () => {
    // The agent guessing `184` where the scope says `ord_184` produced a
    // refusal that looked like the boundary defending against something and
    // was really the briefing being wrong. Enforcement that fires because the
    // agent was misdirected proves nothing about enforcement.
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({ scope: briefScope, sandbox: false });

    expect(brief).toContain("ord_184");
    expect(brief).toContain("ch_184");
    expect(brief).toContain("buyer@example.test");
    expect(brief).toMatch(/exactly as written/i);
  });

  it("describes only the offices the scope actually granted", async () => {
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({ scope: briefScope, sandbox: false });

    expect(brief).toContain("charge.refund");
    // Never granted, so never mentioned. A brief naming an office the scope
    // withheld sends the agent at a door it has no key to.
    expect(brief).not.toContain("customer.list");
    expect(brief).not.toContain("ticket.get");
  });

  it("carries the ceilings and the gate, so the agent is not surprised by them", async () => {
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({ scope: briefScope, sandbox: false });

    expect(brief).toContain("4900");
    expect(brief).toMatch(/countersign/i);
  });

  it("uses the operator's own words for the job", async () => {
    const { missionBrief } = await import("../src/index.js");
    expect(missionBrief({ scope: briefScope, sandbox: false })).toContain(
      "Refund order #184 and notify its owner",
    );
  });

  it("tells the agent a refusal is the answer, not an obstacle", async () => {
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({ scope: briefScope, sandbox: false });
    // Whitespace collapsed before matching: asserting the exact line wrapping
    // made this fail on a rewrite that changed nothing about the meaning.
    const flat = brief.replace(/\s+/g, " ");
    expect(flat).toMatch(/Do not retry a refused call with a different id/);
    expect(flat).toMatch(/a refusal is the answer/i);
  });

  it("only asks for verification when a sandbox actually exists", async () => {
    // Telling an agent to run a script it has no way to run wastes turns and
    // teaches it that instructions are approximate.
    const { missionBrief } = await import("../src/index.js");
    expect(missionBrief({ scope: briefScope, sandbox: false })).not.toMatch(/sandbox/i);
    expect(missionBrief({ scope: briefScope, sandbox: true })).toMatch(/Verify before you ask/);
  });

  it("does not invent child threads without two proven read contracts", async () => {
    const { missionBrief } = await import("../src/index.js");
    expect(missionBrief({ scope: briefScope, sandbox: false })).not.toMatch(
      /Create two real child threads/,
    );
  });

  it("requires two real child threads when independent compatible reads are available", async () => {
    const { missionBrief } = await import("../src/index.js");
    const scope = {
      ...briefScope,
      offices: ["ticket.get", "charge.get", "charge.refund"],
      limits: { ...briefScope.limits, maxCalls: { "charge.refund": 1 } },
    } as never;

    const registry = buildRegistry([
      { office: "ticket.get", district: "records", mutating: false, args: {}, responseFields: ["id"], freeTextFields: [] },
      {
        office: "charge.get",
        district: "exchequer",
        mutating: false,
        args: {},
        responseFields: ["id", "amount", "refunded"],
        freeTextFields: [],
      },
      { office: "charge.refund", district: "exchequer", mutating: true, args: {}, responseFields: ["id"], freeTextFields: [] },
    ]);
    const brief = missionBrief({ scope, sandbox: true, registry });
    expect(brief).toMatch(/Use TrueForge dynamic subagents/);
    expect(brief).toContain("Source investigator — use ticket.get");
    expect(brief).toContain("Target verifier — use charge.get");
    expect(brief).toMatch(/Create two real child threads/);
    const flat = brief.replace(/\s+/g, " ");
    expect(flat).toMatch(/Combine both results in the root/i);
  });

  it("does not promise a boundary between threads that nothing enforces", async () => {
    // TrueForge children inherit the session's tools and the proxy gets no
    // thread identity, so "children must not act" is an instruction rather than
    // a property. Asserting the substance instead of a phrase: the brief has to
    // say that nothing stops a child, and name the thing that actually does.
    const { missionBrief } = await import("../src/index.js");
    const scope = {
      ...briefScope,
      offices: ["ticket.get", "charge.get", "charge.refund"],
      limits: { ...briefScope.limits, maxCalls: { "charge.refund": 1 } },
    } as never;

    const registry = buildRegistry([
      { office: "ticket.get", district: "records", mutating: false, args: {}, responseFields: ["id"], freeTextFields: [] },
      {
        office: "charge.get",
        district: "exchequer",
        mutating: false,
        args: {},
        // The planner will only nominate a target verifier that can actually
        // report an amount and a prior-action state, so the fixture has to
        // expose them or no delegation is planned at all.
        responseFields: ["id", "amount", "refunded"],
        freeTextFields: [],
      },
      { office: "charge.refund", district: "exchequer", mutating: true, args: {}, responseFields: ["id"], freeTextFields: [] },
    ]);

    const flat = missionBrief({ scope, sandbox: false, registry }).replace(/\s+/g, " ");

    expect(flat).toMatch(/not a capability boundary/i);
    expect(flat).toMatch(/Nothing here stops a child acting/i);
    // And what does: the scope, named explicitly rather than left implied.
    expect(flat).toMatch(/quota is claimed atomically/i);
    expect(flat).toMatch(/same gate whichever thread makes it/i);
  });
});

describe("readVerdict — an unreadable check is a failed check", () => {
  it("accepts a clear pass", async () => {
    const { readVerdict } = await import("../src/index.js");
    expect(readVerdict("amounts match: OK")).toBe(true);
  });

  it("rejects a clear failure", async () => {
    const { readVerdict } = await import("../src/index.js");
    expect(readVerdict("MISMATCH: ticket says 4900, charge says 39900")).toBe(false);
  });

  it("rejects a traceback even if the word 'ok' appears in it", async () => {
    const { readVerdict } = await import("../src/index.js");
    expect(readVerdict("Traceback...\nAssertionError: not ok")).toBe(false);
  });

  it("rejects output it cannot read a verdict from", async () => {
    // Defaulting to "probably fine" in the one place a human is relying on the
    // check would be the worst possible default.
    const { readVerdict } = await import("../src/index.js");
    expect(readVerdict("script finished")).toBe(false);
    expect(readVerdict("")).toBe(false);
  });
});
