// DESIGN B · STRATEGY WALL
// A 12-column wall of modular glass panels: tyre-strategy bars, score bars, championship maths, scorecard.
// Each panel answers one question and carries its own provenance note.
import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { D, initialMode, SCREENS, hrefFor, useScreen, useNow, countdownParts, when, pct, sc, raceDay, useMockLive, TYRE_LEGEND } from "./data.js";
import { StateSwitch, StateBadge, MockBanner, ReliabilityChart, ProgressChart, StintBar, ScoreNote } from "./parts.jsx";

const Header = ({ screen }) => (
  <header className="pb-head">
    <img src="/f1-logo.png" alt="F1" style={{ height: 28, width: "auto" }} />
    <div><div style={{ fontFamily: "var(--display)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em" }}>Race Predictor</div><div className="pv-label">Direction B · Strategy wall · preview</div></div>
    <nav className="pb-tabs" aria-label="Preview screens">{SCREENS.map(([k, l]) => <a key={k} href={hrefFor("b", k)} className={screen === k ? "on" : ""}>{l}</a>)}</nav>
  </header>
);
const P = ({ span = 6, title, right, tint, children }) => (
  <div className={`pb-s${span}`}><GlassPanel tint={tint} tilt={false} style={{ height: "100%" }}><div className="pb-p">
    <div className="pb-h"><h3>{title}</h3>{right && <span className="pv-label">{right}</span>}</div>{children}</div></GlassPanel></div>
);
const Bars = ({ rows, max = 1 }) => (
  <div className="pb-bars">{rows.map((e, i) => (
    <div key={e.code} className="pb-bar">
      <span style={{ color: "var(--muted)", textAlign: "right" }}>{i + 1}</span>
      <span style={{ fontWeight: 700 }}><span style={{ display: "inline-block", width: 3, height: 12, background: e.color, marginRight: 6, verticalAlign: -2 }} />{e.code}</span>
      <span className="track"><i className="t" style={{ width: `${Math.min(100, (e.podium / max) * 100)}%`, background: "var(--teal)", opacity: 0.8 }} /><i className="g" style={{ width: `${Math.min(100, (e.win / max) * 100)}%`, background: "var(--gold)" }} /></span>
      <span style={{ textAlign: "right" }}><span className="pv-gold">{sc(e.win, 2)}</span></span>
    </div>))}</div>
);

