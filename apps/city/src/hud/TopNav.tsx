import { useState, useEffect } from "react";
import { soundEngine } from "./sound-engine.js";
import type { Scenario } from "./ScenarioBanner.js";

export function TopNav(props: {
  connection: "offline" | "connecting" | "live" | "reconnecting";
  activeScenario?: Scenario | null;
  onSelectScenario: (scenario: Scenario) => void;
  onOpenCommand: () => void;
  onOpenIntro: () => void;
  onTakeSnapshot: () => void;
  onResetView: () => void;
}): React.JSX.Element {
  const [soundOn, setSoundOn] = useState(() => soundEngine.isEnabled());

  useEffect(() => {
    setSoundOn(soundEngine.isEnabled());
  }, []);

  const toggleSound = () => {
    const next = soundEngine.toggle();
    setSoundOn(next);
    if (next) soundEngine.playClick();
  };

  return (
    <header className="topnav">
      <div className="topnav__brand">
        <span className="topnav__badge">TRUEFORGE</span>
        <div className="topnav__title-stack">
          <h1 className="topnav__title">SCOPE CITY</h1>
          <span className="topnav__subtitle">
            <span className={`topnav__dot topnav__dot--${props.connection}`} />
            {props.connection === "live" ? "HARNESS ONLINE" : props.connection.toUpperCase()}
          </span>
        </div>
      </div>

      <nav className="topnav__scenarios" aria-label="Quick Scenarios">
        <button
          type="button"
          className={`topnav__pill ${props.activeScenario === "recorded" ? "topnav__pill--active" : ""}`}
          onClick={() => {
            soundEngine.playClick();
            props.onSelectScenario("recorded");
          }}
          title="Replay verified live run with TrueForge session (SC-184)"
        >
          <span className="topnav__pill-icon">&#9654;</span>
          <span>Live Replay (SC-184)</span>
        </button>

        <button
          type="button"
          className={`topnav__pill ${props.activeScenario === "clean" ? "topnav__pill--active" : ""}`}
          onClick={() => {
            soundEngine.playClick();
            props.onSelectScenario("clean");
          }}
          title="Legitimate support refund inside bounds"
        >
          <span className="topnav__pill-icon">&#10003;</span>
          <span>Clean Job</span>
        </button>

        <button
          type="button"
          className={`topnav__pill ${props.activeScenario === "poisoned" ? "topnav__pill--active" : ""}`}
          onClick={() => {
            soundEngine.playClick();
            props.onSelectScenario("poisoned");
          }}
          title="Test prompt injection blocked at absent tool limits"
        >
          <span className="topnav__pill-icon">&#9888;</span>
          <span>Poisoned Ticket</span>
        </button>

        <button
          type="button"
          className={`topnav__pill topnav__pill--danger ${props.activeScenario === "overreach" ? "topnav__pill--active" : ""}`}
          onClick={() => {
            soundEngine.playRefusal();
            props.onSelectScenario("overreach");
          }}
          title="The Yard finds a gap before anything is granted"
        >
          <span className="topnav__pill-icon">&#10007;</span>
          <span>No Scope</span>
            Over-reach
          </button>
          <button
          type="button"
          className={`topnav__pill topnav__pill--danger ${props.activeScenario === "noscope" ? "topnav__pill--active" : ""}`}
          onClick={() => {
            soundEngine.playRefusal();
            props.onSelectScenario("noscope");
          }}
          title="Demonstrate immediate failure without granted scope"
        >
          <span className="topnav__pill-icon">&#10007;</span>
          <span>No Scope</span>
        </button>
      </nav>

      <div className="topnav__actions">
        <button
          type="button"
          className="topnav__btn"
          onClick={toggleSound}
          title={soundOn ? "Mute audio chiptunes" : "Enable retro audio"}
          aria-label="Toggle Audio"
        >
          <span className="topnav__btn-icon">{soundOn ? "\uD83D\uDD0A" : "\uD83D\uDD07"}</span>
          <span className="topnav__btn-text">{soundOn ? "AUDIO ON" : "MUTED"}</span>
        </button>

        <button
          type="button"
          className="topnav__btn"
          onClick={() => {
            soundEngine.playClick();
            props.onResetView();
          }}
          title="Center and fit city island"
          aria-label="Reset Camera"
        >
          <span className="topnav__btn-icon">&#8857;</span>
          <span className="topnav__btn-text">FIT</span>
        </button>

        <button
          type="button"
          className="topnav__btn"
          onClick={() => {
            soundEngine.playClick();
            props.onOpenCommand();
          }}
          title="Open Command Palette (Ctrl+K / Cmd+K)"
          aria-label="Command Palette"
        >
          <span className="topnav__btn-icon">&#8984;K</span>
        </button>

        <button
          type="button"
          className="topnav__btn topnav__btn--highlight"
          onClick={() => {
            soundEngine.playShutter();
            props.onTakeSnapshot();
          }}
          title="Capture high-resolution map snapshot card"
          aria-label="Snapshot"
        >
          <span className="topnav__btn-icon">&#128247;</span>
          <span className="topnav__btn-text">SNAP</span>
        </button>

        <button
          type="button"
          className="topnav__btn topnav__btn--help"
          onClick={() => {
            soundEngine.playClick();
            props.onOpenIntro();
          }}
          title="Open Mission Briefing & Guide"
          aria-label="Help Guide"
        >
          ?
        </button>
      </div>
    </header>
  );
}
