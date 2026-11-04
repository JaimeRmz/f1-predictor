import { useState, useEffect, useRef, useId } from "react";
import { score } from "../lib/homeModel.js";
import "../pages/home.css";

// A share figure that reveals its raw model score on tap or click (a small popover; Escape, an outside tap or a second
// tap dismisses it) and on hover/long-press via the title attribute. A real button, so it works from the keyboard and
// announces its expanded state.
const ScoreFigure = ({ raw, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <span className="hm-figwrap" ref={ref}>
      <button type="button" className="hm-fig" aria-expanded={open} aria-describedby={open ? id : undefined} title={`raw model score ${score(raw)}`} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      {open && <span className="hm-figpop" role="status" id={id}>raw model score {score(raw)}</span>}
    </span>
  );
};

export default ScoreFigure;