function Home() {
  const R = D.nextRace, C = D.championship, S = D.scorecard, REL = D.reliability, RC = D.race;
  const now = useNow(); const cd = countdownParts(raceDay, now);
  const genuine = S.races.filter((r) => r.kind === "genuine foresight");
  const wb = REL.winner_hit.b_predicted_quali;
  const s = REL.sums.b_predicted_quali;
  return (
    <div className="pb-wall">
      <P span={7} title={`Round ${R.round} · ${R.name}`} right="next race" tint="#e10600">
        <div style={{ display: "flex", gap: "1.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div className="pb-stat" aria-label="Countdown">{cd.d}d {cd.h}:{cd.m}:{cd.s}</div><div className="pv-label" style={{ marginTop: "0.4rem" }}>until lights out · {R.location}</div></div>
          <div className="pb-tiles" style={{ flex: 1, minWidth: 220 }}>{R.sessions.slice(-3).map((x) => <div key={x.name} className="pb-tile"><div className="pv-label">{x.name}</div><div className="pv-num" style={{ fontSize: "0.86rem", marginTop: 4 }}>{when(x.utc, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div></div>)}</div>
        </div>
      </P>
      <P span={5} title="Drivers' champion" right="confirmed" tint="#00c853">
        <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: "1.9rem", color: "var(--green)" }}>KIMI ANTONELLI</div>
        <div className="pv-num" style={{ margin: "0.4rem 0", fontSize: "0.86rem", lineHeight: 1.7 }}>{C.drivers.leader.points} pts · +{C.drivers.points_gap} over {C.drivers.runner_up.name.split(" ").pop()}<br />clinched at {C.drivers.clinched_at.race}, round {C.drivers.clinched_at.round}</div>
        <p className="pv-note">Constructors still open: Mercedes +{C.constructors.points_gap}, {C.constructors.max_points_available} available.</p>
      </P>
      <P span={7} title="Ranked model scores" right={`${R.name.replace(" Grand Prix", "")} · rescaled per race`}>
        <Bars rows={R.entries.slice(0, 10).map((e) => ({ code: e.code, color: e.color, podium: e.podium_score, win: e.win_score }))} />
        <div style={{ display: "flex", gap: "1rem", margin: "0.7rem 0 0.3rem" }}><span className="pv-label pv-teal">■ podium score</span><span className="pv-label pv-gold">■ win score (number)</span></div>
        <ScoreNote>{`Model scores, not probabilities: rescaled per race to sum to 1 (win) and 3 (podium); raw scores summed to ${R.raw_sums.win} and ${R.raw_sums.podium}.`}</ScoreNote>
      </P>
      <P span={5} title="How reliable is this?" right="43 races, backtest">
        <div className="pb-tiles">
          <div className="pb-tile"><div className="v pv-teal">{pct(wb.model.rate, 0)}</div><div className="pv-label">model, before qualifying</div></div>
          <div className="pb-tile"><div className="v">{pct(wb.prior_standings.rate, 0)}</div><div className="pv-label">standings leader</div></div>
          <div className="pb-tile"><div className="v">{s.win.mean.toFixed(2)}</div><div className="pv-label">win scores per race (should be 1)</div></div>
          <div className="pb-tile"><div className="v">{pct(REL.reliability_win.b_predicted_quali[9].observed, 0)}</div><div className="pv-label">won when scored ~{pct(REL.reliability_win.b_predicted_quali[9].mean_pred, 0)}</div></div>
        </div>
        <p className="pv-note" style={{ marginTop: "0.7rem" }}>Before qualifying the model does not beat the standings leader. <a className="pv-link" href={hrefFor("b", "model")}>See the evidence</a></p>
      </P>
      <P span={7} title="Scorecard" right="honest">
        <table className="pv-table"><thead><tr><th>Race</th><th>Model top 3 (frozen before qualifying)</th><th className="r">Winner</th><th className="r">Podium</th></tr></thead><tbody>
          {genuine.map((g) => <tr key={g.raceId}><td>R{g.round} {g.name.replace(" Grand Prix", "")}</td><td>{g.model_top3.map((x) => x.slice(0, 3).toUpperCase()).join(" · ")}</td><td className="r"><span className={`pv-chip ${g.winner_hit ? "pv-ok" : "pv-no"}`}>{g.winner_hit ? "HIT" : "MISS"}</span></td><td className="r pv-green">{g.podium_hits}/3</td></tr>)}
        </tbody></table>
        <p className="pv-note" style={{ marginTop: "0.7rem" }}>{S.note}</p>
      </P>
      <P span={5} title="Last race with strategy data" right={`R${RC.round} · ${RC.name.replace(" Grand Prix", "")}`}>
        {RC.classification.slice(0, 6).map((c) => <div key={c.code} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 8, alignItems: "center", height: 24, fontFamily: "var(--mono)", fontSize: "0.8rem" }}><b>{c.code}</b><StintBar stints={c.stints} laps={RC.total_laps} height={14} /></div>)}
        <p className="pv-note" style={{ marginTop: "0.6rem" }}>Strategy data exists only through round 10: a known gap.</p>
      </P>
    </div>
  );
}

