import { useState, useEffect } from "react";
import axios from "axios";
import { SectionHeader, CountUp, OfflinePanel, SkeletonList } from "../shared.jsx";
import { API, card, CONSTRUCTOR_OVERRIDES, STANDINGS_GRID_2026, TEAM_COLORS } from "../constants.js";

// ── NEXT RACE PAGE (British GP 2026) ───────────────────────────
// Countdown owns its own 1-second interval state, so each tick re-renders
// only this small component — not the whole page (3 lists × 22 rows).
const RaceCountdown = () => {
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const raceDate = new Date("2026-07-05T14:00:00Z"); // 15:00 BST / 9:00 AM CDT
    const tick = () => {
      const now = new Date();
      const diff = raceDate - now;
      if (diff <= 0) { setCountdown("RACE DAY"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${String(d).padStart(2,"0")}D ${String(h).padStart(2,"0")}H ${String(m).padStart(2,"0")}M ${String(s).padStart(2,"0")}S`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return <div style={{ fontFamily: "var(--mono)", fontSize: "1.6rem", fontWeight: "700", letterSpacing: "0.05em", fontVariantNumeric: "tabular-nums" }}>{countdown}</div>;
};

const NextRacePage = () => {
  const [predictions, setPredictions] = useState([]);
  const [predLoading, setPredLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  // setState only ever runs inside the async callbacks (or the retry click
  // handler below), never synchronously inside the mount effect.
  const fetchPredictions = () => {
    axios.post(`${API}/whatif?circuitRef=silverstone&auto_quali=true`, STANDINGS_GRID_2026)
      .then(r => { setPredictions([...r.data].sort((a, b) => a.grid - b.grid)); setPredLoading(false); })
      .catch(() => { setPredLoading(false); setOffline(true); });
  };

  useEffect(fetchPredictions, []);

  const retry = () => { setPredLoading(true); setOffline(false); fetchPredictions(); };

  const teamColors = TEAM_COLORS;

  // Sprint weekend — confirmed from Ergast DB: fp2/fp3 NULL, sprint_date 2026-07-04
  // Times converted from BST (UTC+1) to Central Time / Houston (CDT, UTC-5) — a 6-hour offset.
  const schedule = [
    { session: "Practice 1",       day: "Friday Jul 3",   time: "6:30 AM CDT",  emoji: "🔧" },
    { session: "Sprint Qualifying", day: "Friday Jul 3",   time: "10:30 AM CDT", emoji: "⚡" },
    { session: "Sprint Race",       day: "Saturday Jul 4", time: "6:00 AM CDT",  emoji: "🏎" },
    { session: "Qualifying",        day: "Saturday Jul 4", time: "10:00 AM CDT", emoji: "⚡" },
    { session: "Race",              day: "Sunday Jul 5",   time: "9:00 AM CDT",  emoji: "🏁", featured: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Hero */}
      <div className="canada-hero scanline-overlay" style={{ background: "var(--red)", padding: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.25em", opacity: 0.8, marginBottom: "0.35rem" }}>ROUND 9 · 2026 FIA FORMULA ONE WORLD CHAMPIONSHIP</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "900", fontStyle: "italic", letterSpacing: "0.02em" }}>🇬🇧 BRITISH GRAND PRIX</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", fontWeight: "500", opacity: 0.8, marginTop: "0.3rem" }}>Silverstone Circuit · Northamptonshire · July 3–5, 2026</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.25em", opacity: 0.75, marginBottom: "0.3rem" }}>RACE COUNTDOWN</div>
          <RaceCountdown />
        </div>
      </div>
      {predLoading && <div className="loading-bar" />}

      {/* Schedule */}
      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">Race Weekend Schedule · Central Time (Houston) · Sprint Format</span>
        </div>
        {schedule.map((s, i) => (
          <div key={i} className="stagger-item data-row" style={{
            "--i": i,
            display: "flex", alignItems: "center", gap: "1rem", padding: "0.85rem 1rem",
            background: s.featured ? "rgba(225,6,0,0.06)" : "transparent",
            borderBottom: i < schedule.length - 1 ? "1px solid var(--border)" : "none",
            borderLeft: s.featured ? "3px solid var(--red)" : "3px solid transparent",
          }}>
            <span style={{ fontSize: "1rem" }}>{s.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "700", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.session}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", marginTop: "2px" }}>{s.day} · {s.time}</div>
            </div>
            {s.featured && <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--red)", letterSpacing: "0.1em", animation: "pulse 1.5s infinite" }}>● UPCOMING</span>}
          </div>
        ))}
      </div>

      {offline && <OfflinePanel detail="The Silverstone prediction request failed." onRetry={retry} />}

      {/* Predicted qualifying order */}
      <SectionHeader eyebrow="XGBoost Regressor · Qualifying Model" title="Predicted Qualifying Order — Silverstone" />
      {predLoading && <SkeletonList rows={6} metrics={1} />}
      {!predLoading && predictions.length > 0 && (
        <div className="chart-enter" style={{ ...card }}>
          {predictions.map((p, i) => {
            const team = CONSTRUCTOR_OVERRIDES[p.driverRef] || p.team;
            const color = teamColors[team] || "var(--dimmed)";
            return (
              <div key={p.driverRef} className="data-row stagger-item" style={{
                "--i": i,
                display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.6rem 1rem",
                borderLeft: `3px solid ${color}`,
                borderBottom: i < predictions.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "26px", flexShrink: 0 }}>P{p.grid}</div>
                <div style={{ flex: 1, fontWeight: "700", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.driver_name}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color, opacity: 0.6 }}>{team}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pre-race prediction */}
      <SectionHeader eyebrow="XGBoost · Silverstone Circuit History · Uses Predicted Grid Above" title="British GP Pre-Race Prediction" />
      {predLoading && <SkeletonList rows={8} />}
      {!predLoading && predictions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {predictions.map((p, i) => {
            const team = CONSTRUCTOR_OVERRIDES[p.driverRef] || p.team;
            const color = teamColors[team] || "var(--dimmed)";
            return (
              <div key={i} className="data-row stagger-item row-gap-tight" style={{
                ...card, "--i": i, padding: "16px", display: "flex", alignItems: "center", gap: "1rem",
                borderLeft: `4px solid ${color}`,
                background: i === 0 ? "rgba(225,6,0,0.08)" : i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: "700", color: "var(--muted)", width: "28px", flexShrink: 0 }}>P{p.grid}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "700", fontSize: "0.88rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.driver_name}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color, opacity: 0.5, marginTop: "2px" }}>{team}</div>
                </div>
                <div className="next-race-metric" style={{ textAlign: "right", minWidth: "70px" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.82rem", fontWeight: "700", color: p.win_probability > 0.25 ? "var(--gold)" : "var(--muted)" }}><CountUp value={(p.win_probability ?? 0) * 100} suffix="%" /></div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", marginTop: "2px", letterSpacing: "0.06em" }}>WIN</div>
                </div>
                <div className="next-race-metric" style={{ textAlign: "right", minWidth: "80px" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.82rem", fontWeight: "700", color: p.podium_probability > 0.5 ? "var(--red)" : "var(--muted)" }}><CountUp value={p.podium_probability * 100} suffix="%" /></div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", marginTop: "2px", letterSpacing: "0.06em" }}>PODIUM</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Context note */}
      <div style={{ ...card, padding: "20px", display: "flex", gap: "0.75rem" }}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.65rem", fontWeight: "700", flexShrink: 0 }}>NOTE</span>
        <p style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
          Sprint weekend — no FP2 or FP3. Grid auto-predicted by qualifying model · updates after real qualifying. Circuit Podium Rate uses exponential decay (0.75^years) weighting recent Silverstone history more heavily.
        </p>
      </div>
    </div>
  );
};


export default NextRacePage;
