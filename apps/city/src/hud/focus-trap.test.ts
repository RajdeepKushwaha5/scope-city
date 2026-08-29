import { describe, expect, it } from "vitest";
import { dialogueKeydown, trapTarget } from "./focus-trap.js";

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

describe("what a dialogue does with a keystroke", () => {
  /** Three controls that record being focused, and a movable focus. */
  function dialogue(startOn: "container" | 0 | 1 | 2 = "container") {
    const focused: string[] = [];
    const controls = ["first", "middle", "last"].map((name) => ({
      name,
      focus: () => focused.push(name),
    }));
    let active: unknown = startOn === "container" ? { container: true } : controls[startOn];
    const dismissed: true[] = [];

    return {
      focused,
      dismissed,
      handler: dialogueKeydown({
        controls: () => controls,
        active: () => active,
        dismiss: () => dismissed.push(true),
      }),
      moveTo: (i: 0 | 1 | 2) => {
        active = controls[i];
      },
    };
  }

  const press = (key: string, shiftKey = false) => {
    const prevented: true[] = [];
    return { key, shiftKey, preventDefault: () => prevented.push(true), prevented };
  };

  it("dismisses on Escape", () => {
    const d = dialogue();
    d.handler(press("Escape"));
    expect(d.dismissed).toHaveLength(1);
  });

  it("ignores keys that are not its business", () => {
    const d = dialogue();
    for (const key of ["a", "Enter", "ArrowDown", " "]) d.handler(press(key));
    expect(d.dismissed).toHaveLength(0);
    expect(d.focused).toEqual([]);
  });

  it("sends the first Shift+Tab to the last control", () => {
    // The bug this was extracted for: focus starts on the container, which is
    // not one of the controls, and the old rule let it fall through to the
    // browser and out of the modal.
    const d = dialogue("container");
    const event = press("Tab", true);
    d.handler(event);

    expect(event.prevented, "the browser must not get this Tab").toHaveLength(1);
    expect(d.focused).toEqual(["last"]);
  });

  it("sends the first Tab to the first control", () => {
    const d = dialogue("container");
    const event = press("Tab");
    d.handler(event);
    expect(event.prevented).toHaveLength(1);
    expect(d.focused).toEqual(["first"]);
  });

  it("leaves the browser alone in the middle", () => {
    // Preventing the default here would break ordinary tabbing through a
    // dialogue with several controls, which is worse than the hole it closes.
    const d = dialogue(1);
    const event = press("Tab");
    d.handler(event);
    expect(event.prevented).toHaveLength(0);
    expect(d.focused).toEqual([]);
  });

  it("wraps at both ends", () => {
    const d = dialogue(2);
    d.handler(press("Tab"));
    expect(d.focused).toEqual(["first"]);

    d.moveTo(0);
    d.handler(press("Tab", true));
    expect(d.focused).toEqual(["first", "last"]);
  });

  it("does not strand anyone in a dialogue with nothing to focus", () => {
    const event = press("Tab");
    dialogueKeydown({ controls: () => [], active: () => null, dismiss: () => {} })(event);
    expect(event.prevented, "with no controls, the default is the only way out").toHaveLength(0);
  });
});