function RacePage() {
  const R = D.race;
  return (
    <div className="pb-wall">
      <P span={12} title={`${R.name} · round ${R.round}`} right={R.date} tint="#e10600"><div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <div><div className="pb-stat pv-green">{R.classification[0].code}</div><div className="pv-label">winner · {R.classification[0].team}</div></div>
        <div><div className="pb-stat">{R.total_laps}</div><div className="pv-label">laps</div></div>
        <div><div className="pb-stat">{R.safety_cars.length}</div><div className="pv-label">{R.safety_cars.map((s) => `${s.type} laps ${s.lap_start}-${s.lap_end}`).join(", ")}</div></div></div></P>
      <P span={8} title="Tyre strategy" right="stints by lap">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{R.classification.map((c) => <div key={c.code} style={{ display: "grid", gridTemplateColumns: "26px 48px 1fr 20px", gap: 8, alignItems: "center", fontFamily: "var(--mono)", fontSize: "0.8rem" }}><span style={{ color: "var(--muted)", textAlign: "right" }}>{c.pos}</span><b><span style={{ display: "inline-block", width: 3, height: 12, background: c.color, marginRight: 6, verticalAlign: -2 }} />{c.code}</b><StintBar stints={c.stints} laps={R.total_laps} height={16} /><span style={{ color: "var(--muted)" }}>{c.pit_laps.length}</span></div>)}</div>
        <div className="pv-tyre-key" style={{ marginTop: "0.7rem" }}>{TYRE_LEGEND.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} {n}</span>)}<span>right: pit stops</span></div>
      </P>
      <P span={4} title="Grid to finish" right="places gained"><div className="pb-bars">{R.classification.slice(0, 12).map((c) => { const g = c.grid ? c.grid - c.pos : 0; return <div key={c.code} className="pb-bar" style={{ gridTemplateColumns: "26px 44px 1fr 40px" }}><span style={{ color: "var(--muted)", textAlign: "right" }}>{c.pos}</span><b>{c.code}</b><span className="track"><i style={{ width: `${Math.min(100, Math.abs(g) * 9)}%`, background: g >= 0 ? "var(--green)" : "var(--red)", left: g >= 0 ? "0" : "auto", right: g < 0 ? "0" : "auto" }} /></span><span style={{ textAlign: "right", color: g > 0 ? "var(--green)" : g < 0 ? "var(--red)" : "var(--muted)" }}>{g > 0 ? `+${g}` : g}</span></div>; })}</div></P>
      <P span={12} title="Did the model see it coming?" right="Part 1B backtest, rescaled per race">
        <div className="pv-wrap"><table className="pv-table"><thead><tr><th>Finish</th><th>Driver</th><th className="r">Grid</th><th className="r pv-teal">Podium score (real grid)</th><th className="r pv-teal">Podium score (predicted grid)</th></tr></thead><tbody>{R.classification.slice(0, 8).map((c) => <tr key={c.code}><td className="pv-green">P{c.pos}</td><td>{c.name}</td><td className="r">{c.grid ?? "pit"}</td><td className="r pv-teal">{sc(c.model_real_grid.podium_score, 2)}</td><td className="r pv-teal">{sc(c.model_predicted_grid.podium_score, 2)}</td></tr>)}</tbody></table></div>
        <ScoreNote>{R.note}</ScoreNote>
      </P>
    </div>
  );
}

