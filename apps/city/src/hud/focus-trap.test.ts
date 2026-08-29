import { describe, expect, it } from "vitest";
import { trapTarget } from "./focus-trap.js";

/**
 * The hole this exists to close: a dialogue that takes focus on its own
 * container starts outside the set of controls the trap was watching, so the
 * first Shift+Tab escaped the modal entirely.
 */

const at = (over: Partial<Parameters<typeof trapTarget>[0]>) =>
  trapTarget({ shiftKey: false, onControl: true, onFirst: false, onLast: false, ...over });

describe("where Tab goes inside a dialogue", () => {
  it("wraps forward off the last control", () => {
    expect(at({ onLast: true })).toBe("first");
  });

  it("wraps backward off the first control", () => {
    expect(at({ shiftKey: true, onFirst: true })).toBe("last");
  });

  it("leaves the middle alone", () => {
    // The browser's own order is correct there, and preventing it would break
    // ordinary tabbing through a dialogue with several controls.
    expect(at({})).toBeNull();
    expect(at({ shiftKey: true })).toBeNull();
  });

  it("catches focus that is on the dialogue itself", () => {
    // The bug. The intro focuses its container, because the first thing inside
    // it is prose rather than a button -- and the container is deliberately not
    // one of the focusable controls. The old rule only fired on `first` and
    // `last`, so this case fell through to the browser and left the modal.
    expect(at({ onControl: false, shiftKey: true })).toBe("last");
    expect(at({ onControl: false })).toBe("first");
  });

  it("catches focus that has already escaped", () => {
    // Same answer, and the same reason: whatever is focused is not a control in
    // this dialogue, so Tab belongs at one end of it.
    expect(at({ onControl: false, onFirst: false, onLast: false })).toBe("first");
  });

  it("does not treat first and last as the same control", () => {
    // A dialogue with exactly one focusable control: both directions wrap onto
    // it, and neither should return null and let focus out.
    expect(at({ onFirst: true, onLast: true })).toBe("first");
    expect(at({ onFirst: true, onLast: true, shiftKey: true })).toBe("last");
  });
});
