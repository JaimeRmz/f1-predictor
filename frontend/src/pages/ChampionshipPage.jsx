import { useState, useEffect } from "react";
import axios from "axios";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import Panel from "../components/DashPanel.jsx";
import { BackendPanel, WakingPanel, SkeletonList } from "../shared.jsx";
import { API } from "../constants.js";
import { TEAMS, canonicalTeam } from "../teams.js";
import { teamIdByDriverName, driverCode, teamColor } from "../lib/homeModel.js";
import "./home.css";

// ── CHAMPIONSHIP · STANDINGS ───────────────────────────────────
// Everything here comes from /championship/status, which derives the standings and the points still available from the
// Jolpica-sourced CSVs. A title is shown as "clinched" only when the arithmetic says so; otherwise the page shows the
// remaining-points math. There is no model on this page and no probabilities.
const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
const SLOW_MS = 6000, TIMEOUT_MS = 70000;

const TitlePanel = ({ s, label }) => {
  const c = s.clinched_at;
  if (s.clinched) {
    return (
      <Panel title={`${label} title`} caption="Decided: the leader cannot be caught on points." tint="#00c853">
        <div className="hm-eyebrow green">● {label.toUpperCase()} CHAMPION · CONFIRMED</div>
        <div className="hm-champ big">{s.leader.name}</div>
        <p className="hm-note">
          {fmt(s.leader.points)} points. Clinched at the {c.race} (round {c.round}) with a {fmt(c.lead)}-point lead over {s.runner_up.name}
          {" "}against {fmt(c.max_points_available)} points still available: a {fmt(c.margin)}-point margin.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title={`${label} title`} caption="Still open: the arithmetic does not yet rule anyone out.">
      <div className="hm-eyebrow">{label.toUpperCase()} · NOT YET DECIDED</div>
      <div className="hm-champ big off">{s.leader.name}</div>
      <p className="hm-note">
        Leads {s.runner_up.name} by {fmt(s.points_gap)} points with {s.remaining_races} race{s.remaining_races === 1 ? "" : "s"}
        {s.remaining_sprints ? ` (${s.remaining_sprints} with a sprint)` : ""} left: {fmt(s.max_points_available)} points available.
        A lead above {fmt(s.max_points_available)} clinches it; {s.surplus < 0 ? `${fmt(-s.surplus)} short.` : "tied at the limit (countback not modelled)."}
      </p>
    </Panel>
  );
};

const statusOf = (c, i, clinched) => (i === 0 && clinched ? "CHAMPION" : c.mathematically_alive ? "IN CONTENTION" : "ELIMINATED");

const DriversTable = ({ d }) => {
  const max = Math.max(...d.contenders.map((c) => c.points), 1);
  return (
    <Panel title="Drivers' standings" caption="Official points. MAX REACHABLE is current points plus every point still available.">
      <div className="ch-tbl" role="table" aria-label="Drivers' standings">
        <div className="ch-tr ch-th" role="row"><span>POS</span><span /><span>DRIVER</span><span className="hm-hide-m" /><span>PTS</span><span className="hm-hide-m">GAP</span><span className="hm-hide-m" title="Current points plus every point still available.">MAX REACHABLE</span></div>
        {d.contenders.map((c, i) => {
          const tid = teamIdByDriverName(c.name);
          return (
            <div className="ch-tr" role="row" key={c.id} style={{ "--team": teamColor(tid) }}>
              <span className="hm-n">{c.position}</span>
              <span className="hm-tm"><i className="hm-bar" />{tid ? <TeamMark team={tid} size={22} /> : <span style={{ width: 30 }} />}</span>
              <span className="hm-drv"><b>{driverCode(c.name)}</b><span> {c.name}</span><small>{statusOf(c, i, d.clinched)}</small></span>
              <span className="hm-meter hm-hide-m" aria-hidden="true"><i style={{ width: `${(100 * c.points) / max}%` }} /></span>
              <span className="hm-v ch-pts">{fmt(c.points)}</span>
              <span className="hm-v hm-hide-m ch-dim">{i === 0 ? "LEAD" : fmt(c.gap_to_leader)}</span>
              <span className="hm-v hm-hide-m ch-dim">{fmt(c.max_reachable)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

const ConstructorsTable = ({ k }) => {
  const max = Math.max(...k.contenders.map((c) => c.points), 1);
  return (
    <Panel title="Constructors' standings" caption="Team points. MAX REACHABLE is current points plus every point still available.">
      <div className="ch-tbl" role="table" aria-label="Constructors' standings">
        <div className="ch-tr ch-th ch-team" role="row"><span>POS</span><span /><span>TEAM</span><span>PTS</span><span className="hm-hide-m" title="Current points plus every point still available.">MAX REACHABLE</span></div>
        {k.contenders.map((c, i) => {
          const tid = canonicalTeam(c.name);
          return (
            <div className="ch-tr ch-team" role="row" key={c.id} style={{ "--team": teamColor(tid) }}>
              <span className="hm-n">{c.position}</span>
              <span className="hm-tm"><i className="hm-bar" />{tid ? <TeamMark team={tid} size={22} /> : <span style={{ width: 30 }} />}</span>
              <span className="hm-drv"><b>{TEAMS[tid]?.name || c.name}</b><small>{statusOf(c, i, k.clinched)}</small>
                <span className="hm-meter" aria-hidden="true" style={{ display: "block", marginTop: 5 }}><i style={{ width: `${(100 * c.points) / max}%` }} /></span></span>
              <span className="hm-v ch-pts">{fmt(c.points)}</span>
              <span className="hm-v hm-hide-m ch-dim">{fmt(c.max_reachable)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

const ChampionshipPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);   // no HTTP response at all
  const [httpError, setHttpError] = useState(null); // server answered, but with an error
  const [slow, setSlow] = useState(false);          // still waiting after SLOW_MS

  // The request is capped so a hung server ends in a real error state instead of a skeleton forever; after SLOW_MS the
  // skeleton becomes the amber WAKING panel so the wait is explained. Nothing here ever claims a champion without data.
  const fetchStatus = () => {
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    axios.get(`${API}/championship/status`, { timeout: TIMEOUT_MS })
      .then((r) => { setData(r.data); setHttpError(null); setLoading(false); })
      .catch((e) => {
        setLoading(false);
        if (e.response) setHttpError(e.response.data?.detail || `HTTP ${e.response.status}`);
        else setOffline(true);
      })
      .finally(() => { clearTimeout(slowTimer); setSlow(false); });
    return () => clearTimeout(slowTimer);
  };
  useEffect(fetchStatus, []);
  const retry = () => { setLoading(true); setOffline(false); setHttpError(null); fetchStatus(); };

  const d = data?.drivers, k = data?.constructors;

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">{data ? `2026 FIA FORMULA ONE · AFTER ${data.as_of.race.toUpperCase()} (ROUND ${data.as_of.round} OF ${data.total_rounds})` : "2026 FIA FORMULA ONE · DERIVED FROM JOLPICA RESULTS · NO MODEL"}</div>
          <h1 className="wordfit">Championship <em>standings</em></h1>
        </div>
        {data && <div className="hm-count"><div className="hm-digits"><span>{String(d.remaining_races).padStart(2, "0")}<small>RACES TO GO</small></span></div><div className="hm-count-cap">POINTS STILL AVAILABLE: {fmt(d.max_points_available)}</div></div>}
      </header>

      {offline && <BackendPanel detail="The championship status request failed." onRetry={retry} />}
      {httpError && (
        <GlassPanel style={{ borderColor: "var(--border-red)", padding: "2rem", textAlign: "center" }}>
          <div className="hm-eyebrow red">STATUS UNAVAILABLE</div>
          <p className="hm-note">The server is up but could not compute the championship status ({String(httpError)}). No standings are shown rather than possibly-wrong ones.</p>
          <button type="button" className="hm-link" onClick={retry}>Retry</button>
        </GlassPanel>
      )}
      {loading && (slow ? <WakingPanel /> : <SkeletonList rows={6} metrics={1} />)}

      {!loading && data && (
        <>
          <div className="hm-pair">
            <TitlePanel s={d} label="Drivers'" />
            <TitlePanel s={k} label="Constructors'" />
          </div>
          <div className="hm-grid">
            <div className="hm-main"><DriversTable d={d} /></div>
            <aside className="hm-side">
              <ConstructorsTable k={k} />
              <Panel title="How this is worked out" caption="Method, in one paragraph.">
                <p className="hm-note">
                  Standings are Jolpica's official totals (sprint points included), as of round {data.as_of.round} of {data.total_rounds}.
                  A title is clinched when the leader's lead exceeds the most points the rest can still score:
                  {" "}{data.rules.driver_race_max} per race, {data.rules.driver_sprint_max} per sprint, no fastest-lap point.
                  Results can change on appeal, so this is re-derived from the data on every load.
                </p>
              </Panel>
            </aside>
          </div>
        </>
      )}
    </div>
  );
};

export default ChampionshipPage;
