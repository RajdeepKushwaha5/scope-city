import { describe, expect, it } from "vitest";
import { LaunchGuard } from "./launch-guard.js";

describe("LaunchGuard", () => {
  it("invalidates a pending launch when the operator stops", () => {
    const guard = new LaunchGuard();
    const pending = guard.begin();
    guard.cancel();

    expect(guard.isCurrent(pending)).toBe(false);
  });

  it("only accepts the newest launch", () => {
    const guard = new LaunchGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});
