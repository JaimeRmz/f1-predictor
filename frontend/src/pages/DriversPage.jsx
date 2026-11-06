import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BackendPanel, SkeletonList } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TelemetryTraces } from "../components/TelemetryTraces.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import Panel from "../components/DashPanel.jsx";
import { API } from "../constants.js";
import { TEAMS } from "../teams.js";
import { teamIdOf, teamColor } from "../lib/homeModel.js";
import "./home.css";

// ── CHAMPIONSHIP · DRIVERS ─────────────────────────────────────
// Career explorer. Team logo and colour appear only for drivers on the current grid (or with a known override);
// historical drivers show their name alone rather than a guessed team.
const tidOf = (ref) => teamIdOf({ driverRef: ref });

const DriversPage = () => {
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  // setState only ever runs inside the async callbacks (or the retry click handler below), never synchronously inside
  // the mount effect.
  const fetchRoster = () => {
    axios.get(`${API}/drivers`).then((r) => setDrivers(r.data)).catch(() => setOffline(true));
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
  const lastYear = stats?.by_year?.[stats.by_year.length - 1]?.year;
  const tid = selected ? tidOf(selected) : null;
  const color = tid ? teamColor(tid) : null;

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">CAREER EXPLORER · 2010–2026</div>
          <h1 className="wordfit">Driver <em>explorer</em></h1>
        </div>
      </header>

      <div className="dr-grid">
        <GlassPanel className="hm-panel" tilt={false}>
          <div className="hm-panel-h"><h2>All drivers</h2><p>Pick a driver to see their career.</p></div>
          <div className="dr-list" role="listbox" aria-label="Drivers">
            {drivers.length === 0 && !offline && (
              <div aria-hidden="true" style={{ padding: "0.25rem 0.6rem" }}>
                {Array.from({ length: 14 }, (_, i) => (
                  <div key={i} className="skeleton-block" style={{ height: "16px", width: `${55 + ((i * 17) % 35)}%`, margin: "0.55rem 0" }} />
                ))}
              </div>
            )}
            {drivers.map((d) => {
              const t = tidOf(d.driverRef);
              return (
                <button key={d.driverRef} type="button" role="option" aria-selected={selected === d.driverRef} onClick={() => loadDriver(d.driverRef)}
                  className={`dr-item${selected === d.driverRef ? " on" : ""}`} style={{ "--team": teamColor(t) }}>
                  <i className="hm-bar" style={{ visibility: t ? "visible" : "hidden" }} />
                  {t ? <TeamMark team={t} size={16} /> : <span style={{ width: 22 }} />}
                  <span>{d.driver_name}</span>
                </button>
              );
            })}
          </div>
        </GlassPanel>

        <div className="hm-main">
          {offline && <BackendPanel detail="The driver data request failed." onRetry={retry} />}
          {!selected && !offline && (
            <GlassPanel style={{ padding: "4rem 3rem", minHeight: "260px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", textAlign: "center" }}>
              <span style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", zIndex: 0 }}><TelemetryTraces opacity={0.2} /></span>
              <span style={{ position: "relative", zIndex: 2, width: "8px", height: "8px", borderRadius: "50%", background: "var(--red)", animation: "pulse 1.6s ease-in-out infinite" }} />
              <p className="hm-note" style={{ position: "relative", zIndex: 2, margin: 0, letterSpacing: "0.12em" }}>SELECT A DRIVER</p>
            </GlassPanel>
          )}
          {loading && <SkeletonList rows={5} metrics={1} />}
          {stats && !loading && (
            <>
              <GlassPanel tint={color} className="hm-panel" tilt={false} style={{ padding: "1.2rem 1.4rem", "--team": color }}>
                <div className="dr-head">
                  <div>
                    <div className="hm-eyebrow">{stats.career.races} RACES · {firstYear}–{lastYear}{tid ? ` · ${TEAMS[tid]?.name.toUpperCase()}` : ""}</div>
                    <h2 className="dr-name">{stats.career.name}</h2>
                  </div>
                  {tid && <TeamMark team={tid} size={40} />}
                </div>
              </GlassPanel>

              <Panel title="Career at a glance" caption="Totals over every race in the data.">
                <div className="hm-tiles">
                  {[["WINS", stats.career.wins, true], ["PODIUMS", stats.career.podiums], ["PODIUM RATE", `${stats.career.podium_rate}%`], ["AVG GRID", stats.career.avg_grid], ["AVG FINISH", stats.career.avg_finish]].map(([l, v, hot]) => (
                    <div key={l} className="hm-tile"><label>{l}</label><b className={hot ? "red" : ""}>{v}</b></div>
                  ))}
                </div>
              </Panel>

              <div className="hm-pair">
                <Panel title="Wins and podiums per season" caption="Red bars are wins, grey bars are podium finishes.">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.by_year}>
                      <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                      <XAxis dataKey="year" stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.7)", fontSize: 10, fontFamily: "var(--mono)" }} />
                      <YAxis stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.7)", fontSize: 10, fontFamily: "var(--mono)" }} />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                      <Bar dataKey="wins" name="Wins" fill="#e10600" radius={0} />
                      <Bar dataKey="podiums" name="Podiums" fill="rgba(236,236,236,0.28)" radius={0} />
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>
                <Panel title="Best circuits" caption="Share of races at each circuit that ended on the podium, with how many races that is based on. One or two races is limited history.">
                  <div className="dr-circuits">
                    {stats.circuit_stats.slice(0, 6).map((c, i) => (
                      <div key={i} className="dr-circ">
                        <span>{c.circuitRef}</span>
                        <div className="hm-meter" aria-hidden="true"><i style={{ width: `${c.podium_rate * 100}%`, background: "var(--red)", opacity: c.races <= 2 ? 0.45 : 1 }} /></div>
                        <b>{(c.podium_rate * 100).toFixed(0)}%<small>{c.races} race{c.races === 1 ? "" : "s"}{c.races <= 2 ? " · limited history" : ""}</small></b>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriversPage;
