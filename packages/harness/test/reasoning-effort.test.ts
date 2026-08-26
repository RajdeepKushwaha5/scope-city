import { describe, expect, it } from "vitest";
import { missionAgentSpec } from "../src/index.js";

const base = {
  model: "gemini-a/flash-a",
  proxyName: "scope-city-live",
  instructions: "do the job",
  gatedTools: ["charge.refund"],
  sandbox: false,
};

/**
 * The operator's effort has to reach the model spec.
 *
 * The control it replaced did not: a crew picker set React state, rendered a
 * portrait, and never touched the launch request. A selector that changes
 * nothing is worse than no selector, because it reports a setting the run does
 * not have.
 */
describe("thinking effort reaches the provider", () => {
  it("puts the operator's choice in the model params", () => {
    const spec = missionAgentSpec({ ...base, reasoningEffort: "high" });

    // camelCase, like every other key here: the SDK converts on the way out,
    // and a snake_case key is accepted and silently dropped.
    expect(spec.model.params).toEqual({ reasoningEffort: "high" });
  });

  it("omits params entirely when no effort was chosen", () => {
    // An empty `params` object is not the same as absent to every provider, and
    // "no preference" should send nothing rather than something empty.
    const spec = missionAgentSpec(base);

    expect(spec.model.params).toBeUndefined();
    expect(spec.model.name).toBe("gemini-a/flash-a");
  });

  it("leaves the rest of the spec alone", () => {
    // The effort must not disturb what actually enforces the boundary.
    const spec = missionAgentSpec({ ...base, reasoningEffort: "low" });

    expect(spec.mcpServers?.[0]?.requireApprovalForTools).toEqual(["charge.refund"]);
    expect(spec.config?.dynamicSubAgents?.enabled).toBe(true);
  });
});
