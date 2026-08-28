import { describe, expect, it } from "vitest";
import { missionAgentSpec } from "../src/index.js";

const base = {
  model: "gemini-a/flash-a",
  proxyName: "scope-city-live",
  instructions: "brief",
  gatedTools: ["charge.refund"],
  sandbox: true,
};

/**
 * Two harness features are on by default and were running unstated.
 *
 * Confirmed by asking the server what it stores for this exact spec: with no
 * `contextManagement` sent it comes back holding compaction and large tool
 * response offloading both enabled. A project whose argument is "state what the
 * agent may do" should not be relying on defaults that change what the model
 * sees and where tool output is kept.
 */
describe("what the spec says about context", () => {
  it("declares compaction rather than inheriting it", () => {
    const spec = missionAgentSpec(base);

    expect(spec.config?.contextManagement?.compaction?.enabled).toBe(true);
  });

  it("declares large tool response offloading", () => {
    // On by default and requires the sandbox, which every mission enables --
    // so it has been live on every run this project has ever done.
    const spec = missionAgentSpec(base);

    expect(spec.config?.contextManagement?.largeToolResponse?.enabled).toBe(true);
  });

  it("sends no compaction trigger, because the server discards it", () => {
    // The documentation describes `compaction.trigger`, and this server drops
    // it: an agent created with a non-default 40000 comes back holding only
    // `enabled`. Sending it would be a setting that reads as configured and is
    // not -- the same trap as writing snake_case keys the SDK silently drops.
    const compaction = missionAgentSpec(base).config?.contextManagement?.compaction;

    expect(compaction).toEqual({ enabled: true });
    expect(compaction).not.toHaveProperty("trigger");
  });

  it("keeps the settings that make the display trustworthy off", () => {
    // Not context management, but the same question: these are on by default
    // too, and both hand the model a channel to the operator. Pinned here so
    // a future default change cannot quietly switch them on.
    const config = missionAgentSpec(base).config;

    expect(config?.generativeUi?.enabled).toBe(false);
    expect(config?.askUserQuestions?.enabled).toBe(false);
  });

  it("still scales the turn budget with the effort", () => {
    // The new block sits beside iterationLimit; a merge that dropped one would
    // otherwise pass every other test in this file.
    expect(missionAgentSpec({ ...base, reasoningEffort: "low" }).config?.iterationLimit).toBe(12);
  });
});
