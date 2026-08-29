/**
 * Whether a keystroke should open the command palette.
 *
 * A predicate rather than a listener, because the listener could not be tested
 * and so was not. What stood in for a test asserted that `App.tsx` contained
 * the strings `setCommandOpen(true)`, `metaKey || event.ctrlKey` and
 * `onOpenCommand=` -- three substrings that can each exist while the shortcut
 * does nothing, since none of them is tied to the other two. It would have
 * passed on a handler that matched the keystroke and then returned.
 *
 * The decision is the part worth being sure about, so it lives here and is
 * exercised directly. What is left in the component is an event listener that
 * calls this and a state setter.
 */

/** The fields of a `KeyboardEvent` this decision reads. */
export interface Chord {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
}

/**
 * `modalOpen` is the guard, and it is the reason this takes a second argument
 * at all: the palette renders above everything, so opening it over the intro or
 * the crew sheet stacked one dialogue on another. Both key handlers stayed
 * bound underneath, so a single Escape dismissed two layers, and a palette
 * action ran against a screen the operator could not see.
 *
 * A modal is not a reason to swallow the keystroke, either. The page is a
 * canvas and Ctrl+F finds nothing, which is why this binding takes the key at
 * all -- but a dialogue has text in it, so when one is open the browser should
 * have the key back. The caller therefore preventDefaults only on true.
 */
export function opensCommandPalette(chord: Chord, modalOpen: boolean): boolean {
  if (modalOpen) return false;
  if (chord.key.toLowerCase() !== "k") return false;
  // AltGr is Ctrl+Alt on Windows, and on a layout where AltGr+K types a
  // character, taking the keystroke would eat the character instead.
  if (chord.altKey === true) return false;
  return chord.metaKey === true || chord.ctrlKey === true;
}

/**
 * Whether any dialogue is currently on screen.
 *
 * Asked of the document rather than of React state, because the sheet that
 * prompted this -- the crew roster -- keeps its own open state inside
 * `MissionOrder`. Lifting it to `App` just so a keyboard shortcut could see it
 * would spread one component's business across the tree; every modal already
 * announces itself as one for screen readers, so the guard reads the same
 * declaration.
 */
export function aModalIsOpen(root: ParentNode = document): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}
