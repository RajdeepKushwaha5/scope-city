import { useEffect, useRef } from "react";
import { soundEngine } from "./sound-engine.js";

export function IntroDialogue(props: {
  open: boolean;
  onDismiss: () => void;
  onSelectOption: (option: "recorded" | "clean" | "poisoned" | "explore") => void;
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dismissRef = useRef(props.onDismiss);
  dismissRef.current = props.onDismiss;

  /*
   * Escape closes it, and Tab stays inside.
   *
   * This is the first thing anybody sees, and it ignored the keyboard
   * entirely -- no Escape, no focus, no trap. A visitor pressing the universal
   * "close this" got nothing, on the one screen where they have not yet learned
   * that anything else works.
   *
   * It also claims `role="dialog"` and `aria-modal="true"`, which are promises
   * rather than decoration: a screen reader tells the user this is a modal, and
   * a modal that lets focus walk out behind it leaves them tabbing through a
   * dialogue they cannot see, with no way back. The crew dialogue has done this
   * since it was written; the intro was the one that did not.
   */
  useEffect(() => {
    if (!props.open) return;

    const opener = document.activeElement;
    dialogRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissRef.current();
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
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back where they were. Dismissing a dialogue and finding focus on the
      // document body is how a keyboard user loses their place.
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="dialogue-overlay">
      {/* Declared so a screen reader treats this as the modal it looks like,
          and so the Ctrl+K guard can see it without App having to be told. */}
      <div
        className="dialogue-box"
        ref={dialogRef}
        // Focusable so the dialogue itself can take focus on open. Without a
        // starting point inside it, the first Tab goes to whatever was behind.
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="What am I looking at?"
      >
        <div className="dialogue-speaker">
          <div className="dialogue-avatar" aria-hidden="true">
            <span className="dialogue-avatar__hat" />
            <span className="dialogue-avatar__face" />
            <span className="dialogue-avatar__coat" />
          </div>
          <span className="dialogue-speaker__name">BOUNDARY AGENT</span>
        </div>

        <div className="dialogue-content">
          <h2 className="dialogue-title">Welcome to Scope City</h2>
          <p className="dialogue-text">
            In Scope City, AI agents are bounded by mathematical reach: we don&rsquo;t just tell the agent
            &ldquo;no&rdquo;&mdash;systems outside the granted scope are entirely <strong>absent</strong>.
            Irreversible actions pause at <strong>The Gate</strong> for your countersign.
          </p>

          <div className="dialogue-choices">
            <button
              type="button"
              className="dialogue-choice dialogue-choice--primary"
              onClick={() => {
                soundEngine.playClick();
                props.onSelectOption("recorded");
              }}
            >
              <span className="dialogue-cursor">&gt;</span>
              <strong>Replay a real live run</strong>
              <small>Verified hash-chain of refund #184 with true TrueForge session</small>
            </button>

            <button
              type="button"
              className="dialogue-choice"
              onClick={() => {
                soundEngine.playClick();
                props.onSelectOption("poisoned");
              }}
            >
              <span className="dialogue-cursor">&gt;</span>
              <strong>Test poisoned ticket containment</strong>
              <small>Demonstrate how prompt injection fails against an absent tool</small>
            </button>

            <button
              type="button"
              className="dialogue-choice"
              onClick={() => {
                soundEngine.playClick();
                props.onSelectOption("explore");
              }}
            >
              <span className="dialogue-cursor">&gt;</span>
              <strong>Explore the island directly</strong>
              <small>Inspect districts, review authorities, and dispatch orders</small>
            </button>
          </div>

          <div className="dialogue-foot">
            <span>Press any choice to enter &bull; Click anywhere on canvas to dismiss</span>
          </div>
        </div>
      </div>
    </div>
  );
}
