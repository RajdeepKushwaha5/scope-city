import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyFailure, isWorthRotating } from "@scope-city/harness";
import { isWorkEvent, shouldKeepSession } from "../src/resume-policy.js";

/**
 * A rate limit ends the turn, not the session.
 *
 * Delegated missions could not finish because every rotation created a new
 * session and threw away everything the agent had established. Availability
 * rotated; work did not. One measured run: seven attempts, six rotations,
 * thirty-one arrivals, no gate.
 */
const server = readFileSync(
  fileURLToPath(new URL("../src/live-server.ts", import.meta.url)),
  "utf8",
);
const run = readFileSync(
  fileURLToPath(new URL("../src/mission-run.ts", import.meta.url)),
  "utf8",
);

describe("which failures are worth waiting for", () => {
  it("treats a 429 as a rate limit", () => {
    expect(classifyFailure({ statusCode: 429 })).toBe("rate_limited");
    // The provider's own wording, underscored, which is what actually arrives.
    expect(classifyFailure(new Error("resource_exhausted"))).toBe("rate_limited");
    expect(classifyFailure(new Error("Rate limit reached"))).toBe("rate_limited");
  });

  it("does not confuse an exhausted quota with a busy minute", () => {
    // A daily quota will not come back within a demo. Holding a session open
    // for it would waste the wait budget on a key that is finished.
    expect(classifyFailure(new Error("You exceeded your current quota"))).toBe("quota_exhausted");
    expect(classifyFailure(new Error("invalid api key"))).not.toBe("rate_limited");
  });

  it("still rotates on failures that waiting cannot fix", () => {
    expect(isWorthRotating("other")).toBe(false);
    expect(isWorthRotating("rate_limited")).toBe(true);
  });
});

describe("the policy that decides whether to keep a session", () => {
  const session = "s_1";

  it("holds one only for a rate limit", () => {
    // A rejected credential, an exhausted quota or a malformed spec will fail
    // the same way after any wait.
    expect(shouldKeepSession({ kind: "rate_limited", didWork: true, sessionId: session })).toBe(true);

    for (const kind of ["quota_exhausted", "credential_rejected", "unavailable", "other"] as const) {
      expect(shouldKeepSession({ kind, didWork: true, sessionId: session }), kind).toBe(false);
    }
  });

  it("requires the agent to have actually done something", () => {
    // A session that fell over before doing anything holds nothing worth
    // carrying, and keeping it pins the mission to a cooling key for no gain.
    expect(shouldKeepSession({ kind: "rate_limited", didWork: false, sessionId: session })).toBe(false);
  });

  it("needs a session to keep", () => {
    expect(shouldKeepSession({ kind: "rate_limited", didWork: true, sessionId: undefined })).toBe(false);
  });

  it("does not count the control plane narrating itself as work", () => {
    // `mission.status` goes onto the same feed, and "running" is published
    // before the turn starts -- so a cursor comparison called every attempt
    // productive, including one whose first call failed.
    expect(isWorkEvent("mission.status")).toBe(false);
    for (const type of ["agent.arrived", "gate.raised", "yard.verified", "field.joined"]) {
      expect(isWorkEvent(type), type).toBe(true);
    }
  });

  it("is decided by a pure function rather than inline", () => {
    // It has three conditions that each look obviously right and are each wrong
    // in a different direction. Testing them needed no control plane.
    expect(server).toContain("shouldKeepSession({");
    expect(server).toContain("didWork: didWorkThisAttempt");
  });

  it("does not cancel a session it means to keep", () => {
    // Cancelling and then resuming would resume nothing.
    expect(server).toContain("if (attemptSessionId && !keepSession)");
  });

  it("still penalises the model, so the pool waits for it", () => {
    expect(server).toContain("pool.penalise(model, kind, Date.now())");
  });
});

describe("a resumed session is not asked to start again", () => {
  it("sends a continuation rather than the brief", () => {
    // TrueForge keeps the conversation, so re-sending the order would set an
    // agent going from the beginning on a session that remembers doing it.
    expect(run).toContain("options.resuming");
    expect(run).toMatch(/Continue from where you stopped/);
    expect(run).toMatch(/Do not repeat work you have already done/);
  });

  it("sends the brief on a first attempt", () => {
    expect(run).toContain("? \"You were interrupted.");
    expect(run).toContain(": options.prompt;");
  });

  it("is only set when the control plane actually resumed one", () => {
    expect(server).toContain("resuming: resumedThisAttempt");
    expect(server).toContain("resumedThisAttempt = true");
  });
});

describe("a resumed session stays on its own model", () => {
  it("does not let the pool pick a different one", () => {
    // An agent spec names its model at creation and cannot be re-pointed, so a
    // resumed session runs on the model it started with. Letting the loop
    // choose meant the pool credited and blamed a model the session never used.
    //
    // Matched on the coalesce rather than its whole expression, which was
    // pinning an argument that had nothing to do with model choice: passing
    // the attempt's start time to `pool.next` -- so a slow success cannot
    // clear a newer cooldown -- reflowed the line and failed this test.
    expect(server).toMatch(/resume\?\.model \?\? pool\.next\(/);
    // Matched on the fields rather than the whole expression, which was
    // pinning the formatting: adding the translator to what a held session
    // carries reflowed the line and failed a test about model choice.
    expect(server).toMatch(/resume = \{[\s\S]{0,200}?sessionId: attemptSessionId,[\s\S]{0,120}?model,/);
  });

  it("carries the reading of the session, not only the session", () => {
    // A fresh translator cannot pair a completion with a start it never saw,
    // so a sandbox result arriving after the resume loses the office it
    // belongs to -- and with it the yard.verified the operator reads before
    // countersigning.
    expect(server).toContain("translator: translator ?? initialState()");
    expect(server).toMatch(/\.\.\.\(translator \? \{ translator \} : \{\}\)/);
  });

  it("does not forget earlier work when a held session is limited again", () => {
    // Progress belongs to the session. Starting each attempt at false meant a
    // second immediate rate limit cancelled a session holding everything the
    // mission had achieved.
    expect(server).toContain("let didWorkThisAttempt = resume !== undefined;");
  });

  it("cancels a held session that is never picked up", () => {
    // Falling out of the loop with one open leaks it for as long as the
    // instance runs.
    expect(server).toMatch(/if \(resume !== undefined\) \{[\s\S]{0,200}driver\.cancel\(resume\.sessionId\)/);
  });

  it("does not put an answered gate back in front of the operator", () => {
    // The harness replays what it was doing, so a settled gate can arrive
    // again -- and a repeat is indistinguishable from a genuine second request.
    expect(run).toContain("book.settled(worldEvent.toolCallId)");
  });
});
