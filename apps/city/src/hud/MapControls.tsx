import { soundEngine } from "./sound-engine.js";

export function MapControls(props: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFollowAgent?: () => void;
  hasAgent?: boolean;
}): React.JSX.Element {
  return (
    <div className="map-controls" role="toolbar" aria-label="Camera Controls">
      <button
        type="button"
        className="map-controls__btn"
        onClick={() => {
          soundEngine.playClick();
          props.onZoomIn();
        }}
        title="Zoom in (Scroll Up)"
        aria-label="Zoom in"
      >
        +
      </button>

      <button
        type="button"
        className="map-controls__btn"
        onClick={() => {
          soundEngine.playClick();
          props.onZoomOut();
        }}
        title="Zoom out (Scroll Down)"
        aria-label="Zoom out"
      >
        &minus;
      </button>

      <button
        type="button"
        className="map-controls__btn"
        onClick={() => {
          soundEngine.playClick();
          props.onResetView();
        }}
        title="Reset camera & fit entire island"
        aria-label="Fit Island"
      >
        &#8857;
      </button>

      {props.hasAgent && props.onFollowAgent ? (
        <button
          type="button"
          className="map-controls__btn map-controls__btn--active"
          onClick={() => {
            soundEngine.playClick();
            props.onFollowAgent!();
          }}
          title="Center on Field Agent"
          aria-label="Follow Agent"
        >
          &#127919;
        </button>
      ) : null}
    </div>
  );
}
