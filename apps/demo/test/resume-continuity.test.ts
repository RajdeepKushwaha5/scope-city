import { describe, expect, it } from "vitest";
import { initialState, translate } from "@scope-city/harness";
import { shouldKeepSession } from "../src/resume-policy.js";

/**
 * What a resumed session has to keep hold of.
 *
 * Holding the session was the easy half. The harder half is that state on this
 * side was scoped to a turn while the thing it describes -- work done, threads
 * opened, calls started -- belongs to the session. Each case failed silently:
 * the mission carried on and showed the operator something untrue.
 */
describe("work belongs to the session, not the turn", () => {
  it("keeps a session that worked in an earlier attempt and not in this one", () => {
    // The case that undoes the whole feature. A held session is resumed, the
    // key is still cooling, and the turn dies before emitting anything new.
    // Reading progress from that turn alone says "nothing here" and cancels a
    // session holding everything the mission has achieved.
    expect(shouldKeepSession({ kind: "rate_limited", didWork: true, sessionId: "s-1" })).toBe(true);
  });

  it("still refuses to hold a session that has never done anything", () => {
    expect(shouldKeepSession({ kind: "rate_limited", didWork: false, sessionId: "s-1" })).toBe(
      false,
    );
  });
});

describe("the reading of the session continues with it", () => {
  // A delegated thread that opens a sandbox and runs a check -- the shape the
  // recording actually has, not an invented one.
  const started = (threadId: string, toolCallId: string) => {
    let state = initialState();
    for (const event of [
      { type: "thread.created", thread_id: threadId, parent: "root", title: "Target verifier" },
      {
        type: "model.message",
        id: "m-1",
        thread_id: threadId,
        tool_calls: [
          { tool_call_id: toolCallId, name: "bash", arguments: { command: "python3 -c ..." } },
        ],
      },
    ]) {
      state = translate(event as never, state, 1).state;
    }
    return state;
  };

  const response = {
    type: "tool.response",
    thread_id: "th-1",
    tool_call_id: "tc-1",
    content: "PASS",
  };

  it("drops a completion when the reader starts over", () => {
    // The bug, stated plainly. A fresh translator never saw the start, so it
    // cannot say what finished -- and says nothing at all.
    expect(translate(response as never, initialState(), 2).events).toEqual([]);
  });

  it("matches a completion that arrives after the interruption", () => {
    // The session was rate limited between the call and its result, waited out
    // the key, and resumed. The result arrives on the next attempt.
    const after = translate(response as never, started("th-1", "tc-1"), 2);

    const types = after.events.map((event) => event.type);
    expect(types).toContain("agent.finished");
    // The one that matters. `yard.verified` is what the operator reads before
    // countersigning, so losing it means approving an irreversible transfer
    // with its verification invisible.
    expect(types).toContain("yard.verified");
  });

  it("lets a subagent leave the map after the interruption", () => {
    const state = started("th-1", "tc-1");

    const after = translate({ type: "thread.done", thread_id: "th-1" } as never, state, 2);
    expect(after.events.map((event) => event.type)).toContain("field.left");

    // Without the carried state the thread is unknown and the departure is
    // dropped, leaving a delegated agent shown as working forever.
    const fresh = translate({ type: "thread.done", thread_id: "th-1" } as never, initialState(), 2);
    expect(fresh.events).toEqual([]);
  });
});
