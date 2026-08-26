import { useEffect, useRef, useState } from "react";
import { soundEngine } from "./sound-engine.js";

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

export type EffortLevel = "low" | "medium" | "high";

/**
 * Kept in step with `REASONING_EFFORTS` in `apps/demo/src/setup-models.ts`.
 *
 * Those are the levels registered against each slot, and the levels the harness
 * will accept. Adding one here without adding it there produces a dispatch that
 * is refused at session creation.
 */
export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high"];

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

export function CrewModal(props: {
  open: boolean;
  selected: EffortLevel;
  onSelect: (effort: EffortLevel) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<EffortLevel>(props.selected);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reopening shows what is actually set, not what was last abandoned.
  useEffect(() => {
    if (props.open) setDraft(props.selected);
  }, [props.open, props.selected]);

  useEffect(() => {
    if (!props.open) return;
    closeRef.current?.focus();

    /*
     * Escape closes, and Tab stays inside.
     *
     * A modal that lets focus walk out behind it leaves a keyboard user tabbing
     * through a dialog they cannot see and controls they cannot reach, with no
     * way back. Cycling within the dialog is the whole of the fix.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
  }, [props.open, props]);

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
        <div className="crew-modal-v2__thinking-grid" role="radiogroup" aria-labelledby="crew-modal-title">
          {EFFORT_LEVELS.map((level) => {
            const isSelected = draft === level;
            return (
              <button
                key={level}
                role="radio"
                aria-checked={isSelected}
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
