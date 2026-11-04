import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import { BackendPanel, WakingPanel, SkeletonList } from "../shared.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { API, NEXT_RACE, STANDINGS_GRID_2026 } from "../constants.js";
import { TEAMS } from "../teams.js";
import {
  CALENDAR, BACKTEST, PHASE_LABEL, defaultRound, raceByRound, titleParts, phaseOf, countdownTarget, countdownParts,
  rankRows, teamColor, shareLabel, score, classifySnapshot, actualTop3, lastRaceFor, driverCode, teamIdOf,
} from "../lib/homeModel.js";
import "./home.css";

// ── HOME · pit-wall dashboard ──────────────────────────────────
// Every number comes from the same sources the other pages use: /whatif (upcoming rounds, predicted grid),
// /predict/{raceId} (completed rounds, real grid), /championship/status, and the model_snapshots table. Calendar,
// sessions and logos are local. Nothing is invented: when a source is missing or still loading, the panel says so.
// Scores are the model's raw 0-1 outputs, never percentages; they do not add up to 100%.
const TIMEOUT_MS = 70000, SLOW_MS = 6000;

const fetchRows = (race) => (race.kind === "completed"
  ? axios.get(`${API}/predict/${race.raceId}`, { timeout: TIMEOUT_MS })
  : axios.post(`${API}/whatif?circuitRef=${race.circuitRef}&auto_quali=true`, STANDINGS_GRID_2026, { timeout: TIMEOUT_MS })
).then((r) => r.data);

// One cache of per-race rows, filled lazily for the selected round and the "last race" round. Switching back to a
// round already loaded is instant. A failed round is cached as an error until Retry (or the backend panel's auto-retry).
const useRaceRows = (races) => {
  const [res, setRes] = useState({});
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const started = useRef(new Set());
  const key = races.filter(Boolean).map((r) => r.raceId).join(",");

  useEffect(() => {
    const todo = races.filter((r) => r && !started.current.has(r.raceId));
    if (!todo.length) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    todo.forEach((race) => {
      started.current.add(race.raceId);
      fetchRows(race)
        .then((rows) => setRes((p) => ({ ...p, [race.raceId]: { status: "ready", rows } })))
        .catch((e) => setRes((p) => ({ ...p, [race.raceId]: { status: "error", http: e.response ? (e.response.data?.detail || `HTTP ${e.response.status}`) : null } })))
        .finally(() => setSlow(false));
    });
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => {
    setRes((p) => {
      const next = { ...p };
      Object.keys(next).forEach((id) => { if (next[id].status === "error") { delete next[id]; started.current.delete(Number(id)); } });
      return next;
    });
    setAttempt((a) => a + 1);
  }, []);
  return { res, slow, retry };
};

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

const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "local time";
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pad = (n) => String(n).padStart(2, "0");

// ── pieces ─────────────────────────────────────────────────────
const RaceStrip = ({ round, onSelect }) => {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    ref.current?.querySelector("[aria-pressed='true']")?.scrollIntoView({ inline: "center", block: "nearest" });
    measure();
  }, [round, measure]);
  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure]);
  const nudge = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  // Arrow keys move focus between chips, Home/End jump to the ends; the focused chip scrolls into view.
  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const chips = [...ref.current.querySelectorAll(".hm-chip")];
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    const next = step ? chips[i + step] : e.key === "Home" ? chips[0] : e.key === "End" ? chips[chips.length - 1] : null;
    if (!step && !next) return;
    e.preventDefault();
    next?.focus();
    next?.scrollIntoView({ inline: "nearest", block: "nearest" });
  };
  return (
    <div className="hm-stripwrap">
      <button type="button" className="hm-arrow l" aria-label="Scroll races left" disabled={!edge.l} onClick={() => nudge(-1)}>‹</button>
      <nav className="hm-strip" ref={ref} aria-label="Choose a race" onScroll={measure} onKeyDown={onKey}>
        {CALENDAR.map((r) => (
          <button key={r.round} type="button" className={`hm-chip${r.kind === "completed" ? " done" : ""}`} aria-pressed={r.round === round} onClick={() => onSelect(r.round)}>
            <b>R{r.round}</b><span>{r.short}</span>{r.next && <i title="Next race" />}
          </button>
        ))}
      </nav>
      <button type="button" className="hm-arrow r" aria-label="Scroll races right" disabled={!edge.r} onClick={() => nudge(1)}>›</button>
      <span className={`hm-fade l${edge.l ? " on" : ""}`} aria-hidden="true" />
      <span className={`hm-fade r${edge.r ? " on" : ""}`} aria-hidden="true" />
    </div>
  );
};

const Countdown = ({ race }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const tgt = countdownTarget(race, now);
  if (!tgt) {
    return <div className="hm-count off"><div className="hm-count-cap">{race.kind === "completed" ? "RACE COMPLETED" : "SESSION TIMES NOT IN THE APP YET"}</div></div>;
  }
  const p = countdownParts(tgt.at - now);
  return (
    <div className="hm-count" role="timer" aria-label={`${p.d} days ${p.h} hours ${p.m} minutes ${p.s} seconds ${tgt.label.toLowerCase()}`}>
      <div className="hm-digits">
        {[[p.d, "D"], [p.h, "H"], [p.m, "M"], [p.s, "S"]].map(([v, u]) => <span key={u}>{pad(v)}<small>{u}</small></span>)}
      </div>
      <div className="hm-count-cap">{tgt.label} · {dayTime.format(new Date(tgt.at))} {tz}</div>
    </div>
  );
};

