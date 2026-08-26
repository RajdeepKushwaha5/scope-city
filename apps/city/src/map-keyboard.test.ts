import { describe, expect, it } from "vitest";
import { nextOfficeIndex } from "./map-keyboard.js";

describe("map keyboard navigation", () => {
  it("does nothing when there are no offices or the key is unrelated", () => {
    expect(nextOfficeIndex("ArrowRight", -1, 0)).toBeNull();
    expect(nextOfficeIndex("Enter", 0, 4)).toBeNull();
  });

  it("enters, advances, wraps, and jumps through every office", () => {
    expect(nextOfficeIndex("ArrowRight", -1, 4)).toBe(0);
    expect(nextOfficeIndex("ArrowRight", 3, 4)).toBe(0);
    expect(nextOfficeIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextOfficeIndex("Home", 2, 4)).toBe(0);
    expect(nextOfficeIndex("End", 1, 4)).toBe(3);
  });
});
