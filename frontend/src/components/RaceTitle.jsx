import { useState, useEffect } from "react";
import { NEXT_RACE } from "../constants.js";
import { PHASE_LABEL, titleParts, countdownTarget, countdownParts, phaseOf } from "../lib/homeModel.js";
import { tz, dayTime, pad } from "../lib/timeFmt.js";
import "../pages/home.css";

const Countdown = ({ race }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const tgt = countdownTarget(race, now);
  if (!tgt) {
    return <div className="hm-count off"><div className="hm-count-cap">{race.kind === "completed" ? "RACE COMPLETED" : phaseOf(race) === "final-pending" ? "RACE FINISHED · RESULTS LOADING" : "SESSION TIMES NOT IN THE APP YET"}</div></div>;
  }
  const p = countdownParts(tgt.at - now);
  return (
    <div className="hm-count" role="timer" aria-label={`${p.d} days ${p.h} hours ${p.m} minutes ${p.s} seconds ${tgt.label.toLowerCase()}`}>
      <div className="hm-digits">
        {[[p.d, "D"], [p.h, "H"], [p.m, "M"], [p.s, "S"]].map(([v, u]) => <span key={u}>{pad(v)}<small>{u}</small></span>)}
      </div>
      <div className="hm-count-cap">{tgt.label} · {dayTime.format(new Date(tgt.at))} {tz}</div>
    </div>
  );
};

// `brand`: Home only; puts "F1 PREDICTOR" first in the kicker and shows just the city.
const TitleRow = ({ race, phase, brand = false }) => {
  const { base, suffix } = titleParts(race.name);
  const where = race.raceId === NEXT_RACE.raceId ? NEXT_RACE.location : race.circuit; // only places the app actually knows
  return (
    <header className="hm-title">
      <div>
        <div className="hm-eyebrow">{brand ? "F1 PREDICTOR · " : ""}ROUND {race.round}{where ? ` · ${(brand ? where.split(",")[0] : where).toUpperCase()}` : ""} · {PHASE_LABEL[phase]}</div>
        <h1>{base} <em>Grand Prix</em>{suffix && <span> {suffix}</span>}</h1>
      </div>
      <Countdown race={race} />
    </header>
  );
};

export default TitleRow;
