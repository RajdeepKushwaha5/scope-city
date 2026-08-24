import { useState, type ReactNode } from "react";

/**
 * One HUD window.
 *
 * Every panel in the interface is this component, which is most of why they
 * look like one instrument rather than a set of cards: the amber spine, the
 * dotted rule and the collapse behaviour are defined once.
 */
export function Window(props: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  tone?: "normal" | "gate";
  collapsible?: boolean;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const classes = ["window"];
  if (props.tone === "gate") classes.push("gate");
  if (collapsed) classes.push("window--collapsed");

  return (
    <section className={classes.join(" ")}>
      <header className="window__bar">
        <span>{props.title}</span>
        <span className="window__rule" />
        {props.right}
        {props.collapsible === false ? null : (
          <button
            className="btn"
            style={{ padding: "1px 5px" }}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        )}
      </header>
      <div className="window__body">{props.children}</div>
    </section>
  );
}

export function Stat(props: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="stat">
      <span className="stat__label">{props.label}</span>
      <span className="stat__value">{props.children}</span>
    </div>
  );
}

/**
 * A segmented gauge.
 *
 * Segments rather than a smooth bar: a continuous fill reads as a web progress
 * indicator, and segments read as an instrument.
 */
export function Meter(props: { value: number; tone?: "good" | "warn" | "bad" }): React.JSX.Element {
  const segments = 16;
  const on = Math.round(Math.min(1, Math.max(0, props.value)) * segments);
  const tone = props.tone ?? "good";

  return (
    <div className="meter">
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`meter__seg ${i < on ? `meter__seg--${tone === "good" ? "on" : tone}` : ""}`}
        />
      ))}
    </div>
  );
}
