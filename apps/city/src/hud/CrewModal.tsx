import { soundEngine } from "./sound-engine.js";

export interface CrewSpecialist {
  id: string;
  name: string;
  badge: string;
  role: string;
  description: string;
  model: string;
  color: string;
}

export const CREW_SPECIALISTS: readonly CrewSpecialist[] = [
  {
    id: "boundary-agent",
    name: "Boundary Agent",
    badge: "OPERATOR",
    role: "Standard Enforcement",
    description:
      "Compiles natural language into capability-enforced envelopes. Strips free text before scope grant.",
    model: "Claude 3.7 Sonnet",
    color: "#ffc247",
  },
  {
    id: "yard-redteam",
    name: "Adversarial Red Team",
    badge: "YARD PROBER",
    role: "Backtest Investigator",
    description:
      "Runs automated boundary fuzzing, off-by-one ID probes, and downstream response-reach leak checks in the sandbox.",
    model: "TrueForge Subagent Pool",
    color: "#ff5e7e",
  },
  {
    id: "minimal-resolver",
    name: "Minimal Resolver",
    badge: "RESOLVER",
    role: "Structured Lookup",
    description:
      "Translates order IDs to charges reading trusted metadata fields only. Immune to body prompt injections.",
    model: "Gemini 2.5 Flash",
    color: "#56ccf2",
  },
];

export function CrewModal(props: {
  open: boolean;
  selectedId: string;
  thinkingLevel: "low" | "medium" | "high";
  onSelectSpecialist: (specialist: CrewSpecialist) => void;
  onSelectThinking: (level: "low" | "medium" | "high") => void;
  onClose: () => void;
}): React.JSX.Element | null {
  if (!props.open) return null;

  return (
    <div className="dialogue-overlay" onClick={props.onClose}>
      <div
        className="dialogue-box crew-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Crew & Specialist Selection"
      >
        <div className="crew-modal__header">
          <div>
            <span className="topnav__badge">TRUEFORGE AGENTS</span>
            <h2 className="dialogue-title" style={{ marginTop: "4px" }}>
              Crew Specialist Selector
            </h2>
          </div>
          <button
            type="button"
            className="btn inspector__close"
            onClick={() => {
              soundEngine.playClick();
              props.onClose();
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="order__hint" style={{ marginBottom: "16px" }}>
          Select the TrueForge agent persona and reasoning effort deployed into the field.
        </p>

        <div className="crew-modal__list">
          {CREW_SPECIALISTS.map((specialist) => {
            const isSelected = specialist.id === props.selectedId;
            return (
              <div
                key={specialist.id}
                className={`crew-modal__item ${isSelected ? "crew-modal__item--selected" : ""}`}
                onClick={() => {
                  soundEngine.playClick();
                  props.onSelectSpecialist(specialist);
                }}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    props.onSelectSpecialist(specialist);
                  }
                }}
              >
                <div className="crew-card__sprite" style={{ borderColor: specialist.color }}>
                  <span className="crew-card__head" style={{ background: specialist.color }} />
                  <span className="crew-card__body" style={{ background: specialist.color }} />
                </div>
                <div className="crew-modal__details">
                  <div className="crew-modal__top-line">
                    <strong>{specialist.name}</strong>
                    <span
                      className="status-chip"
                      style={{
                        background: `${specialist.color}22`,
                        color: specialist.color,
                        borderColor: specialist.color,
                      }}
                    >
                      {specialist.badge}
                    </span>
                  </div>
                  <small className="crew-modal__role">{specialist.role} &bull; {specialist.model}</small>
                  <p className="crew-modal__desc">{specialist.description}</p>
                </div>
                {isSelected ? <span className="crew-modal__check">&#10003;</span> : null}
              </div>
            );
          })}
        </div>

        <div className="crew-modal__thinking">
          <span className="hud-label">Reasoning Effort / Budget</span>
          <div className="permission-choice" role="group" aria-label="Thinking budget">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={`btn ${props.thinkingLevel === level ? "btn--primary" : ""}`}
                onClick={() => {
                  soundEngine.playClick();
                  props.onSelectThinking(level);
                }}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="dialogue-foot" style={{ marginTop: "16px" }}>
          <button
            type="button"
            className="btn btn--primary"
            style={{ width: "100%" }}
            onClick={() => {
              soundEngine.playClick();
              props.onClose();
            }}
          >
            Confirm Specialist Selection
          </button>
        </div>
      </div>
    </div>
  );
}
