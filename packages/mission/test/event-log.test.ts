import { describe, expect, it } from "vitest";
import type { WorldEvent } from "@scope-city/harness";
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

describe("the mission brief", () => {
  it("tells the agent a refusal is the answer, not an obstacle", async () => {
    const { missionBrief } = await import("../src/index.js");
    const brief = missionBrief({ ticketId: "tkt_184", sandbox: false });
    expect(brief).toMatch(/Do not retry a refused call with a\ndifferent id/);
  });

  it("only asks for verification when a sandbox actually exists", async () => {
    // Telling an agent to run a script it has no way to run wastes turns and
    // teaches it that instructions are approximate.
    const { missionBrief } = await import("../src/index.js");
    expect(missionBrief({ ticketId: "t", sandbox: false })).not.toMatch(/sandbox/i);
    expect(missionBrief({ ticketId: "t", sandbox: true })).toMatch(/Verify before you ask/);
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
