import { TeamMark } from "./TeamMark.jsx";
import { orderLabels } from "../lib/replay.js";
import { COMPOUND_NAME } from "../lib/stints.js";

/**
 * The order board shared by the Replay page (real and projected) and the Home race sim.
 * rows: boardAt() rows sorted by position. mode: "gap" | "int" (see orderLabels). limit: show only the first N rows (Home).
 */
const OrderBoard = ({ rows, mode, onMode, projected = false, limit = null, compact = false, note = true, tires = null, grid = false, title = null }) => {
  const labels = grid ? rows.map(() => "") : orderLabels(rows, mode);        // before the start there are no gaps to show
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <aside className={`rp-board${compact ? " compact" : ""}${tires ? " has-tyre" : ""}`} aria-label="Order board">
      <div className="rp-board-h">
        {title ? <h2>{title}</h2> : <h2>Order <small>{projected ? "in this illustration" : "official positions"}</small></h2>}
        <div className="rp-mode" role="group" aria-label="Order board column">
          {[["gap", "GAP", "Gap to the leader"], ["int", "INT", "Interval: time to the car ahead"]].map(([m, label, title]) => (
            <button key={m} type="button" className="rp-mode-btn" aria-pressed={mode === m} title={title} onClick={() => onMode(m)}>{label}</button>
          ))}
        </div>
      </div>
      <ol>
        {shown.map((r, i) => (
          <li key={r.code} className={`${r.out ? "out" : ""}${r.inPit ? " pit" : ""}${r.noData ? " nodata" : ""}`} style={{ "--team": r.colour }}>
            <b>{r.out ? "–" : r.pos}</b><i className="rp-bar" /><TeamMark team={r.team} size={18} /><span className="rp-code">{r.code}</span>
            {tires && <span className="rp-tyre-slot">{tires[r.code] && <i className={`rp-tyre ${tires[r.code]}`} role="img" aria-label={`${COMPOUND_NAME[tires[r.code]]} tyres`} title={`${COMPOUND_NAME[tires[r.code]]} tyres`}>{tires[r.code]}</i>}</span>}
            <em title={mode === "int" ? "Time to the car directly ahead, as of the start of the current lap" : "Gap to the leader, as of the start of the current lap"}>{labels[i]}</em>
          </li>
        ))}
      </ol>
      {note && <p className="rp-note">{projected
        ? "Gaps update once a lap. Order and gaps come from the illustration itself, not from a timing feed."
        : "Gaps update once a lap. Positions are the official feed; they can lag the dots by a moment. NO DATA means OpenF1 sent no position for that car just now."}
      {mode === "int" && " INT is the time to the car ahead; a dash means no real time difference is available (a lapped car, or the order changed since the lap began)."}</p>}
    </aside>
  );
};

export default OrderBoard;
