import { useState, useEffect } from "react";
import axios from "axios";
import { SectionHeader, BackendPanel, SkeletonList } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { API } from "../constants.js";

// ── CHAMPIONSHIP PAGE ──────────────────────────────────────────
// Everything here comes from /championship/status, which derives the standings
// and the points still available from the Jolpica-sourced CSVs. A title is
// shown as "clinched" only when the arithmetic says so; otherwise the page
// shows the remaining-points math. There are deliberately no probabilities:
// the old heuristic "title probability" was not calibrated.
const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });

const ChampionBanner = ({ s, label }) => {
  const c = s.clinched_at;
  return (
    <GlassPanel className="chart-enter" style={{ padding: "1.25rem 1.5rem", borderLeft: "3px solid var(--green)" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.25em", color: "var(--green)" }}>
        ● {label} CHAMPION · CONFIRMED
      </div>
      <div className="hud-title" style={{ fontSize: "1.6rem", marginTop: "0.35rem", letterSpacing: "0.04em" }}>{s.leader.name}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.5rem", lineHeight: 1.8 }}>
        Clinched at the {c.race} (round {c.round}) with a {fmt(c.lead)}-point lead over {s.runner_up.name}
        {" "}against {fmt(c.max_points_available)} points still available — a {fmt(c.margin)}-point margin.
      </div>
    </GlassPanel>
  );
};

const RemainingMath = ({ s, label }) => (
  <GlassPanel className="chart-enter" style={{ padding: "1rem 1.25rem" }}>
    <div className="section-label">{label} title · not yet decided</div>
    <div style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.5rem", lineHeight: 1.8 }}>
      {s.leader.name} leads {s.runner_up.name} by {fmt(s.points_gap)} points with {s.remaining_races} race
      {s.remaining_races === 1 ? "" : "s"}{s.remaining_sprints ? ` (${s.remaining_sprints} with a sprint)` : ""} left —
      {" "}{fmt(s.max_points_available)} points available. Needs a lead above {fmt(s.max_points_available)} to clinch;
      {" "}{s.surplus < 0 ? `${fmt(-s.surplus)} short.` : "tied at the limit (countback not modelled)."}
    </div>
  </GlassPanel>
);

const ChampionshipPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  // setState only ever runs inside the async callbacks (or the retry click
  // handler below), never synchronously inside the mount effect.
  const fetchStatus = () => {
    axios.get(`${API}/championship/status`)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => { setLoading(false); setOffline(true); });
  };

  useEffect(fetchStatus, []);

  const retry = () => { setLoading(true); setOffline(false); fetchStatus(); };

  const d = data?.drivers;
  const k = data?.constructors;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader
        variant="glass"
        eyebrow="Derived from Jolpica results · No model"
        title="2026 Championship Status"
        right={data && <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "rgba(255,255,255,0.7)", textAlign: "right" }}>
          <div>{d.remaining_races} RACES REMAINING</div>
          <div>AFTER {data.as_of.race.toUpperCase()}</div>
        </div>}
      />

      {offline && <BackendPanel detail="The championship status request failed." onRetry={retry} />}
      {loading && <SkeletonList rows={6} metrics={1} />}

      {!loading && data && (
        <>
          {d.clinched ? <ChampionBanner s={d} label="DRIVERS'" /> : <RemainingMath s={d} label="Drivers'" />}
          {k.clinched ? <ChampionBanner s={k} label="CONSTRUCTORS'" /> : <RemainingMath s={k} label="Constructors'" />}

          <GlassPanel className="chart-enter">
            <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
              <span className="section-label">Drivers' Standings · What Is Still Reachable</span>
            </div>
            {d.contenders.map((c, i) => (
              <div key={c.id} className="data-row stagger-item" style={{ "--i": i, display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 1rem", borderBottom: i < d.contenders.length - 1 ? "1px solid var(--border)" : "none", opacity: c.mathematically_alive ? 1 : 0.6 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", fontWeight: 700, color: i === 0 ? "var(--red)" : "var(--muted)", width: "20px" }}>{c.position}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.name}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)", marginTop: "2px" }}>
                    {i === 0 ? "LEADER" : `${fmt(c.gap_to_leader)} PTS`} · max reachable {fmt(c.max_reachable)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: 700 }}>{fmt(c.points)}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", marginTop: "2px" }}>
                    {i === 0 && d.clinched ? "CHAMPION" : c.mathematically_alive ? "IN CONTENTION" : "ELIMINATED"}
                  </div>
                </div>
              </div>
            ))}
          </GlassPanel>

          <GlassPanel style={{ padding: "20px", display: "flex", gap: "0.75rem" }}>
            <span style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.65rem", fontWeight: 700, flexShrink: 0 }}>METHOD</span>
            <p style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
              Standings are Jolpica's official totals (sprint points included), as of round {data.as_of.round} of {data.total_rounds}.
              A title is clinched when the leader's lead exceeds the most points the rest can still score:
              {" "}{data.rules.driver_race_max} per race, {data.rules.driver_sprint_max} per sprint, no fastest-lap point.
              Results can change on appeal, so this is re-derived from the data on every load.
            </p>
          </GlassPanel>
        </>
      )}
    </div>
  );
};


export default ChampionshipPage;
