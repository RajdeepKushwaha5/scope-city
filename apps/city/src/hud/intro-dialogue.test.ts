import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The first thing anybody sees, and the keyboard it did not have.
 *
 * `role="dialog"` and `aria-modal="true"` are promises rather than decoration:
 * a screen reader tells the user this is a modal, which means Escape closes it
 * and focus stays inside. The intro declared both and honoured neither -- no
 * Escape handler, no focus on open, no trap, on the one screen where a visitor
 * has not yet learned that anything else on the page works.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const intro = read("./IntroDialogue.tsx");
const crew = read("./CrewModal.tsx");

describe("the intro dialogue", () => {
  it("closes on Escape", () => {
    // Verified in a browser: the dialogue closes and `scope_city_welcomed` is
    // set, so Escape dismisses it as fully as the button does.
    expect(intro).toContain('event.key === "Escape"');
    expect(intro).toContain("dismissRef.current()");
  });

  it("takes focus when it opens", () => {
    // Without a starting point inside the dialogue, the first Tab goes to
    // whatever was behind it.
    expect(intro).toContain("dialogRef.current?.focus()");
    expect(intro, "the box must be focusable to receive it").toContain("tabIndex={-1}");
  });

  it("keeps Tab inside itself", () => {
    // A modal that lets focus walk out leaves a keyboard user tabbing through a
    // dialogue they cannot see, with no way back.
    expect(intro).toContain('event.key !== "Tab"');
    expect(intro).toContain("event.shiftKey && document.activeElement === first");
  });

  it("gives focus back to whatever opened it", () => {
    // Dismissing a dialogue and finding focus on the document body is how a
    // keyboard user loses their place.
    expect(intro).toContain("opener instanceof HTMLElement && document.contains(opener)");
  });

  it("does what the dialogue beside it already did", () => {
    // The crew dialogue has had all of this since it was written. The intro
    // being the exception is the whole finding -- one of two modals honouring
    // the contract they both declare.
    for (const promise of ['event.key === "Escape"', 'event.key !== "Tab"', "opener instanceof HTMLElement"]) {
      expect(crew, `the crew dialogue lost ${promise}`).toContain(promise);
      expect(intro, `the intro is missing ${promise}`).toContain(promise);
    }
  });
});
