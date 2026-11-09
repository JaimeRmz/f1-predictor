import { useState, useEffect } from "react";
import axios from "axios";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import RaceStrip from "../components/RaceStrip.jsx";
import TitleRow from "../components/RaceTitle.jsx";
import Forecast from "../components/ForecastTable.jsx";
import Panel from "../components/DashPanel.jsx";
import RaceSimBand from "../components/RaceSimBand.jsx";
import ScoreFigure from "../components/ScoreFigure.jsx";
import { useRaceRows } from "../lib/useRaceRows.js";
import { tz, dayTime } from "../lib/timeFmt.js";
import { BackendPanel, WakingPanel, SkeletonList } from "../shared.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { API, NEXT_RACE } from "../constants.js";
import { TEAMS } from "../teams.js";
import {
  BACKTEST, raceNote, defaultRound, raceByRound, phaseOf,
  rankRows, teamColor, pctLabel, classifySnapshot, actualTop3, lastRaceFor, driverCode, teamIdOf,
} from "../lib/homeModel.js";
import "./home.css";
import "./homeClean.css";

// ── HOME · pit-wall dashboard ──────────────────────────────────
// Every number comes from the same sources the other pages use: /whatif (upcoming rounds, predicted grid),
// /predict/{raceId} (completed rounds, real grid), /championship/status, and the model_snapshots table. Calendar,
// sessions and logos are local. Nothing is invented: when a source is missing or still loading, the panel says so.
// Scores are shown as shares of the field (see normalizeShares); the raw model score is in each tooltip.
const TIMEOUT_MS = 70000;

const useChampionship = () => {
  const [s, setS] = useState({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    axios.get(`${API}/championship/status`, { timeout: TIMEOUT_MS })
      .then((r) => setS({ status: "ready", data: r.data }))
      .catch(() => setS({ status: "error", data: null }));
  }, [attempt]);
  const retry = () => { setS({ status: "loading", data: null }); setAttempt((a) => a + 1); };
  return { ...s, retry };
};

