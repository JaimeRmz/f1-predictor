import { useState, useEffect, useRef, useCallback } from "react";
import { CALENDAR } from "../lib/homeModel.js";
import "../pages/home.css";

// Default: the 2026 calendar (round-based). With `items` ([{ id, tag, label }]) and `selectedId` it lists those instead (used by Replay).
const RaceStrip = ({ round, onSelect, items = null, selectedId = null }) => {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    ref.current?.querySelector("[aria-pressed='true']")?.scrollIntoView({ inline: "center", block: "nearest" });
    measure();
  }, [round, selectedId, measure]);
  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure]);
  const nudge = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  // Arrow keys move focus between chips, Home/End jump to the ends; the focused chip scrolls into view.
  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const chips = [...ref.current.querySelectorAll(".hm-chip")];
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    const next = step ? chips[i + step] : e.key === "Home" ? chips[0] : e.key === "End" ? chips[chips.length - 1] : null;
    if (!step && !next) return;
    e.preventDefault();
    next?.focus();
    next?.scrollIntoView({ inline: "nearest", block: "nearest" });
  };
  return (
    <div className="hm-stripwrap">
      <button type="button" className="hm-arrow l" aria-label="Scroll races left" disabled={!edge.l} onClick={() => nudge(-1)}>‹</button>
      <nav className="hm-strip" ref={ref} aria-label="Choose a race" onScroll={measure} onKeyDown={onKey}>
        {items
          ? items.map((r) => (
            <button key={r.id} type="button" className={`hm-chip${r.upcoming ? "" : " done"}`} aria-pressed={r.id === selectedId} onClick={() => onSelect(r.id)}>
              <b>{r.tag}</b><span>{r.label}</span>
            </button>
          ))
          : CALENDAR.map((r) => (
            <button key={r.round} type="button" className={`hm-chip${r.kind === "completed" ? " done" : ""}`} aria-pressed={r.round === round} onClick={() => onSelect(r.round)}>
              <b>R{r.round}</b><span>{r.short}</span>{r.next && <i title="Next race" />}
            </button>
          ))}
      </nav>
      <button type="button" className="hm-arrow r" aria-label="Scroll races right" disabled={!edge.r} onClick={() => nudge(1)}>›</button>
      <span className={`hm-fade l${edge.l ? " on" : ""}`} aria-hidden="true" />
      <span className={`hm-fade r${edge.r ? " on" : ""}`} aria-hidden="true" />
    </div>
  );
};

export default RaceStrip;
