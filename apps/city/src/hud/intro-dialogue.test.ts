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
  /*
   * These check the *wiring*, and only the wiring.
   *
   * What the dialogue does with a keystroke -- Escape dismisses, Tab wraps at
   * both ends, the container sends Tab inside, the middle is left to the
   * browser -- is `dialogueKeydown`, and it is exercised in
   * `focus-trap.test.ts` against stub controls that record being focused. Those
   * are tests that fail when the behaviour breaks.
   *
   * What is left for this file is that the component registers that handler and
   * hands it the right things, which a substring can establish and a unit test
   * cannot without a DOM. There is no jsdom in this workspace and pnpm cannot
   * install one here, so the remaining gap -- did anybody actually add the
   * listener -- is closed in a browser instead, and the results are quoted in
   * the pull request.
   */
  it("registers the shared handler rather than its own", () => {
    expect(intro).toContain("dialogueKeydown({");
    expect(intro).toContain('window.addEventListener("keydown", onKey)');
    expect(intro).toContain('window.removeEventListener("keydown", onKey)');
  });

  it("dismisses through the prop it was given", () => {
    expect(intro).toContain("dismiss: () => dismissRef.current()");
  });

  it("takes focus when it opens", () => {
    // Without a starting point inside the dialogue, the first Tab goes to
    // whatever was behind it.
    expect(intro).toContain("dialogRef.current?.focus()");
    expect(intro, "the box must be focusable to receive it").toContain("tabIndex={-1}");
  });

  it("counts its own controls, and not the container", () => {
    // The container is `tabIndex={-1}` and deliberately outside this query,
    // which is the case the first version of the trap fell through on.
    expect(intro).toContain("controls: () => [");
    expect(intro).toContain('button:not([tabindex="-1"])');
  });

  it("keeps Tab inside itself", () => {
    // A modal that lets focus walk out leaves a keyboard user tabbing through a
    // dialogue they cannot see, with no way back.
    //
    // The decision lives in `trapTarget` and is tested against every position
    // in `focus-trap.test.ts`. The first version of it was inline and only
    // wrapped when focus was already on the first or last control -- and this
    // dialogue takes focus on its own container, which is neither, so the very
    // first Shift+Tab after opening left the modal.
    expect(intro).toContain("dialogueKeydown({");
    expect(intro, "focus must be read from the document").toContain(
      "active: () => document.activeElement",
    );
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
    //
    // The crew dialogue does not have the container hole, for an accidental
    // reason: it focuses its close button on open, which *is* the first
    // control, so it happened to land in the case the old rule covered.
    for (const promise of ['event.key === "Escape"', "opener instanceof HTMLElement"]) {
      expect(crew, `the crew dialogue lost ${promise}`).toContain(promise);
    }
    expect(intro).toContain("opener instanceof HTMLElement");
  });
});