function Champ() {
  const C = D.championship, d = C.drivers;
  return (
    <div className="pb-wall">
      <P span={5} title="Championship maths" right={`after ${C.as_of.race}`} tint="#00c853">
        <div className="pb-math">
          <div className="eq"><span>{d.leader.name.split(" ").pop()}</span><b>{d.leader.points}</b></div>
          <div className="eq"><span>{d.runner_up.name.split(" ").pop()}</span><b>{d.runner_up.points}</b></div>
          <div className="eq"><span>lead</span><b>{d.points_gap}</b></div>
          <div className="eq"><span>points available ({d.remaining_races} races × 25)</span><b>{d.max_points_available}</b></div>
          <div className="eq"><span>lead − available</span><b className="pv-green">+{d.surplus} → CLINCHED</b></div>
        </div>
        <p className="pv-note" style={{ marginTop: "0.7rem" }}>Clinched at round {d.clinched_at.round} ({d.clinched_at.race}). No fastest-lap point; no sprints remain.</p>
      </P>
      <P span={7} title="Points progression" right="top 6"><ProgressChart /></P>
      <P span={7} title="Drivers' standings" right="can still win?">
        <div className="pb-bars">{d.contenders.map((c, i) => <div key={c.code} className="pb-bar" style={{ gridTemplateColumns: "22px 44px 1fr 70px" }}><span style={{ color: "var(--muted)", textAlign: "right" }}>{i + 1}</span><b><span style={{ display: "inline-block", width: 3, height: 12, background: c.color, marginRight: 6, verticalAlign: -2 }} />{c.code}</b><span className="track"><i style={{ width: `${(c.points / d.leader.points) * 100}%`, background: i === 0 ? "var(--green)" : c.color, opacity: i === 0 ? 1 : 0.75 }} /></span><span style={{ textAlign: "right" }}>{c.points}</span></div>)}</div>
      </P>
      <P span={5} title="Constructors" right="not yet decided">
        <div className="pb-bars">{C.constructors.contenders.slice(0, 7).map((c, i) => <div key={c.team} className="pb-bar" style={{ gridTemplateColumns: "22px 1fr 1fr 48px" }}><span style={{ color: "var(--muted)", textAlign: "right" }}>{i + 1}</span><b style={{ whiteSpace: "nowrap" }}>{c.team}</b><span className="track"><i style={{ width: `${(c.points / C.constructors.leader.points) * 100}%`, background: c.color }} /></span><span style={{ textAlign: "right" }}>{c.points}</span></div>)}</div>
        <p className="pv-note" style={{ marginTop: "0.6rem" }}>Mercedes leads by {C.constructors.points_gap}; {C.constructors.max_points_available} available.</p>
      </P>
    </div>
  );
}

function Live() {
  const [mode, setMode] = useState(initialMode);
  const { frame, move, badge, ageS, idx, total } = useMockLive(mode);
  return (
    <div className="pb-wall">
      <div className="pb-s12"><MockBanner /></div>
      <P span={8} title={`${D.live.session} · lap ${frame.lap}/${D.live.total_laps}`} tint={badge.key === "LIVE" ? "#e10600" : undefined} right={`frame ${idx + 1}/${total}`}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem", marginBottom: "0.9rem" }}><StateBadge badge={badge} ageS={ageS} big /><StateSwitch mode={mode} setMode={setMode} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0 1.4rem" }}>{frame.order.map((c, i) => <div key={c} style={{ display: "grid", gridTemplateColumns: "26px 4px 1fr 34px", gap: 8, alignItems: "center", height: 30, borderBottom: "1px solid var(--border)", fontFamily: "var(--mono)", fontSize: "0.86rem" }}><span style={{ textAlign: "right", color: i === 0 ? "var(--red)" : "var(--muted)", fontWeight: 700 }}>{i + 1}</span><i style={{ height: 16, background: D.live.drivers[c].color, borderRadius: 2 }} /><b>{c}</b><span style={{ color: move[c] > 0 ? "var(--green)" : "var(--red)", textAlign: "right" }}>{move[c] > 0 ? `▲${move[c]}` : move[c] < 0 ? `▼${-move[c]}` : ""}</span></div>)}</div>
      </P>
      <P span={4} title="Race control" right="latest first"><div className="pa-term">{[...frame.race_control].reverse().slice(0, 7).map((m, i) => <div key={i}><span className="t">L{m.lap}</span><span>{m.msg}</span></div>)}</div></P>
      <P span={4} title="Weather"><div className="pb-tiles"><div className="pb-tile"><div className="v">{frame.track_c}°</div><div className="pv-label">track</div></div><div className="pb-tile"><div className="v">{frame.air_c}°</div><div className="pv-label">air</div></div><div className="pb-tile"><div className="v">{frame.humidity}%</div><div className="pv-label">humidity</div></div><div className="pb-tile"><div className="v">{frame.wind_ms}</div><div className="pv-label">wind m/s</div></div></div></P>
      <P span={8} title="What this view shows, and does not"><p className="pv-note">Positions, race control and weather only. No gap timing and no track-position dots: those live feeds are reported unavailable. The badge follows the rule LIVE ≤ 10 s, DELAYED 10-90 s or a deliberately delayed feed, NO LIVE DATA above 90 s, FINAL once validated results exist. Stale data is never shown as LIVE.</p></P>
    </div>
  );
}

