import { describe, expect, it } from "vitest";
import { aModalIsOpen, opensCommandPalette } from "./command-shortcut.js";

/**
 * The palette is the only way to reach the over-reach run, which has no button
 * of its own, so "can this be opened" is a question with a real answer riding
 * on it. It was previously asked of the source text of `App.tsx`.
 */
describe("the command palette shortcut", () => {
  it("opens on Ctrl+K", () => {
    expect(opensCommandPalette({ key: "k", ctrlKey: true }, false)).toBe(true);
  });

  it("opens on Cmd+K", () => {
    expect(opensCommandPalette({ key: "k", metaKey: true }, false)).toBe(true);
  });

  it("does not care which case the key arrives in", () => {
    // Shift is not part of the binding, but a caps-locked keyboard sends "K".
    expect(opensCommandPalette({ key: "K", ctrlKey: true }, false)).toBe(true);
  });

  it("ignores K on its own", () => {
    // The city has single-key controls of its own and the map takes focus.
    expect(opensCommandPalette({ key: "k" }, false)).toBe(false);
  });

  it("ignores a modifier with another key", () => {
    expect(opensCommandPalette({ key: "s", ctrlKey: true }, false)).toBe(false);
  });

  it("leaves AltGr+K alone", () => {
    // AltGr is Ctrl+Alt on Windows. On a layout where that types a character,
    // claiming the chord would swallow the character -- and the operator is
    // typing into the mission order, which is a text field.
    expect(opensCommandPalette({ key: "k", ctrlKey: true, altKey: true }, false)).toBe(false);
  });

  it("stays shut while another dialogue is open", () => {
    // The bug. The palette renders above everything, so this stacked it over
    // the intro and the crew sheet, left both of their key handlers bound
    // underneath -- one Escape closing two layers -- and let a palette action
    // run against a screen nobody could see.
    expect(opensCommandPalette({ key: "k", ctrlKey: true }, true)).toBe(false);
  });
});

describe("noticing that a dialogue is open", () => {
  /** A DOM stub, since this is asked of the document rather than of state. */
  const withModal = (open: boolean): ParentNode =>
    ({ querySelector: (sel: string) => (open && sel.includes("aria-modal") ? {} : null) }) as ParentNode;

  it("finds a modal by the attribute it already declares", () => {
    expect(aModalIsOpen(withModal(true))).toBe(true);
  });

  it("reports none when there is none", () => {
    expect(aModalIsOpen(withModal(false))).toBe(false);
  });
});
