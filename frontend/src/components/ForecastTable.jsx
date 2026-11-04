import { useState } from "react";
import { GlassPanel } from "./GlassPanel.jsx";
import { TeamMark } from "./TeamMark.jsx";
import { teamColor, pctLabel, score } from "../lib/homeModel.js";
import "../pages/home.css";

const SHOW_DEFAULT = 10;
const Forecast = ({ ranked, title = "Full forecast", caption = "Relative strength inside this race's field, not a calibrated chance. Win shares add up to 100%. Hover a figure for the raw model score.", defaultAll = false }) => {
  const [all, setAll] = useState(defaultAll);
  const shown = all ? ranked : ranked.slice(0, SHOW_DEFAULT);
  const max = Math.max(...ranked.map((r) => r.podiumShare ?? 0), 0.0001);
  return (
    <GlassPanel className="hm-panel" tilt={false}>
      <div className="hm-panel-h"><h2>{title}</h2><p>{caption}</p></div>
      <div className="hm-tbl" role="table" aria-label="Forecast">
        <div className="hm-tr hm-th" role="row"><span>POS</span><span /><span>DRIVER</span><span className="hm-hide-m">PODIUM SHARE</span><span className="gold">WIN SHARE</span><span className="teal">PODIUM SHARE</span></div>
        {shown.map((r) => (
          <div className="hm-tr" role="row" key={r.driverRef} style={{ "--team": teamColor(r.teamId) }}>
            <span className="hm-n">{r.pos}</span>
            <span className="hm-tm"><i className="hm-bar" /><TeamMark team={r.teamId} size={22} /></span>
            <span className="hm-drv"><b>{r.code}</b><span className="hm-hide-m"> {r.driver_name}</span></span>
            <span className="hm-meter hm-hide-m" aria-hidden="true"><i style={{ width: `${(100 * (r.podiumShare ?? 0)) / max}%` }} /></span>
            <span className="gold hm-v" title={`raw model score ${score(r.win)}`}>{pctLabel(r.winPct, r.winShare)}</span>
            <span className="teal hm-v" title={`raw model score ${score(r.podium)}`}>{pctLabel(r.podiumPct, r.podiumShare)}</span>
          </div>
        ))}
      </div>
      {ranked.length > SHOW_DEFAULT && (
        <button type="button" className="hm-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `SHOW TOP ${SHOW_DEFAULT} ONLY` : `SHOW ALL ${ranked.length} DRIVERS`}
        </button>
      )}
    </GlassPanel>
  );
};

export default Forecast;
