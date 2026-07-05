import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { Spinner, DriverSelector, OfflinePanel } from "../shared.jsx";
import { API, card } from "../constants.js";

// ── COMPARE PAGE ───────────────────────────────────────────────
const ComparePage = () => {
  const [drivers, setDrivers] = useState([]);
  const [d1, setD1] = useState(""); const [d2, setD2] = useState("");
  const [data, setData] = useState(null); const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    axios.get(`${API}/drivers`).then(r => setDrivers(r.data)).catch(() => setOffline(true));
  }, []);

  const compare = async () => {
    if (!d1 || !d2) return;
    setLoading(true); setData(null); setOffline(false);
    try {
      const res = await axios.get(`${API}/compare?driver1=${d1}&driver2=${d2}`);
      setData(res.data);
    } catch {
      setOffline(true);
    }
    setLoading(false);
  };

  const retry = () => {
    setOffline(false);
    if (drivers.length === 0) axios.get(`${API}/drivers`).then(r => setDrivers(r.data)).catch(() => setOffline(true));
    if (d1 && d2) compare();
  };

  return (
    <div>
      <div style={{ ...card, padding: "1.25rem", marginBottom: "1rem" }}>
        <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          {[["Driver 1", d1, setD1], ["Driver 2", d2, setD2]].map(([label, val, set]) => (
            <div key={label}>
              <div className="section-label" style={{ marginBottom: "0.5rem" }}>{label}</div>
              <DriverSelector drivers={drivers} value={val} onSelect={set} placeholder="Select..." />
            </div>
          ))}
        </div>
        <button onClick={compare} className="btn-primary" style={{ width: "100%", padding: "0.85rem", background: "var(--red)", color: "#fff", border: "none", fontSize: "0.78rem", fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--mono)" }}>
          COMPARE →
        </button>
      </div>

      {offline && <OfflinePanel detail="The driver comparison request failed." onRetry={retry} />}

      {loading && <Spinner text="COMPARING DRIVERS..." />}

      {data && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {[data.driver1, data.driver2].map((d, i) => (
              <div key={i} className="stat-card-enter" style={i === 0 ? { background: "var(--red)", padding: "1.25rem" } : { ...card, padding: "1.25rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: "900", fontStyle: "italic", margin: "0 0 1rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{d.name}</h3>
                {[["Wins", "wins"], ["Podiums", "podiums"], ["Podium Rate", "podium_rate", "%"], ["Avg Grid", "avg_grid"], ["Avg Finish", "avg_finish"], ["DNF Rate", "dnf_rate", "%"]].map(([label, key, suf]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: i === 0 ? "rgba(255,255,255,0.65)" : "var(--muted)", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", fontWeight: "700" }}>{d[key]}{suf || ""}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {data.head_to_head.length > 0 && (
            <div className="chart-enter" style={{ ...card, padding: "20px" }}>
              <div className="section-label" style={{ marginBottom: "1rem" }}>Head to Head · Podium % by Circuit</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.head_to_head}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                  <XAxis dataKey="circuit" stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 9, fontFamily: "var(--mono)" }} />
                  <YAxis stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} unit="%" />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem", fontFamily: "var(--mono)" }} />
                  <Bar dataKey="driver1_podium_rate" name={data.driver1.name.split(" ").pop()} fill="#e10600" radius={0} />
                  <Bar dataKey="driver2_podium_rate" name={data.driver2.name.split(" ").pop()} fill="var(--dimmed)" radius={0} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


export default ComparePage;
