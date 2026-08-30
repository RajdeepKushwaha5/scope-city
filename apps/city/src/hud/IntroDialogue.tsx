import { useEffect, useRef } from "react";
import { soundEngine } from "./sound-engine.js";
import { dialogueKeydown } from "./focus-trap.js";

/**
 * The Boundary Agent's mark, drawn rather than stacked out of coloured boxes.
 *
 * This was three `<span>`s -- an amber bar for a hat, a cream 10x10 square for
 * a face, a navy 20x10 rectangle for a coat -- in a 32px box. At that size the
 * shapes do not resolve into a person; they resolve into a pale square on a
 * blue rectangle, which is what a browser draws when an image fails to load.
 * The first thing a judge sees on opening the city looked broken.
 *
 * What it draws now is the product rather than a mascot: a figure standing
 * inside a boundary. The square is the granted scope, the figure is the agent
 * inside it, and the gap between them is the whole argument -- the agent is not
 * being told "no" at the wall, it is simply not outside it.
 *
 * Geometry sits on half-pixel centres so the 1px strokes land on device pixels
 * instead of straddling two and rendering grey.
 */
function BoundaryAgentMark(): React.JSX.Element {
  return (
    <svg
      className="dialogue-avatar"
      viewBox="0 0 32 32"
      width={32}
      height={32}
      // Decorative: the name is written beside it in text.
      aria-hidden="true"
      focusable="false"
    >
      {/* The scope. Drawn first, so the figure sits inside it. */}
      <rect
        x={2.5}
        y={2.5}
        width={27}
        height={27}
        fill="#030c14"
        stroke="var(--hud-amber)"
        strokeWidth={1}
      />
      {/* The agent: head and shoulders, clear of the boundary on every side. */}
      <circle cx={16} cy={13} r={4} fill="#ffedd5" />
      <path
        d="M8.5 25.5c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5z"
        fill="#c7d7e6"
      />
    </svg>
  );
}

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

    // The behaviour is `dialogueKeydown`, which is exercised in
    // `focus-trap.test.ts` against stub controls that record being focused.
    // What is left here is the wiring: which elements count as this dialogue's
    // controls, and what dismissing means.
    const onKey = dialogueKeydown({
      controls: () => [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([tabindex="-1"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ],
      active: () => document.activeElement,
      dismiss: () => dismissRef.current(),
    });

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
          <BoundaryAgentMark />
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
