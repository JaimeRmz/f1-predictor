import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { StatCard, BackendPanel, SkeletonList } from "../shared.jsx";
import { API, card } from "../constants.js";

// ── DRIVERS PAGE ───────────────────────────────────────────────
const DriversPage = () => {
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  // setState only ever runs inside the async callbacks (or the retry click
  // handler below), never synchronously inside the mount effect.
  const fetchRoster = () => {
    axios.get(`${API}/drivers`).then(r => setDrivers(r.data)).catch(() => setOffline(true));
  };

  useEffect(fetchRoster, []);

  const loadDriver = async (ref) => {
    setLoading(true); setStats(null); setSelected(ref); setOffline(false);
    try {
      const res = await axios.get(`${API}/driver/${ref}`);
      setStats(res.data);
    } catch {
      setOffline(true);
    }
    setLoading(false);
  };

  const retry = () => {
    setOffline(false);
    if (drivers.length === 0) fetchRoster();
    if (selected) loadDriver(selected);
  };

  const firstYear = stats?.by_year?.[0]?.year;
  const lastYear  = stats?.by_year?.[stats.by_year.length - 1]?.year;

  return (
    <div className="drivers-grid" style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: "1rem" }}>
      <div style={{ ...card, padding: "0.5rem", maxHeight: "640px", overflowY: "auto" }}>
        <div style={{ padding: "0.5rem 0.5rem 0.4rem", borderBottom: "1px solid var(--border)", marginBottom: "0.25rem" }}>
          <span className="section-label">All Drivers</span>
        </div>
        {drivers.length === 0 && !offline && (
          <div aria-hidden="true" style={{ padding: "0.25rem 0.6rem" }}>
            {Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="skeleton-block" style={{ height: "16px", width: `${55 + ((i * 17) % 35)}%`, margin: "0.55rem 0" }} />
            ))}
          </div>
        )}
        {drivers.map(d => (
          <button key={d.driverRef} onClick={() => loadDriver(d.driverRef)}
            className={`driver-list-item${selected === d.driverRef ? " driver-list-active" : ""}`}
            style={{
              display: "block", width: "100%", textAlign: "left",
              background: selected === d.driverRef ? "var(--red)" : "none",
              border: "none", padding: "0.4rem 0.6rem", cursor: "pointer",
              color: selected === d.driverRef ? "#fff" : "var(--muted)",
              fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.04em",
              textTransform: "uppercase", marginBottom: "1px",
              fontFamily: "var(--sans)",
            }}>{d.driver_name}</button>
        ))}
      </div>
      <div>
        {offline && <BackendPanel detail="The driver data request failed." onRetry={retry} />}
        {!selected && !offline && <div style={{ ...card, padding: "3rem", textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.72rem", letterSpacing: "0.12em" }}>SELECT A DRIVER</p></div>}
        {loading && <SkeletonList rows={5} metrics={1} />}
        {stats && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="accent-strip">
              <h2 style={{ fontSize: "1.5rem", fontWeight: "900", fontStyle: "italic", margin: "0 0 0.2rem", letterSpacing: "0.02em" }}>{stats.career.name.toUpperCase()}</h2>
              <p style={{ fontFamily: "var(--mono)", color: "rgba(255,255,255,0.7)", fontSize: "0.65rem", letterSpacing: "0.1em", margin: 0 }}>{stats.career.races} RACES · {firstYear}–{lastYear}</p>
            </div>
            <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <StatCard label="Wins" value={stats.career.wins} accent="var(--red)" />
              <StatCard label="Podiums" value={stats.career.podiums} />
              <StatCard label="Podium %" value={`${stats.career.podium_rate}%`} />
              <StatCard label="Avg Grid" value={stats.career.avg_grid} />
              <StatCard label="Avg Finish" value={stats.career.avg_finish} />
            </div>
            <div className="chart-enter" style={{ ...card, padding: "20px" }}>
              <div className="section-label" style={{ marginBottom: "1rem" }}>Wins & Podiums Per Season</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats.by_year}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                  <XAxis dataKey="year" stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} />
                  <YAxis stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                  <Bar dataKey="wins" name="Wins" fill="#e10600" radius={0} />
                  <Bar dataKey="podiums" name="Podiums" fill="var(--dimmed)" radius={0} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-enter" style={{ ...card }}>
              <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
                <span className="section-label">Best Circuits by Podium Rate</span>
              </div>
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                {stats.circuit_stats.slice(0, 6).map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", fontWeight: "500", width: "100px", flexShrink: 0 }}>{c.circuitRef}</span>
                    <div style={{ flex: 1, height: "2px", background: "var(--dimmed)", overflow: "hidden" }}>
                      <div className="prob-bar" style={{ height: "100%", width: `${c.podium_rate * 100}%`, background: "var(--red)" }} />
                    </div>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", color: "var(--red)", fontWeight: "700", width: "36px", textAlign: "right" }}>{(c.podium_rate * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


export default DriversPage;
