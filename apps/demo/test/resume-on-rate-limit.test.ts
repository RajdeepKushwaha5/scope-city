import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyFailure, isWorthRotating } from "@scope-city/harness";

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

describe("the control plane keeps a session that did something", () => {
  it("holds it only for a rate limit", () => {
    // A rejected credential, an exhausted quota or a malformed spec will fail
    // the same way after any wait.
    expect(server).toContain('kind === "rate_limited" && progressed');
  });

  it("requires the attempt to have progressed", () => {
    // A session that fell over before doing anything holds nothing worth
    // carrying, so there is no reason to prefer it over the next model.
    expect(server).toContain("const feedBeforeAttempt = live.feed.latest");
    expect(server).toContain("live.feed.latest > feedBeforeAttempt");
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