function Model() {
  const REL = D.reliability, S = D.scorecard;
  const bw = REL.brier;
  const rows = [["Model, raw scores", "raw"], ["Model, rescaled per race", "norm"], ["Always 1/22", "base_rate"], ["Standings rank", "prior_standings"], ["Grid rank", "prior_grid"]];
  const max = Math.max(...rows.flatMap(([, k]) => [bw.a_real_grid[k].win, bw.b_predicted_quali[k].win]));
  return (
    <div className="pb-wall">
      <P span={6} title="Calibration: win score" right="predicted vs actual"><ReliabilityChart which="win" w={520} h={330} /></P>
      <P span={6} title="Calibration: podium score" right="predicted vs actual"><ReliabilityChart which="podium" w={520} h={330} compact /></P>
      <P span={12} title="Baseline comparison" right="Brier score for winning, lower is better">
        <div className="pb-bars">{rows.map(([n, k]) => (<div key={k} style={{ display: "grid", gridTemplateColumns: "190px 1fr 1fr", gap: 10, alignItems: "center", fontFamily: "var(--mono)", fontSize: "0.8rem" }}><span>{n}</span>
          {["a_real_grid", "b_predicted_quali"].map((c) => <span key={c} style={{ display: "grid", gridTemplateColumns: "1fr 60px", gap: 8, alignItems: "center" }}><span className="track" style={{ height: 12, background: "rgba(255,255,255,0.06)", borderRadius: 3, position: "relative" }}><i style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(bw[c][k].win / max) * 100}%`, background: c === "a_real_grid" ? "var(--green)" : "var(--teal)", borderRadius: 3, opacity: 0.85 }} /></span><span>{bw[c][k].win.toFixed(4)}</span></span>)}</div>))}
          <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 1fr", gap: 10 }}><span /><span className="pv-label pv-green">■ real grid</span><span className="pv-label pv-teal">■ predicted grid (used before qualifying)</span></div></div>
        <p className="pv-note" style={{ marginTop: "0.8rem" }}>Raw scores are worse than always guessing 1/22. Rescaling per race fixes the level but does not beat a one-line rank baseline. Source: 43 out-of-sample races (docs/stage1/02).</p>
      </P>
      <P span={12} title="Scorecard" right={`${S.n_snapshots} saved snapshots`}><div className="pv-wrap"><table className="pv-table"><thead><tr><th>Race</th><th>Kind</th><th>Model top 3</th><th>Actual top 3</th><th className="r">Winner</th><th className="r">Podium</th></tr></thead><tbody>
        {S.races.map((r) => <tr key={r.raceId} style={{ opacity: r.kind === "genuine foresight" ? 1 : 0.8 }}><td>R{r.round}</td><td>{r.kind}</td><td>{r.model_top3 ? r.model_top3.map((x) => x.slice(0, 3).toUpperCase()).join(" ") : "-"}</td><td className="pv-green">{r.actual_top3.map((x) => x.slice(0, 3).toUpperCase()).join(" ")}</td><td className="r">{r.snapshot === "yes" ? <span className={`pv-chip ${r.winner_hit ? "pv-ok" : "pv-no"}`}>{r.winner_hit ? "HIT" : "MISS"}</span> : "-"}</td><td className="r">{r.snapshot === "yes" ? `${r.podium_hits}/3` : "-"}</td></tr>)}
      </tbody></table></div><p className="pv-note" style={{ marginTop: "0.6rem" }}>{S.note}</p></P>
    </div>
  );
}

export default function DesignB() {
  const screen = useScreen();
  const S = { home: Home, race: RacePage, champ: Champ, live: Live, model: Model }[screen] || Home;
  return <div className="pb"><Header screen={screen} /><S /></div>;
}
