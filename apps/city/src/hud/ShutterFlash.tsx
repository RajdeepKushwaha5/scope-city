import { useEffect, useState } from "react";

export function ShutterFlash(props: { active: boolean; onComplete: () => void }): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (props.active) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        props.onComplete();
      }, 450);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [props.active, props.onComplete]);

  if (!visible) return null;

  return (
    <div
      className="shutter-flash"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#ffffff",
        zIndex: 9999,
        pointerEvents: "none",
        animation: "shutter-flash-fade 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    />
  );
}