const TitleRow = ({ race, phase }) => {
  const { base, suffix } = titleParts(race.name);
  const where = race.raceId === NEXT_RACE.raceId ? NEXT_RACE.location : race.circuit; // only places the app actually knows
  return (
    <header className="hm-title">
      <div>
        <div className="hm-eyebrow">ROUND {race.round}{where ? ` · ${where.toUpperCase()}` : ""} · {PHASE_LABEL[phase]}</div>
        <h1>{base} <em>Grand Prix</em>{suffix && <span> {suffix}</span>}</h1>
      </div>
      <Countdown race={race} />
    </header>
  );
};

const Top3Card = ({ r, i }) => {
  const color = teamColor(r.teamId);
  return (
    <GlassPanel tint={color} className="hm-top" style={{ "--team": color }}>
      <div className="hm-top-head"><span className="hm-pos">P{i + 1}</span><TeamMark team={r.teamId} size={34} /></div>
      <div className="hm-top-name"><span className="hm-bar" />{r.driver_name}</div>
      <div className="hm-top-team">{r.code} · {TEAMS[r.teamId]?.name || "Team unknown"}</div>
      <div className="hm-top-scores">
        <div title={`raw model score ${score(r.win)}`}><label className="gold">WIN SHARE</label><b className="gold">{shareLabel(r.winShare)}</b></div>
        <div title={`raw model score ${score(r.podium)}`}><label className="teal">PODIUM SHARE</label><b className="teal">{shareLabel(r.podiumShare)}</b></div>
      </div>
    </GlassPanel>
  );
};

const SHOW_DEFAULT = 10;
const Forecast = ({ ranked }) => {
  const [all, setAll] = useState(false);
  const shown = all ? ranked : ranked.slice(0, SHOW_DEFAULT);
  const max = Math.max(...ranked.map((r) => r.podiumShare ?? 0), 0.0001);
  return (
    <GlassPanel className="hm-panel" tilt={false}>
      <div className="hm-panel-h"><h2>Full forecast</h2><p>Relative strength inside this race's field, not a calibrated chance. Win shares add up to 100%. Hover a figure for the raw model score.</p></div>
      <div className="hm-tbl" role="table" aria-label="Forecast">
        <div className="hm-tr hm-th" role="row"><span>POS</span><span /><span>DRIVER</span><span className="hm-hide-m">PODIUM SHARE</span><span className="gold">WIN SHARE</span><span className="teal">PODIUM SHARE</span></div>
        {shown.map((r) => (
          <div className="hm-tr" role="row" key={r.driverRef} style={{ "--team": teamColor(r.teamId) }}>
            <span className="hm-n">{r.pos}</span>
            <span className="hm-tm"><i className="hm-bar" /><TeamMark team={r.teamId} size={22} /></span>
            <span className="hm-drv"><b>{r.code}</b><span className="hm-hide-m"> {r.driver_name}</span></span>
            <span className="hm-meter hm-hide-m" aria-hidden="true"><i style={{ width: `${(100 * (r.podiumShare ?? 0)) / max}%` }} /></span>
            <span className="gold hm-v" title={`raw model score ${score(r.win)}`}>{shareLabel(r.winShare)}</span>
            <span className="teal hm-v" title={`raw model score ${score(r.podium)}`}>{shareLabel(r.podiumShare)}</span>
          </div>
        ))}
      </div>
      {ranked.length > SHOW_DEFAULT && (
        <button type="button" className="hm-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `SHOW TOP ${SHOW_DEFAULT} ONLY` : `SHOW ALL ${ranked.length} DRIVERS`}
        </button>
      )}
    </GlassPanel>
  );
};

const Panel = ({ title, caption, children, tint }) => (
  <GlassPanel className="hm-panel" tilt={false} tint={tint}>
    <div className="hm-panel-h"><h2>{title}</h2><p>{caption}</p></div>
    <div className="hm-panel-b">{children}</div>
  </GlassPanel>
);

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
    <Panel title="How reliable is this?" caption="Before qualifying, the model does not beat simply picking the points leader.">
      <div className="hm-rel">
        <div><label className="teal">MODEL'S WINNER PICK</label><b className="teal">{Math.round((100 * m.hits) / n)}%</b><small>{m.hits} of {n} past races</small>{bar(m.hits, m.ci)}</div>
        <div><label>POINTS LEADER PICK</label><b>{Math.round((100 * s.hits) / n)}%</b><small>{s.hits} of {n} past races</small>{bar(s.hits, s.ci)}</div>
      </div>
      <p className="hm-note dim">Backtest on {n} races the model had not seen (2025–2026), using its pre-qualifying prediction. Thin line = 95% range; the two ranges overlap widely, so neither is clearly better.</p>
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
const HomePage = () => {
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
    <div className="hm">
      <RaceStrip round={race.round} onSelect={setRound} />
      <TitleRow race={race} phase={phase} />

      {ranked.length > 0 && (
        <section aria-labelledby="hm-top3">
          <div className="hm-sec">
            <h2 id="hm-top3">Model's top 3</h2>
            <span>3-MODEL XGBOOST{through ? ` · DATA THRU R${through}` : ""}</span>
          </div>
          <div className="hm-top3">{ranked.slice(0, 3).map((r, i) => <Top3Card key={r.driverRef} r={r} i={i} />)}</div>
        </section>
      )}
      <div className="hm-grid">
        <div className="hm-main">
          {ranked.length > 0 && <Forecast ranked={ranked} />}
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
          <LastRacePanel race={race} last={last} rows={last ? res[last.raceId] : null} snap={snap} />
          <SchedulePanel race={race} />
        </aside>
      </div>
    </div>
  );
};

export default HomePage;
