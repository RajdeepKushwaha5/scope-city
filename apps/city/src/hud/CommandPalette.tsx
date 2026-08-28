import { useEffect, useMemo, useState } from "react";
import { soundEngine } from "./sound-engine.js";

export interface CommandItem {
  id: string;
  title: string;
  category: "The comparison" | "Districts" | "Offices" | "Actions" | "Replays";
  detail?: string;
  onSelect: () => void;
}

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
}): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setSelectedIndex(0);
      soundEngine.playClick();
    }
  }, [props.open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.items;
    return props.items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.detail && item.detail.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q),
    );
  }, [props.items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  useEffect(() => {
    if (!props.open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((idx) => (idx + 1) % Math.max(1, filtered.length));
        soundEngine.playClick();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((idx) => (idx - 1 + filtered.length) % Math.max(1, filtered.length));
        soundEngine.playClick();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filtered[selectedIndex];
        if (selected) {
          selected.onSelect();
          props.onClose();
          soundEngine.playClick();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.open, props.onClose, filtered, selectedIndex]);

  if (!props.open) return null;

  return (
    <div
      className="cmd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="cmd-modal">
        <div className="cmd-head">
          <span className="cmd-icon">?</span>
          <input
            autoFocus
            className="cmd-input"
            placeholder="Search districts, offices, tools, or replays..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmd-kbd">ESC</kbd>
        </div>

        <div className="cmd-list">
          {filtered.length === 0 ? (
            <div className="cmd-empty">No results found for &ldquo;{query}&rdquo;</div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                className={`cmd-item ${idx === selectedIndex ? "cmd-item--selected" : ""}`}
                onClick={() => {
                  item.onSelect();
                  props.onClose();
                  soundEngine.playClick();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="cmd-item__body">
                  <div className="cmd-item__title">{item.title}</div>
                  {item.detail ? <div className="cmd-item__detail">{item.detail}</div> : null}
                </div>
                <span className="cmd-item__category">{item.category}</span>
              </div>
            ))
          )}
        </div>

        <div className="cmd-foot">
          <span>
            <kbd className="cmd-mini-kbd">?</kbd> <kbd className="cmd-mini-kbd">?</kbd> Navigate
          </span>
          <span>
            <kbd className="cmd-mini-kbd">?</kbd> Select
          </span>
          <span>
            <kbd className="cmd-mini-kbd">ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
