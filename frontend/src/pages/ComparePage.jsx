import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DriverSelector, BackendPanel, SkeletonList } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import Panel from "../components/DashPanel.jsx";
import { API } from "../constants.js";
import { TEAMS } from "../teams.js";
import { teamIdOf, teamColor } from "../lib/homeModel.js";
import "./home.css";

// ── MORE · COMPARE ─────────────────────────────────────────────
// Career stats and a circuit-by-circuit podium rate for two drivers. Team logo and colour only for current-grid drivers.
const ROWS = [["Wins", "wins"], ["Podiums", "podiums"], ["Podium rate", "podium_rate", "%"], ["Avg grid", "avg_grid"], ["Avg finish", "avg_finish"], ["DNF rate", "dnf_rate", "%"]];
// Which direction is "better" for each stat (so the better value can be marked); null = no judgement.
const BETTER = { wins: "high", podiums: "high", podium_rate: "high", avg_grid: "low", avg_finish: "low", dnf_rate: "low" };

const ComparePage = () => {
  const [drivers, setDrivers] = useState([]);
  const [d1, setD1] = useState("");
  const [d2, setD2] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    axios.get(`${API}/drivers`).then((r) => setDrivers(r.data)).catch(() => setOffline(true));
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
    if (drivers.length === 0) axios.get(`${API}/drivers`).then((r) => setDrivers(r.data)).catch(() => setOffline(true));
    if (d1 && d2) compare();
  };

  const t1 = d1 ? teamIdOf({ driverRef: d1 }) : null;
  const t2 = d2 ? teamIdOf({ driverRef: d2 }) : null;
  const better = (key, a, b) => {
    const dir = BETTER[key];
    if (!dir || a === b || !Number.isFinite(a) || !Number.isFinite(b)) return [false, false];
    return dir === "high" ? [a > b, b > a] : [a < b, b < a];
  };

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">CAREER STATS · HEAD TO HEAD</div>
          <h1 className="wordfit">Compare <em>drivers</em></h1>
        </div>
      </header>

      <Panel title="Pick two drivers" caption="Any two drivers from 2010 to 2026, past or present.">
        <div className="cp-pick">
          {[["Driver 1", d1, setD1], ["Driver 2", d2, setD2]].map(([label, val, set]) => (
            <div key={label}>
              <label>{label.toUpperCase()}</label>
              <DriverSelector drivers={drivers} value={val} onSelect={set} placeholder="Select..." />
            </div>
          ))}
        </div>
        <button type="button" className="hm-more" style={{ margin: "1rem 0 0", width: "100%" }} onClick={compare} disabled={!d1 || !d2}>COMPARE →</button>
        {(!d1 || !d2) && <p className="hm-note dim">Choose both drivers to enable the comparison.</p>}
      </Panel>

      {offline && <BackendPanel detail="The driver comparison request failed." onRetry={retry} />}
      {loading && <SkeletonList rows={5} metrics={2} />}

      {data && !loading && (
        <>
          <Panel title="Career side by side" caption="The better value in each row is marked. Lower is better for grid, finish and DNF rate.">
            <div className="cp-tbl" role="table" aria-label="Career comparison">
              <div className="cp-tr cp-th" role="row">
                <span />
                {[[data.driver1, t1], [data.driver2, t2]].map(([d, t], i) => (
                  <span key={i} className="cp-who" style={{ "--team": teamColor(t) }}>{t && <TeamMark team={t} size={22} />}<b>{d.name}</b>{t && <small>{TEAMS[t].name}</small>}</span>
                ))}
              </div>
              <div className="cp-tr" role="row"><span className="cp-l">RACES</span><span className="cp-v">{data.driver1.races}</span><span className="cp-v">{data.driver2.races}</span></div>
              {ROWS.map(([label, key, suf]) => {
                const [b1, b2] = better(key, data.driver1[key], data.driver2[key]);
                return (
                  <div className="cp-tr" role="row" key={key}>
                    <span className="cp-l">{label.toUpperCase()}</span>
                    <span className={`cp-v${b1 ? " best" : ""}`}>{data.driver1[key]}{suf || ""}{b1 && <i title="Better"> ▲</i>}</span>
                    <span className={`cp-v${b2 ? " best" : ""}`}>{data.driver2[key]}{suf || ""}{b2 && <i title="Better"> ▲</i>}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {data.head_to_head.length > 0 ? (
            <Panel title="Podium rate by circuit" caption="Share of each driver's races at a circuit that ended on the podium. The data has no race counts, so a circuit with one race shows 0% or 100%.">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.head_to_head}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                  <XAxis dataKey="circuit" stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.7)", fontSize: 9, fontFamily: "var(--mono)" }} />
                  <YAxis stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.7)", fontSize: 10, fontFamily: "var(--mono)" }} unit="%" />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                  <Legend wrapperStyle={{ fontSize: "0.7rem", fontFamily: "var(--mono)" }} />
                  <Bar dataKey="driver1_podium_rate" name={data.driver1.name.split(" ").pop()} fill="#e10600" radius={0} />
                  <Bar dataKey="driver2_podium_rate" name={data.driver2.name.split(" ").pop()} fill="rgba(236,236,236,0.45)" radius={0} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          ) : (
            <Panel title="Podium rate by circuit" caption="Where both drivers have raced the same circuits."><p className="hm-note">These two drivers have no circuits in common in the data, so there is nothing to compare here.</p></Panel>
          )}
        </>
      )}

      {!data && !loading && !offline && (
        <GlassPanel style={{ padding: "2.5rem 2rem", textAlign: "center" }}>
          <p className="hm-note" style={{ margin: 0, letterSpacing: "0.14em" }}>NO COMPARISON YET · PICK TWO DRIVERS ABOVE</p>
        </GlassPanel>
      )}
    </div>
  );
};

export default ComparePage;
