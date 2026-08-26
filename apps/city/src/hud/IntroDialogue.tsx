import { soundEngine } from "./sound-engine.js";

export function IntroDialogue(props: {
  open: boolean;
  onDismiss: () => void;
  onSelectOption: (option: "recorded" | "clean" | "poisoned" | "explore") => void;
}): React.JSX.Element | null {
  if (!props.open) return null;

  return (
    <div className="dialogue-overlay">
      <div className="dialogue-box">
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