// Frozen pre-race picks for the "last race" round. unavailable = the request itself failed.
const useSnapshot = (race) => {
  const [res, setRes] = useState({});
  const id = race?.raceId;
  useEffect(() => {
    if (!id || res[id]) return;
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: "timeout" }), 10000)); // never "checking…" forever
    Promise.race([
      supabase.from("model_snapshots").select("race_id, predicted_p1, predicted_p2, predicted_p3, snapshotted_at").eq("race_id", id).limit(1),
      timeout,
    ])
      .then(({ data, error }) => setRes((p) => ({ ...p, [id]: error ? { loaded: false } : { loaded: true, snap: (data || [])[0] || null } })))
      .catch(() => setRes((p) => ({ ...p, [id]: { loaded: false } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return id ? (res[id] || { pending: true }) : { loaded: true, snap: null };
};

// ── pieces ─────────────────────────────────────────────────────
const Top3Card = ({ r, i }) => {
  const color = teamColor(r.teamId);
  return (
    <GlassPanel tint={color} className="hm-top" style={{ "--team": color }}>
      <div className="hm-top-head"><span className="hm-pos">P{i + 1}<em> · {TEAMS[r.teamId]?.name || "Team unknown"}</em></span><TeamMark team={r.teamId} size={26} /></div>
      <div className="hm-top-name"><span className="hm-bar" />{r.driver_name}</div>
      <div className="hm-top-scores">
        <div><label className="gold">WIN SHARE</label><b className="gold"><ScoreFigure raw={r.win}>{pctLabel(r.winPct, r.winShare)}</ScoreFigure></b></div>
        <div><label className="teal">PODIUM SHARE</label><b className="teal"><ScoreFigure raw={r.podium}>{pctLabel(r.podiumPct, r.podiumShare)}</ScoreFigure></b></div>
      </div>
    </GlassPanel>
  );
};

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
const Retry = ({ onRetry, text }) => <p className="hm-note">{text} <button type="button" className="hm-link" onClick={onRetry}>Retry</button></p>;

const ChampionPanel = ({ champ }) => {
  if (champ.status === "loading") return <Panel title="Who is champion?" caption="Points standings, no model involved."><div className="skeleton-block" style={{ height: 70 }} /></Panel>;
  if (champ.status === "error") return <Panel title="Who is champion?" caption="Points standings, no model involved."><Retry onRetry={champ.retry} text="Standings could not be loaded." /></Panel>;
  const d = champ.data.drivers, k = champ.data.constructors, c = d.clinched_at;
  return (
    <Panel title="Who is champion?" caption="Points standings, no model involved." tint={d.clinched ? "#00c853" : undefined}>
      {d.clinched ? (
        <>
          <div className="hm-eyebrow green">● DRIVERS' CHAMPION · CONFIRMED</div>
          <div className="hm-champ">{d.leader.name}</div>
          <p className="hm-note">{fmt(d.leader.points)} points, {fmt(c.lead)} clear of {d.runner_up.name} with {fmt(c.max_points_available)} still available. Clinched at the {c.race} (round {c.round}) with a {fmt(c.margin)}-point margin.</p>
        </>
      ) : (
        <>
          <div className="hm-eyebrow">DRIVERS' TITLE · NOT YET DECIDED</div>
          <div className="hm-champ">{d.leader.name}</div>
          <p className="hm-note">Leads {d.runner_up.name} by {fmt(d.points_gap)} points with {fmt(d.max_points_available)} available over {d.remaining_races} race{d.remaining_races === 1 ? "" : "s"}.</p>
        </>
      )}
      <p className="hm-note dim">{k.clinched
        ? `Constructors' title: ${k.leader.name}, clinched at the ${k.clinched_at.race} (round ${k.clinched_at.round}).`
        : `Constructors' title not yet decided: ${k.leader.name} leads by ${fmt(k.points_gap)} with ${fmt(k.max_points_available)} available.`}</p>
    </Panel>
  );
};

const bar = (hits, ci) => (
  <div className="hm-rel-bar" aria-hidden="true"><i style={{ width: `${(100 * hits) / BACKTEST.races}%` }} /><u style={{ left: `${ci[0] * 100}%`, width: `${(ci[1] - ci[0]) * 100}%` }} /></div>
);
const ReliabilityPanel = () => {
  const m = BACKTEST.model, s = BACKTEST.standingsLeader, n = BACKTEST.races;
  return (
    <Panel title="How reliable is this?" caption="Before qualifying, the model is not shown to beat simply picking the points leader.">
      <div className="hm-rel">
        <div><label className="teal">MODEL'S WINNER PICK</label><b className="teal">{Math.round((100 * m.hits) / n)}%</b><small>{m.hits} of {n} past races</small>{bar(m.hits, m.ci)}</div>
        <div><label>POINTS LEADER PICK</label><b>{Math.round((100 * s.hits) / n)}%</b><small>{s.hits} of {n} past races</small>{bar(s.hits, s.ci)}</div>
      </div>
      <p className="hm-note dim">Backtest on {n} races the model had not seen (2025–2026), using its pre-qualifying prediction. Thin line = 95% range; the two ranges overlap widely, so neither is clearly better. The forecast pipeline was corrected so forecasts include the latest race; these figures were recomputed on the same races and are not significantly different from the earlier ones.</p>
    </Panel>
  );
};

const nameOf = (rows, ref) => { const h = rows.find((d) => d.driverRef === ref); return h ? { code: driverCode(h.driver_name), name: h.driver_name, teamId: teamIdOf(h) } : { code: ref?.slice(0, 3).toUpperCase() || "—", name: ref || "—", teamId: null }; };
const Podium3 = ({ list, tone }) => (
  <ol className={`hm-p3 ${tone}`}>{list.map((d, i) => (
    <li key={i} style={{ "--team": teamColor(d.teamId) }}><b>{i + 1}</b><i className="hm-bar" /><TeamMark team={d.teamId} size={18} /><span>{d.code}</span><em>{d.name}</em></li>
  ))}</ol>
);

const LastRacePanel = ({ race, last, rows, snap }) => {
  if (!last) return <Panel title="Last race: model vs result" caption="Pre-race pick next to what actually happened."><p className="hm-note">No completed race before this round.</p></Panel>;
  const sameAsSelected = race.round === last.round;
  const title = sameAsSelected ? "This race: model vs result" : "Last race: model vs result";
  const cap = `${last.name} (R${last.round}). Green is what actually happened.`;
  if (!rows) return <Panel title={title} caption={cap}><div className="skeleton-block" style={{ height: 90 }} /></Panel>;
  if (rows.status === "error") return <Panel title={title} caption={cap}><p className="hm-note">The result for this race could not be loaded.</p></Panel>;
  const actual = actualTop3(rows.rows).map((r) => nameOf(rows.rows, r.driverRef));
  const kind = snap.pending ? "pending" : classifySnapshot(last, snap.snap, snap.loaded);
  const picks = kind === "genuine" ? [snap.snap.predicted_p1, snap.snap.predicted_p2, snap.snap.predicted_p3].map((ref) => nameOf(rows.rows, ref)) : null;
  const hits = picks ? picks.filter((p) => actual.some((a) => a.name === p.name)).length : 0;
  const MSG = {
    pending: "Checking for a pre-race snapshot…",
    none: "No pre-race snapshot was frozen for this race, so there is no foresight pick to show.",
    "after-cutoff": "The only snapshot for this race was taken after the qualifying cutoff, so it is not shown as a prediction.",
    unavailable: "Pre-race snapshots could not be loaded right now, so no model pick is shown.",
  };
  return (
    <Panel title={title} caption={cap}>
      <div className="hm-two">
        <div><label className="teal">MODEL'S TOP 3 · FROZEN BEFORE QUALIFYING</label>{picks ? <Podium3 list={picks} tone="teal" /> : <p className="hm-note">{MSG[kind]}</p>}</div>
        <div><label className="green">ACTUAL TOP 3</label>{actual.length === 3 ? <Podium3 list={actual} tone="green" /> : <p className="hm-note">Finishing order not available.</p>}</div>
      </div>
      {picks && actual.length === 3 && <p className="hm-note dim">{hits} of 3 podium places named.</p>}
      {picks && actual.length === 3 && (
        <p className="hm-note hm-verdict">{picks[0].name === actual[0].name ? `The model's winner pick (${picks[0].name}) won.` : `The model picked ${picks[0].name} to win; ${actual[0].name} won.`}</p>
      )}
    </Panel>
  );
};

const SchedulePanel = ({ race }) => {
  const sessions = race.raceId === NEXT_RACE.raceId ? NEXT_RACE.sessions : null;
  return (
    <Panel title="Session schedule" caption={`Your local time (${tz}).`}>
      {sessions ? (
        <ul className="hm-sched">{sessions.map((s) => (
          <li key={s.session} className={s.featured ? "race" : ""}><span>{s.session}</span><time dateTime={s.iso}>{dayTime.format(new Date(s.iso))}</time></li>
        ))}</ul>
      ) : <p className="hm-note">{race.kind === "completed" ? "This round is complete." : "Session times for this round are not in the app yet."}</p>}
    </Panel>
  );
};

// ── page ───────────────────────────────────────────────────────
const HomePage = ({ onOpenReplay = null }) => {
  const [round, setRound] = useState(defaultRound);
  const race = raceByRound(round) || raceByRound(defaultRound());
  const last = lastRaceFor(race);
  const { res, slow, retry } = useRaceRows(last && last.raceId !== race.raceId ? [race, last] : [race]);
  const champ = useChampionship();
  const snap = useSnapshot(last);
  const phase = phaseOf(race);
  const cur = res[race.raceId];
  const ranked = cur?.status === "ready" ? rankRows(cur.rows) : [];
  const through = champ.data?.as_of?.round;

  return (
    <div className="hm home">
      <RaceStrip round={race.round} onSelect={setRound} />
      <TitleRow race={race} phase={phase} brand />

      {ranked.length > 0 && (
        <section aria-labelledby="hm-top3">
          <div className="hm-sec">
            <h2 id="hm-top3">Model's top 3</h2>
            <span>3-MODEL XGBOOST{through ? ` · DATA THRU R${through}` : ""}</span>
          </div>
          <div className="hm-top3">{ranked.slice(0, 3).map((r, i) => <Top3Card key={r.driverRef} r={r} i={i} />)}</div>
        </section>
      )}
      {ranked.length > 0 && <RaceSimBand key={race.raceId} race={race} rows={cur.rows} onOpenFull={onOpenReplay} raceOver={phase === "final-pending"} />}
      <div className="hm-grid">
        <div className="hm-main">
          {ranked.length > 0 && <Forecast ranked={ranked} note={raceNote(race.raceId)} />}
          <LastRacePanel race={race} last={last} rows={last ? res[last.raceId] : null} snap={snap} />
        {!cur && (slow ? <WakingPanel /> : <SkeletonList rows={5} metrics={2} />)}
        {cur?.status === "error" && (cur.http
          ? (
            <GlassPanel style={{ borderColor: "var(--border-red)", padding: "2rem", textAlign: "center" }}>
              <div className="hm-eyebrow red">FORECAST UNAVAILABLE</div>
              <p className="hm-note">The server is up but could not compute this forecast ({String(cur.http)}). Nothing is shown rather than possibly-wrong scores.</p>
              <button type="button" className="hm-link" onClick={retry}>Retry</button>
            </GlassPanel>
          )
          : <BackendPanel detail="The forecast request failed." onRetry={retry} />)}
        </div>
        <aside className="hm-side">
          <ChampionPanel champ={champ} />
          <ReliabilityPanel />
          <SchedulePanel race={race} />
        </aside>
      </div>
    </div>
  );
};

export default HomePage;
