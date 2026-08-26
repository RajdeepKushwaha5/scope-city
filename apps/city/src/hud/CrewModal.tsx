import { useEffect, useRef, useState } from "react";
import { REASONING_EFFORTS, type ReasoningEffort } from "@scope-city/harness";
import { soundEngine } from "./sound-engine.js";

export type EffortLevel = ReasoningEffort;

/**
 * How hard the model should think on this mission.
 *
 * This dialog began as a crew picker offering Opus, Sonnet and Haiku. None of
 * them is what runs: missions execute on `gemini-2.5-flash` across four
 * rotating keys, and the selection never reached the launch request at all --
 * it changed a portrait and some text in the panel and nothing else.
 *
 * That is the precise failure this whole project is an argument against. An
 * interface stating a capability the system does not have is the gap between
 * stated and actual authority, and putting one on the first screen would
 * undercut every claim the city makes behind it.
 *
 * So the identities are gone and what remains is real. The three levels here
 * are the ones the model slots declare in `setup-models.ts`; the choice travels
 * to `POST /api/missions`, into `model.params.reasoningEffort`, and on to the
 * provider. TrueForge validates it against what the model declares and refuses
 * the session with a 422 otherwise -- so an effort that cannot be honoured
 * fails loudly rather than becoming an effort that is quietly ignored.
 */

/**
 * The one list, imported rather than restated.
 *
 * These are the levels registered against each model slot and the levels the
 * harness will accept. Writing them out again here would let the dialog offer
 * something the slots do not declare, which produces a dispatch the operator
 * has already pressed and which then dies at session creation with a 422.
 */
export const EFFORT_LEVELS: readonly EffortLevel[] = REASONING_EFFORTS;

export function effortLabel(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
}

export function effortDescription(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Fewest thinking tokens. Fastest, and cheapest against a rate-limited key.";
    case "medium":
      return "A middle setting for ordinary work.";
    case "high":
      return "Most thinking tokens. Slower, and the first to exhaust a free-tier quota.";
  }
}

/**
 * Built from `BASE_URL`, not written as `/crew/...`.
 *
 * Judge mode is served from a repository subpath, where an absolute URL 404s.
 * The same reasoning as `RECORDING_URL` in App.tsx.
 */
export function effortSpriteUrl(effort: EffortLevel): string {
  return `${import.meta.env.BASE_URL}crew/effort-${effort}.png`;
}

/** The next level in a direction, stopping at the ends rather than wrapping. */
function step(current: EffortLevel, delta: number): EffortLevel {
  const at = EFFORT_LEVELS.indexOf(current);
  const next = Math.min(Math.max(at + delta, 0), EFFORT_LEVELS.length - 1);
  return EFFORT_LEVELS[next]!;
}

export function CrewModal(props: {
  open: boolean;
  selected: EffortLevel;
  onSelect: (effort: EffortLevel) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<EffortLevel>(props.selected);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const optionRefs = useRef(new Map<EffortLevel, HTMLButtonElement>());

  // Held in a ref so the key handler can read the latest without the effect
  // depending on it. See the note on the effect below.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  // Reopening shows what is actually set, not what was last abandoned.
  useEffect(() => {
    if (props.open) setDraft(props.selected);
  }, [props.open, props.selected]);

  /*
   * Focus goes in on open and comes back out on close.
   *
   * Depending on `props` here was a real bug rather than a lint nicety:
   * MissionOrder passes inline callbacks, so every parent rerender produced a
   * new props object, re-ran this effect, and yanked focus back to the close
   * button. A connection change or a mission-state tick would pull the keyboard
   * out from under whichever control the operator was actually using. The
   * dependency is now `props.open` alone, and the close callback is read
   * through a ref.
   *
   * Returning focus to the opener matters for the same reason it always does:
   * a dialog that dismisses to nowhere leaves a keyboard user back at the top
   * of the document, having lost their place.
   */
  useEffect(() => {
    if (!props.open) return;

    openerRef.current = document.activeElement;
    closeRef.current?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [props.open]);

  /*
   * Escape closes and Tab stays inside.
   *
   * The arrows are deliberately *not* here. Handled on `window` they fired
   * wherever the operator's focus happened to be -- pressing Down while tabbed
   * to Cancel silently changed the effort. They belong to the group that claims
   * the radio role, so they live on its own handler.
   *
   * A modal that lets focus walk out behind it leaves a keyboard user tabbing
   * through a dialog they cannot see and controls they cannot reach, with no
   * way back.
   *
   */
  useEffect(() => {
    if (!props.open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([tabindex="-1"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="dialogue-overlay" onClick={props.onClose}>
      <div
        className="dialogue-box crew-modal-v2"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crew-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="crew-modal-v2__header">
          <h2 id="crew-modal-title" className="crew-modal-v2__title">
            Thinking effort
          </h2>
          <button
            className="crew-modal-v2__close"
            ref={closeRef}
            onClick={props.onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="crew-modal-v2__subtitle">
          Sent with the mission and passed to the model. Every run uses{" "}
          <code>gemini-2.5-flash</code> across four rotating keys; this changes how
          much it thinks, not which model answers.
        </p>

        {/* A radiogroup, so the selection is announced rather than implied by
            colour alone. `aria-checked` is what tells a screen reader which of
            these is live; the highlight is only the sighted half of that. */}
        {/*
          The arrows belong here, not on the window.
          `role="radio"` promises that a screen-reader user moves through the
          group with the arrows and tabs past it as one stop, so the handler is
          scoped to the group that made the promise. On `window` it fired
          wherever focus happened to be, and Down while tabbed to Cancel changed
          the effort with nothing to show it had.
        */}
        <div
          className="crew-modal-v2__thinking-grid"
          role="radiogroup"
          aria-labelledby="crew-modal-title"
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (delta === 0) return;

            event.preventDefault();
            const next = step(draft, delta);
            setDraft(next);
            // Roving tabindex takes the tab stop away from the option that just
            // lost the selection, so without moving focus with it the keyboard
            // user is left on an element that is no longer reachable and the
            // next arrow press goes nowhere.
            optionRefs.current.get(next)?.focus();
          }}
        >
          {EFFORT_LEVELS.map((level) => {
            const isSelected = draft === level;
            return (
              <button
                key={level}
                ref={(node) => {
                  if (node) optionRefs.current.set(level, node);
                  else optionRefs.current.delete(level);
                }}
                role="radio"
                aria-checked={isSelected}
                // One tab stop for the whole group, which is the other half of
                // the radio contract: Tab moves past the options, the arrows
                // move between them.
                tabIndex={isSelected ? 0 : -1}
                className={`crew-modal-v2__card${isSelected ? " crew-modal-v2__card--selected" : ""}`}
                onClick={() => {
                  soundEngine.playClick();
                  setDraft(level);
                }}
              >
                <img
                  className="crew-modal-v2__card-img"
                  src={effortSpriteUrl(level)}
                  alt=""
                  width={72}
                  height={72}
                />
                <span className="crew-modal-v2__card-name">{effortLabel(level)}</span>
                <span className="crew-modal-v2__card-desc">{effortDescription(level)}</span>
              </button>
            );
          })}
        </div>

        <div className="crew-modal-v2__footer">
          <button type="button" className="crew-modal-v2__btn-cancel" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="crew-modal-v2__btn-confirm"
            onClick={() => {
              soundEngine.playClick();
              props.onSelect(draft);
              props.onClose();
            }}
          >
            Use {effortLabel(draft).toLowerCase()} effort
          </button>
        </div>
      </div>
    </div>
  );
}
