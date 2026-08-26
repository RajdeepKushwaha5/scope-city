import { useEffect, useState } from "react";
import { soundEngine } from "./sound-engine.js";

export type CrewId = "opus" | "sonnet" | "haiku";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface CrewMember {
  id: CrewId;
  model: string;
  name: string;
  title: string;
  description: string;
  available?: boolean;
}

export const CREW_MEMBERS: readonly CrewMember[] = [
  {
    id: "opus",
    model: "opus",
    name: "Architect",
    title: "Master planner",
    description: "Deep reasoning for complex refactors, architecture, and long-horizon builds.",
    available: false,
  },
  {
    id: "sonnet",
    model: "sonnet",
    name: "Worker",
    title: "Site foreman",
    description: "Balanced crew for everyday edits, fixes, and steady construction.",
    available: true,
  },
  {
    id: "haiku",
    model: "haiku",
    name: "Runner",
    title: "Quick hands",
    description: "Fast passes for small edits, renames, and errands around the city.",
    available: true,
  },
];

export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function effortLabel(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
    case "max":
      return "Max";
  }
}

export function effortDescription(effort: EffortLevel): string {
  switch (effort) {
    case "low":
      return "Quick passes — clipboard only, minimal planning.";
    case "medium":
      return "Steady pace — pocket notes, moderate thinking.";
    case "high":
      return "Full tool belt — blueprints out, deep reasoning.";
    case "xhigh":
      return "Survey crew — calculators, tape, extended exploration.";
    case "max":
      return "Everything on site — tripod, level, no constraints.";
  }
}

export function crewSpriteUrl(crewId: CrewId, effort: EffortLevel = "high"): string {
  return `/crew/${crewId}-${effort}.png`;
}

export function getCrewMember(id: CrewId): CrewMember {
  return CREW_MEMBERS.find((c) => c.id === id) || CREW_MEMBERS[1]!;
}

export function CrewModal(props: {
  open: boolean;
  selectedId: CrewId;
  thinkingLevel: EffortLevel;
  onSelectSpecialist: (specialist: CrewMember) => void;
  onSelectThinking: (level: EffortLevel) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const [draftId, setDraftId] = useState<CrewId>(props.selectedId);
  const [draftEffort, setDraftEffort] = useState<EffortLevel>(props.thinkingLevel);

  useEffect(() => {
    if (props.open) {
      setDraftId(props.selectedId);
      setDraftEffort(props.thinkingLevel);
    }
  }, [props.open, props.selectedId, props.thinkingLevel]);

  if (!props.open) return null;

  const selectedCrew = getCrewMember(draftId);

  const handleConfirm = () => {
    soundEngine.playClick();
    props.onSelectSpecialist(selectedCrew);
    props.onSelectThinking(draftEffort);
    props.onClose();
  };

  return (
    <div className="dialogue-overlay" onClick={props.onClose}>
      <div
        className="dialogue-box crew-modal-v2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose your crew"
      >
        <div className="crew-modal-v2__header">
          <div>
            <h2 className="crew-modal-v2__title">Choose your crew</h2>
            <p className="crew-modal-v2__subtitle">
              Pick a specialist and how hard they should think before dispatch.
            </p>
          </div>
          <button
            type="button"
            className="crew-modal-v2__close"
            onClick={() => {
              soundEngine.playClick();
              props.onClose();
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="crew-modal-v2__body">
          {/* Left column: Crew list */}
          <div className="crew-modal-v2__left">
            {CREW_MEMBERS.map((crew) => {
              const isSelected = crew.id === draftId;
              const isAvailable = crew.available !== false;
              const sprite = crewSpriteUrl(crew.id, isSelected ? draftEffort : "high");

              return (
                <button
                  key={crew.id}
                  type="button"
                  disabled={!isAvailable}
                  className={`crew-modal-v2__card ${
                    isSelected ? "crew-modal-v2__card--selected" : ""
                  } ${!isAvailable ? "crew-modal-v2__card--disabled" : ""}`}
                  onClick={() => {
                    soundEngine.playClick();
                    setDraftId(crew.id);
                  }}
                >
                  <div className="crew-modal-v2__card-art">
                    <img
                      src={sprite}
                      alt={crew.name}
                      className="crew-modal-v2__card-img"
                    />
                  </div>
                  <div className="crew-modal-v2__card-info">
                    <h3 className="crew-modal-v2__card-name">{crew.name}</h3>
                    <span className="crew-modal-v2__card-meta">
                      {crew.title} &bull; {crew.model}
                    </span>
                    <p className="crew-modal-v2__card-desc">{crew.description}</p>
                    {!isAvailable ? (
                      <span className="crew-modal-v2__card-status">
                        Off duty on this server
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right column: Selected preview & Thinking Level */}
          <div className="crew-modal-v2__right">
            <div className="crew-modal-v2__preview-box">
              <img
                src={crewSpriteUrl(draftId, draftEffort)}
                alt={selectedCrew.name}
                className="crew-modal-v2__preview-img"
              />
              <h3 className="crew-modal-v2__preview-name">{selectedCrew.name}</h3>
              <span className="crew-modal-v2__preview-effort">
                {effortLabel(draftEffort)} effort
              </span>
            </div>

            <div className="crew-modal-v2__thinking-section">
              <span className="crew-modal-v2__thinking-title">Thinking level</span>
              <div className="crew-modal-v2__thinking-grid">
                {EFFORT_LEVELS.map((level) => {
                  const isSelected = draftEffort === level;
                  const isLevelAvailable = level !== "xhigh" && level !== "max";
                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={!isLevelAvailable}
                      className={`crew-modal-v2__effort-btn ${
                        isSelected ? "crew-modal-v2__effort-btn--selected" : ""
                      } ${!isLevelAvailable ? "crew-modal-v2__effort-btn--disabled" : ""}`}
                      onClick={() => {
                        soundEngine.playClick();
                        setDraftEffort(level);
                      }}
                    >
                      {effortLabel(level).toUpperCase()}
                    </button>
                  );
                })}
              </div>
              <p className="crew-modal-v2__thinking-desc">
                {effortDescription(draftEffort)}
              </p>
            </div>
          </div>
        </div>

        <div className="crew-modal-v2__footer">
          <button
            type="button"
            className="crew-modal-v2__btn-cancel"
            onClick={() => {
              soundEngine.playClick();
              props.onClose();
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            className="crew-modal-v2__btn-confirm"
            onClick={handleConfirm}
          >
            CONFIRM CREW
          </button>
        </div>
      </div>
    </div>
  );
}
