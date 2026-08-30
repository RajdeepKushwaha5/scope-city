import { describe, expect, it } from "vitest";
import { DEFAULT_ORDER } from "./MissionOrder.js";

describe("the default live mission", () => {
  it("states the refund ceiling instead of asking the scope compiler to invent it", () => {
    expect(DEFAULT_ORDER).toBe("Refund order #184 and notify its owner, max $49");
  });
});
