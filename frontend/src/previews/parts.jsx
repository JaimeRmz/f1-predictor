import { D, BADGE_COLOR } from "./data.js";

// ── tiny presentational pieces ──────────────────────────────────────────


export function StateBadge({ badge, ageS, big }) {
  const c = BADGE_COLOR[badge.key];
  return (
    <span className="pv-badge" style={{ borderColor: c, color: c, fontSize: big ? "1rem" : "0.7rem", padding: big ? "0.4rem 0.9rem" : "0.2rem 0.55rem" }}>
      <span className="pv-dot" style={{ background: c, animation: badge.key === "LIVE" ? "pulse 1.2s infinite" : "none" }} />
      {badge.label}
      {badge.key !== "FINAL" && badge.key !== "PRE" && ageS != null && <span className="pv-badge-age">data {Math.round(ageS)}s old</span>}
    </span>
  );
}

export function MockBanner() {
  return <div className="pv-mock" role="note"><b>MOCK</b> {D.live.label}. Generated locally with a fixed seed. Shows only positions, race control and weather.</div>;
}

export function StateSwitch({ mode, setMode }) {
  return (
    <div className="pv-switch" role="group" aria-label="Simulate feed state">
      {[["live", "Live feed"], ["delayed", "Delayed feed (45 s)"], ["stale", "Feed stalled"], ["final", "Session over, results in"]].map(([k, l]) => (
        <button key={k} onClick={() => setMode(k)} className={mode === k ? "on" : ""}>{l}</button>
      ))}
    </div>
  );
}



// reliability chart: predicted bin mean (x) vs observed rate (y), diagonal = perfectly calibrated. Wilson 95% bars.
export function ReliabilityChart({ which = "win", w = 440, h = 300, compact }) {
  const pad = { l: 38, r: 12, t: 12, b: 34 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const X = (v) => pad.l + v * iw, Y = (v) => pad.t + (1 - v) * ih;
  const src = which === "win" ? D.reliability.reliability_win : D.reliability.reliability_podium;
  const series = [["a_real_grid", "var(--green)", "Real grid"], ["b_predicted_quali", "var(--teal)", "Predicted grid"]];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Reliability chart for ${which} score: predicted versus observed rate`} style={{ display: "block", maxWidth: w }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} stroke="var(--hud-line)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={pad.l - 6} y={Y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{Math.round(t * 100)}</text>
          <text x={X(t)} y={h - 18} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{Math.round(t * 100)}</text>
        </g>
      ))}
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="var(--ink)" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="5 4" />
      {series.map(([k, color]) => src[k].filter((b) => b.n > 0).map((b) => (
        <g key={k + b.bin}>
          <line x1={X(b.mean_pred)} x2={X(b.mean_pred)} y1={Y(b.wilson_lo)} y2={Y(b.wilson_hi)} stroke={color} strokeOpacity="0.55" strokeWidth="1.5" />
          <circle cx={X(b.mean_pred)} cy={Y(b.observed)} r={Math.max(3, Math.min(8, Math.sqrt(b.n) / 2.2))} fill={color} fillOpacity="0.85" />
        </g>
      )))}
      <text x={X(0.5)} y={h - 4} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">MODEL SCORE (%)</text>
      <text transform={`translate(10 ${Y(0.5)}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">ACTUALLY HAPPENED (%)</text>
      {!compact && series.map(([k, color, label], i) => (
        <g key={k}><circle cx={X(0.04)} cy={Y(0.96) + i * 16} r="4" fill={color} /><text x={X(0.04) + 9} y={Y(0.96) + i * 16 + 3} fontSize="10" fill="var(--ink)" fontFamily="var(--mono)">{label}</text></g>
      ))}
    </svg>
  );
}

// points progression: top-6 drivers by round
export function ProgressChart({ w = 520, h = 220, n = 6 }) {
  const { rounds, points } = D.championship.history;
  const refs = Object.keys(points).slice(0, n);
  const colorOf = (ref) => D.championship.drivers.contenders.find((c) => c.driverRef === ref)?.color || "#888";
  const codeOf = (ref) => D.championship.drivers.contenders.find((c) => c.driverRef === ref)?.code || ref;
  const max = Math.max(...refs.flatMap((r) => points[r]));
  const pad = { l: 34, r: 34, t: 10, b: 24 };
  const X = (i) => pad.l + (i / (rounds.length - 1)) * (w - pad.l - pad.r), Y = (v) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Championship points after each round, top six drivers" style={{ display: "block", maxWidth: w }}>
      {[0, 0.5, 1].map((t) => (<g key={t}><line x1={pad.l} x2={w - pad.r} y1={Y(max * t)} y2={Y(max * t)} stroke="var(--hud-line)" strokeDasharray="2 4" /><text x={pad.l - 5} y={Y(max * t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{Math.round(max * t)}</text></g>))}
      {refs.map((r, k) => (
        <g key={r}>
          <polyline fill="none" stroke={colorOf(r)} strokeWidth={k === 0 ? 2.4 : 1.4} strokeOpacity={k === 0 ? 1 : 0.8} points={points[r].map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />
          <text x={X(rounds.length - 1) + 4} y={Y(points[r][rounds.length - 1]) + 3} fontSize="9" fill={colorOf(r)} fontFamily="var(--mono)" fontWeight="700">{codeOf(r)}</text>
        </g>
      ))}
      {[0, 4, 9, 14, 18].map((i) => <text key={i} x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">R{rounds[i]}</text>)}
    </svg>
  );
}

const TYRE = { SOFT: ["S", "#f06a6a"], MEDIUM: ["M", "#cfc36a"], HARD: ["H", "#dcdcdc"], INTERMEDIATE: ["I", "#58b368"], WET: ["W", "#4a90e2"] };
// stint bar: one row per driver, compound-coloured segments (letters keep it readable without colour)
export function StintBar({ stints, laps, height = 14, showLetters = true }) {
  return (
    <div className="pv-stint" style={{ height }} aria-label={stints.map((s) => `${s.compound} laps ${s.from} to ${s.to}`).join(", ")}>
      {stints.map((s, i) => {
        const [letter, color] = TYRE[(s.compound || "").toUpperCase()] || ["?", "#888"];
        const len = s.to - s.from + 1;
        return <div key={i} style={{ width: `${(len / laps) * 100}%`, background: color }} title={`${s.compound} laps ${s.from}-${s.to}`}>{showLetters && len >= 4 ? letter : ""}</div>;
      })}
    </div>
  );
}


export function ScoreNote({ children }) {
  return <p className="pv-note">{children || D.nextRace.score_note}</p>;
}


