import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { SectionHeader, CountUp, BackendPanel, SkeletonList } from "../shared.jsx";
import { API, card } from "../constants.js";

// ── CHAMPIONSHIP PAGE ──────────────────────────────────────────
const ChampionshipPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  // setState only ever runs inside the async callbacks (or the retry click
  // handler below), never synchronously inside the mount effect.
  const fetchSimulation = () => {
    axios.get(`${API}/championship/simulate`)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => { setLoading(false); setOffline(true); });
  };

  useEffect(fetchSimulation, []);

  const retry = () => { setLoading(true); setOffline(false); fetchSimulation(); };

  const pointsData = data?.map(d => ({ driver: d.driver.split(" ").pop(), current: d.points, projected: d.projected_total }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader
        eyebrow="ML Simulation · Historical Win Rates"
        title="2026 Championship Predictor"
        right={<div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "rgba(255,255,255,0.7)", textAlign: "right" }}><div>13 RACES REMAINING</div></div>}
      />

      {offline && <BackendPanel detail="The championship simulation request failed." onRetry={retry} />}

      {loading && <SkeletonList rows={6} metrics={1} />}

      {!loading && data && (
        <>
          <div className="chart-enter" style={{ ...card }}>
            <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
              <span className="section-label">Title Probability</span>
            </div>
            <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {data.map((d, i) => (
                <div key={i} className="stagger-item" style={{ "--i": i, display: "flex", alignItems: "center", gap: "1rem" }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                  <div style={{ fontFamily: "var(--sans)", fontSize: "0.82rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", width: "120px", flexShrink: 0 }}>{d.driver.split(" ").pop()}</div>
                  <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.06)", overflow: "hidden", borderRadius: "3px" }}>
                    <div className="prob-bar" style={{ height: "100%", width: `${d.title_probability}%`, background: i === 0 ? "var(--red)" : d.color }} />
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.82rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "45px", textAlign: "right" }}><CountUp value={d.title_probability} decimals={0} suffix="%" /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-enter" style={{ ...card, padding: "20px" }}>
            <div className="section-label" style={{ marginBottom: "1rem" }}>Current vs Projected Final Points</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pointsData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                <XAxis dataKey="driver" stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--sans)" }} />
                <YAxis stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.75rem", fontFamily: "var(--mono)" }} />
                <Legend wrapperStyle={{ fontSize: "0.7rem", fontFamily: "var(--mono)", color: "var(--muted)" }} />
                <Bar dataKey="current" name="Current" fill="var(--dimmed)" radius={0} />
                <Bar dataKey="projected" name="Projected" fill="#e10600" radius={0} opacity={0.75} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-enter" style={{ ...card }}>
            <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
              <span className="section-label">Full Simulation Breakdown</span>
            </div>
            {data.map((d, i) => (
              <div key={i} className="data-row stagger-item" style={{ "--i": i, display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 1rem", borderBottom: i < data.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "20px" }}>{i + 1}</div>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "700", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.driver}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--muted)", opacity: 0.5, marginTop: "2px" }}>{d.team} · {d.win_rate}% win rate</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--text)" }}>{d.points} → {d.projected_total}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)", marginTop: "2px" }}>{d.gap_to_leader === 0 ? "LEADER" : `${d.gap_to_leader} PTS`}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...card, padding: "20px", display: "flex", gap: "0.75rem" }}>
            <span style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.65rem", fontWeight: "700", flexShrink: 0 }}>METHOD</span>
            <p style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              Projected points = historical win rate × remaining races × avg points. Baseline simulation — 2026 reg changes mean actual results may vary significantly.
            </p>
          </div>
        </>
      )}
    </div>
  );
};


export default ChampionshipPage;
