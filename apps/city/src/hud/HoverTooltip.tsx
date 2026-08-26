export interface HoverInfo {
  title: string;
  subtitle?: string;
  badge?: string;
  screenX: number;
  screenY: number;
}

export function HoverTooltip(props: { info: HoverInfo | null }): React.JSX.Element | null {
  if (!props.info) return null;

  return (
    <div
      className="hud-tooltip"
      style={{
        position: "fixed",
        left: props.info.screenX,
        top: props.info.screenY - 14,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      <div className="hud-tooltip__content">
        <div className="hud-tooltip__head">
          <span className="hud-tooltip__title">{props.info.title}</span>
          {props.info.badge ? (
            <span className={`hud-tooltip__badge hud-tooltip__badge--${props.info.badge.toLowerCase()}`}>
              {props.info.badge}
            </span>
          ) : null}
        </div>
        {props.info.subtitle ? (
          <div className="hud-tooltip__sub">{props.info.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
