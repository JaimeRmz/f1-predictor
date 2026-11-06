import { useState, useEffect, useRef } from "react";
import { useHealth } from "../health.jsx";
import { SECTIONS, MORE, sectionOf, inMore } from "../navModel.js";
import "./siteHeader.css";

const STATUS = {
  online:  { color: "var(--green)", label: "Server online" },
  waking:  { color: "var(--amber)", label: "Server waking up" },
  offline: { color: "var(--red)",   label: "Server offline" },
};

// Backend health as a single coloured dot (the old SYS STATUS readout, collapsed). Label lives in title + aria-label.
const StatusDot = () => {
  const { status } = useHealth();
  const ui = STATUS[status] || STATUS.offline;
  return <span className={`sh-dot${status === "waking" ? " waking" : ""}`} role="status" aria-label={ui.label} title={ui.label} style={{ background: ui.color }} />;
};

// Minimal header: logo on the left, five sections on the right, MORE menu, status dot. Opaque (not see-through) so
// scrolling content never shows through it. Below 768px the sections move into a menu button.
const SiteHeader = ({ page, setPage, onNavigate }) => {
  const [open, setOpen] = useState(null); // null | "more" | "menu"
  const ref = useRef(null);
  const sec = sectionOf(page);
  const go = (p) => { setPage(p); onNavigate(); setOpen(null); };

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    const esc = (e) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const sectionButtons = (cls) => SECTIONS.map((s) => (
    <button key={s.id} type="button" className={`${cls}${sec?.id === s.id ? " on" : ""}`} aria-current={sec?.id === s.id ? "page" : undefined} onClick={() => go(sec?.id === s.id ? page : s.pages[0])}>{s.label}</button>
  ));
  const moreItems = (cls) => MORE.map((m) => (
    <button key={m.page} type="button" role="menuitem" className={`${cls}${page === m.page ? " on" : ""}`} aria-current={page === m.page ? "page" : undefined} onClick={() => go(m.page)}>{m.label}</button>
  ));

  return (
    <header className="sh" ref={ref}>
      <div className="sh-in">
        <button type="button" className="sh-logo" aria-label="F1 Predictor, home" onClick={() => go(SECTIONS[0].pages[0])}>
          <img src="/f1-logo.png" alt="F1" />
          <span className="sh-div" aria-hidden="true" />
          <span className="sh-word">PREDICTOR</span>
        </button>

        <nav className="sh-nav" aria-label="Main">
          {sectionButtons("sh-link")}
          <div className="sh-more">
            <button type="button" className={`sh-link${inMore(page) ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open === "more"} onClick={() => setOpen(open === "more" ? null : "more")}>MORE ▾</button>
            {open === "more" && <div className="sh-pop" role="menu">{moreItems("sh-item")}</div>}
          </div>
          <StatusDot />
        </nav>

        <div className="sh-mobile">
          <StatusDot />
          <button type="button" className="sh-burger" aria-label="Menu" aria-expanded={open === "menu"} aria-controls="sh-menu" onClick={() => setOpen(open === "menu" ? null : "menu")}>
            <span /><span /><span />
          </button>
        </div>
      </div>

      {open === "menu" && (
        <div className="sh-menu" id="sh-menu" role="menu">
          {sectionButtons("sh-item")}
          <div className="sh-sep">MORE</div>
          {moreItems("sh-item")}
        </div>
      )}
    </header>
  );
};

export default SiteHeader;
