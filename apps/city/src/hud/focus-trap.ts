/**
 * Where Tab should go inside a modal dialogue.
 *
 * Extracted as a decision rather than left inline, because the inline version
 * had a hole that source-reading could not show and a screenshot could not
 * either: it wrapped only when focus was already on the first or last control
 * in the dialogue. A dialogue that takes focus on its own container -- which is
 * what you do when the first thing inside it is text rather than a button --
 * starts outside that set, so the very first Shift+Tab followed the browser
 * default straight out of the modal and onto whatever was behind it.
 *
 * The rule is about the boundary, not about two particular elements: if focus
 * is not on a control inside the dialogue, Tab belongs at one end of it.
 */

export interface TrapQuery {
  /** Was Shift held. */
  readonly shiftKey: boolean;
  /** Is the focused element one of the dialogue's own focusable controls. */
  readonly onControl: boolean;
  /** Is it the first of them. */
  readonly onFirst: boolean;
  /** Is it the last of them. */
  readonly onLast: boolean;
}

/**
 * `null` means leave it alone: focus is in the middle of the dialogue and the
 * browser's own order is correct. Anything else is the end to jump to.
 */
export function trapTarget(query: TrapQuery): "first" | "last" | null {
  // Focus is on the container, or has somehow left the dialogue. Either way it
  // is not on a control, so the next Tab has no natural neighbour inside and
  // the browser would take it outside.
  if (!query.onControl) return query.shiftKey ? "last" : "first";

  if (query.shiftKey && query.onFirst) return "last";
  if (!query.shiftKey && query.onLast) return "first";
  return null;
}

/**
 * The keydown behaviour of a modal dialogue, as a function of its own contents.
 *
 * Extracted so it can be exercised rather than read. The rule above says where
 * Tab belongs; this says what actually happens to an event -- whether Escape
 * dismisses, whether the default is prevented, and which element is focused --
 * and those are the four promises `aria-modal` makes.
 *
 * It takes a description of the dialogue instead of the dialogue, so a test can
 * supply three objects that count how often they were focused. What it cannot
 * check is that anybody registered it as a listener; that is asserted against
 * the component source, and confirmed in a browser.
 */
export interface DialogueKeys {
  /** Focusable controls inside the dialogue, in tab order. */
  readonly controls: () => readonly { focus: () => void }[];
  /** Whatever currently has focus, which may be the container or nothing. */
  readonly active: () => unknown;
  /** Called when Escape is pressed. */
  readonly dismiss: () => void;
}

export interface KeyEvent {
  readonly key: string;
  readonly shiftKey?: boolean;
  preventDefault: () => void;
}

export function dialogueKeydown(dialogue: DialogueKeys): (event: KeyEvent) => void {
  return (event) => {
    if (event.key === "Escape") {
      dialogue.dismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = dialogue.controls();
    // Nothing to trap focus among. Preventing the default here would strand a
    // keyboard user inside a dialogue with no way to move at all.
    if (controls.length === 0) return;

    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    const active = dialogue.active();

    const target = trapTarget({
      shiftKey: event.shiftKey === true,
      onControl: controls.some((candidate) => candidate === active),
      onFirst: active === first,
      onLast: active === last,
    });
    if (target === null) return;

    event.preventDefault();
    (target === "first" ? first : last).focus();
  };
}
