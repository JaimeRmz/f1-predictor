// DESIGN A · TIMING TOWER
// A dense left rail (the "tower": ordered rows with team-colour bars) beside big numerals and telemetry-style strips.
// Original graphics only; no FOM timing-screen replica (the tower is a plain ranked list in this site's own mono type).
import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { D, initialMode, SCREENS, hrefFor, useScreen, useNow, countdownParts, when, pct, sc, raceDay, useMockLive, TYRE_LEGEND } from "./data.js";
import { StateSwitch, StateBadge, MockBanner, ReliabilityChart, ProgressChart, StintBar, ScoreNote } from "./parts.jsx";

const Header = ({ screen }) => (
  <header className="pa-head">
    <img src="/f1-logo.png" alt="F1" style={{ height: 28, width: "auto" }} />
    <div><div className="pa-title">Race Predictor</div><div className="pv-label" style={{ fontSize: "0.72rem" }}>Direction A · Timing tower · preview</div></div>
    <nav className="pa-tabs" aria-label="Preview screens">{SCREENS.map(([k, l]) => <a key={k} href={hrefFor("a", k)} className={screen === k ? "on" : ""}>{l}</a>)}</nav>
  </header>
);

const Tower = ({ title, unit, rows }) => (
  <GlassPanel className="pa-tower" tilt={false} sweep={false}>
    <div className="pa-tower-h"><span className="pv-label" style={{ color: "var(--text)" }}>{title}</span><span className="pv-label">{unit}</span></div>
    {rows.map((r, i) => (
      <div key={r.key || i} className={`pa-row${i === 0 ? " p1" : ""}`}>
        <span className="pos">{r.pos ?? i + 1}</span>
        <span className="bar" style={{ background: r.color }} />
        <span><span className="code">{r.code}</span>{r.sub && <span className="sub">{r.sub}</span>}</span>
        <span className="val" style={{ color: r.valColor || "var(--text)" }}>{r.val}</span>
      </div>
    ))}
  </GlassPanel>
);

const Panel = ({ children, tint, style }) => <GlassPanel tint={tint} tilt={false} style={style}><div className="pa-pad">{children}</div></GlassPanel>;
const H = ({ children, right }) => <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.7rem" }}><span className="pv-label" style={{ color: "var(--text)" }}>{children}</span>{right && <span className="pv-label">{right}</span>}</div>;
const Big = ({ v, unit, color }) => <div><div className="pa-big" style={{ color }}>{v}</div><div className="pa-bignum-unit">{unit}</div></div>;

// ── screens ─────────────────────────────────────────────────────────────
function Home() {
  const R = D.nextRace, C = D.championship, S = D.scorecard, REL = D.reliability;
  const now = useNow(); const cd = countdownParts(raceDay, now);
  const top = R.entries.slice(0, 10);
  const genuine = S.races.filter((r) => r.kind === "genuine foresight");
  const wb = REL.winner_hit.b_predicted_quali;
  const topBin = REL.reliability_win.b_predicted_quali[9];
  return (
    <div className="pa-body">
      <Tower title="Forecast order" unit="podium score" rows={R.entries.map((e) => ({ key: e.code, code: e.code, color: e.color, val: sc(e.podium_score, 2), valColor: "var(--teal)", sub: e.win_score >= 0.05 ? `win ${sc(e.win_score, 2)}` : "" }))} />
      <main className="pa-main">
        <Panel tint="#e10600">
          <div className="pa-grid2" style={{ alignItems: "end" }}>
            <div>
              <div className="pv-label">Round {R.round} · next race</div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: "clamp(1.8rem,3.4vw,2.8rem)", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0.3rem 0 0.9rem" }}>{R.name}</div>
              <div className="pa-big" aria-label="Countdown to the race">{cd.d}<span className="pv-label" style={{ margin: "0 0.7rem 0 0.2rem" }}>D</span>{cd.h}<span className="pv-label" style={{ margin: "0 0.7rem 0 0.2rem" }}>H</span>{cd.m}<span className="pv-label" style={{ margin: "0 0.7rem 0 0.2rem" }}>M</span>{cd.s}<span className="pv-label" style={{ margin: "0 0 0 0.2rem" }}>S</span></div>
            </div>
            <div className="pa-term" aria-label="Session schedule">{R.sessions.map((s) => <div key={s.name}><span className="t">{s.name.replace("Practice ", "FP")}</span><span>{when(s.utc)}</span></div>)}</div>
          </div>
        </Panel>
        <div className="pa-grid2">
          <Panel tint="#00c853">
            <H right="confirmed">Drivers' champion</H>
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: "clamp(1.5rem, 6.4vw, 2.1rem)", color: "var(--green)", overflowWrap: "anywhere" }}>KIMI ANTONELLI</div>
            <div className="pv-num" style={{ marginTop: "0.5rem", fontSize: "0.86rem", lineHeight: 1.7 }}>
              <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{C.drivers.leader.points}</span> pts, {C.drivers.points_gap} clear of {C.drivers.runner_up.name} with {C.drivers.max_points_available} available.<br />
              Clinched at the {C.drivers.clinched_at.race} (round {C.drivers.clinched_at.round}), margin {C.drivers.clinched_at.margin}.
            </div>
            <p className="pv-note" style={{ marginTop: "0.7rem" }}>Constructors' title not yet decided: Mercedes leads by {C.constructors.points_gap} with {C.constructors.max_points_available} available.</p>
          </Panel>
          <Panel>
            <H right="how reliable is this?">Pre-race model</H>
            <div className="pa-grid2" style={{ gap: "0.8rem" }}>
              <Big v={pct(wb.model.rate, 0)} unit={`winner picked right · ${wb.model.hits}/${wb.model.races} races`} color="var(--teal)" />
              <Big v={pct(wb.prior_standings.rate, 0)} unit="standings leader, no model" />
            </div>
            <p className="pv-note" style={{ marginTop: "0.8rem" }}>On the path used before qualifying the model does <b>not</b> beat "pick the standings leader" (95% intervals overlap widely). Win scores add up to {D.reliability.sums.b_predicted_quali.win.mean.toFixed(2)} per race, not 1. Where it scored {pct(topBin.mean_pred, 0)}, the driver actually won {pct(topBin.observed, 0)} of the time. <a className="pv-link" href={hrefFor("a", "model")}>Full evidence</a></p>
          </Panel>
        </div>
        <Panel>
          <H right={`${R.model_version} · data through round ${R.as_of_round}`}>Ranked model scores · top 10 for {R.name.replace(" Grand Prix", "")}</H>
          {top.map((e) => (
            <div key={e.code} className="pa-strip">
              <span style={{ fontWeight: 700 }}><span style={{ display: "inline-block", width: 4, height: 14, background: e.color, marginRight: 8, verticalAlign: -2 }} />{e.code}</span>
              <span className="pa-ticks"><i style={{ width: `${Math.min(100, e.podium_score * 100)}%`, background: "var(--teal)", opacity: 0.85 }} /><i style={{ width: `${Math.min(100, e.win_score * 100)}%`, background: "var(--gold)", top: 3, bottom: 3, opacity: 1 }} /></span>
              <span style={{ textAlign: "right" }}><span className="pv-teal">{sc(e.podium_score, 2)}</span></span>
            </div>
          ))}
          <ScoreNote>{`Model scores, rescaled per race (win scores sum to 1, podium scores to 3). Teal strip = podium score, gold strip = win score. Raw scores summed to ${R.raw_sums.win} and ${R.raw_sums.podium}. They rank drivers; they are not calibrated probabilities.`}</ScoreNote>
        </Panel>
        <Panel>
          <H right="honest scorecard">What the model said before qualifying</H>
          <div className="pa-grid2" style={{ alignItems: "start" }}>
            <div>
              <Big v={`${S.genuine_summary.n}`} unit={`genuine foresight picks of ${S.n_snapshots} saved snapshots`} color="var(--text)" />
              <p className="pv-note" style={{ marginTop: "0.8rem" }}>{S.note} Of the three genuine picks the model named the winner once ({S.genuine_summary.winner_hits}/3). Never read the other eleven as a track record.</p>
            </div>
            <table className="pv-table"><thead><tr><th>Race</th><th>Model top 3</th><th className="r">Winner</th><th className="r">Podium</th></tr></thead><tbody>
              {genuine.map((g) => <tr key={g.raceId}><td>R{g.round}</td><td>{g.model_top3.map((x) => x.slice(0, 3).toUpperCase()).join(" ")}</td><td className="r"><span className={`pv-chip ${g.winner_hit ? "pv-ok" : "pv-no"}`}>{g.winner_hit ? "HIT" : "MISS"}</span></td><td className="r pv-green">{g.podium_hits}/3</td></tr>)}
            </tbody></table>
          </div>
        </Panel>
      </main>
    </div>
  );
}

function RacePage() {
  const R = D.race;
  const top = R.classification.slice(0, 14);
  return (
    <div className="pa-body">
      <Tower title={`${R.name.replace(" Grand Prix", " GP")} · result`} unit="grid → finish" rows={R.classification.map((c) => ({ key: c.code, pos: c.pos, code: c.code, color: c.color, val: c.grid ? `${c.grid > c.pos ? "▲" : c.grid < c.pos ? "▼" : "="}${Math.abs(c.grid - c.pos) || ""}` : "pit", valColor: c.grid > c.pos ? "var(--green)" : c.grid < c.pos ? "var(--red)" : "var(--muted)", sub: `${c.points}p` }))} />
      <main className="pa-main">
        <Panel tint="#e10600">
          <H right={`round ${R.round} · ${R.date}`}>Race page</H>
          <div className="pa-grid3">
            <Big v={R.classification[0].code} unit={`winner · ${R.classification[0].team}`} color="var(--green)" />
            <Big v={R.total_laps} unit="laps" />
            <Big v={R.safety_cars.length} unit={R.safety_cars.map((s) => `${s.type} L${s.lap_start}-${s.lap_end}`).join(", ") || "no safety cars"} />
          </div>
          <p className="pv-note" style={{ marginTop: "0.9rem" }}>{R.note}</p>
        </Panel>
        <Panel>
          <H right="stint strips · laps">Tyre strategy</H>
          {top.map((c) => (
            <div key={c.code} className="pa-strip" style={{ gridTemplateColumns: "62px 1fr 28px" }}>
              <span style={{ fontWeight: 700 }}><span style={{ display: "inline-block", width: 4, height: 14, background: c.color, marginRight: 8, verticalAlign: -2 }} />{c.code}</span>
              <StintBar stints={c.stints} laps={R.total_laps} height={16} />
              <span style={{ textAlign: "right", color: "var(--muted)" }}>{c.pit_laps.length}</span>
            </div>
          ))}
          <div className="pv-tyre-key" style={{ marginTop: "0.6rem" }}>{TYRE_LEGEND.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} {n}</span>)}<span>right column: pit stops</span></div>
        </Panel>
        <Panel>
          <H right="actual vs model">Did the model see it coming?</H>
          <div className="pv-wrap"><table className="pv-table"><thead><tr><th>Finish</th><th>Driver</th><th className="r">Grid</th><th className="r pv-teal">Model podium score, real grid</th><th className="r pv-teal">Model podium score, predicted grid</th></tr></thead><tbody>
            {R.classification.slice(0, 8).map((c) => <tr key={c.code}><td className="pv-green">P{c.pos}</td><td>{c.code} {c.surname}</td><td className="r">{c.grid ?? "pit"}</td><td className="r pv-teal">{sc(c.model_real_grid.podium_score, 2)}</td><td className="r pv-teal">{sc(c.model_predicted_grid.podium_score, 2)}</td></tr>)}
          </tbody></table></div>
          <ScoreNote>Scores are the Part 1B backtest rescaled per race, labelled as such. Green = what actually happened; teal = the model.</ScoreNote>
        </Panel>
      </main>
    </div>
  );
}

function Champ() {
  const C = D.championship, d = C.drivers;
  return (
    <div className="pa-body">
      <Tower title="Drivers' standings" unit="points" rows={d.contenders.map((c) => ({ key: c.code, code: c.code, color: c.color, val: c.points, sub: c.wins ? `${c.wins}W` : "" }))} />
      <main className="pa-main">
        <Panel tint="#00c853">
          <H right={`after ${C.as_of.race}`}>Championship maths</H>
          <div className="pa-grid3">
            <Big v={d.points_gap} unit={`${d.leader.name.split(" ").pop()}'s lead`} color="var(--green)" />
            <Big v={d.max_points_available} unit={`points still available (${d.remaining_races} races)`} />
            <Big v={`+${d.surplus}`} unit="margin: title clinched" color="var(--green)" />
          </div>
          <p className="pv-note" style={{ marginTop: "0.9rem" }}>Antonelli clinched at the {d.clinched_at.race} (round {d.clinched_at.round}): a lead of {d.clinched_at.lead} against {d.clinched_at.max_points_available} available. No fastest-lap point, no sprints left. Derived from Jolpica standings; no model involved.</p>
        </Panel>
        <Panel><H right="top 6">Points progression</H><ProgressChart /></Panel>
        <div className="pa-grid2">
          <Panel><H right="can still win?">Who is mathematically alive</H>
            <table className="pv-table"><thead><tr><th>Driver</th><th className="r">Pts</th><th className="r">Max reachable</th><th className="r">Status</th></tr></thead><tbody>
              {d.contenders.slice(0, 7).map((c, i) => <tr key={c.code}><td>{c.code}</td><td className="r">{c.points}</td><td className="r">{c.max_reachable}</td><td className="r"><span className={`pv-chip ${i === 0 ? "pv-ok" : "pv-no"}`}>{i === 0 ? "CHAMPION" : c.mathematically_alive ? "ALIVE" : "OUT"}</span></td></tr>)}
            </tbody></table></Panel>
          <Panel><H right="not yet decided">Constructors</H>
            <table className="pv-table"><thead><tr><th>Team</th><th className="r">Pts</th><th className="r">Gap</th></tr></thead><tbody>
              {C.constructors.contenders.slice(0, 6).map((c) => <tr key={c.team}><td><span style={{ display: "inline-block", width: 4, height: 13, background: c.color, marginRight: 8, verticalAlign: -2 }} />{c.team}</td><td className="r">{c.points}</td><td className="r">{c.gap_to_leader || "-"}</td></tr>)}
            </tbody></table>
            <p className="pv-note" style={{ marginTop: "0.6rem" }}>Mercedes needs a lead above {C.constructors.max_points_available}; it has {C.constructors.points_gap}.</p></Panel>
        </div>
      </main>
    </div>
  );
}

function Live() {
  const [mode, setMode] = useState(initialMode);
  const { frame, move, badge, ageS, idx, total } = useMockLive(mode);
  return (
    <div className="pa-body">
      <Tower title="Positions" unit={`lap ${frame.lap}/${D.live.total_laps}`} rows={frame.order.map((c) => ({ key: c, code: c, color: D.live.drivers[c].color, val: move[c] > 0 ? `▲${move[c]}` : move[c] < 0 ? `▼${-move[c]}` : "", valColor: move[c] > 0 ? "var(--green)" : "var(--red)" }))} />
      <main className="pa-main">
        <MockBanner />
        <Panel tint={badge.key === "LIVE" ? "#e10600" : undefined}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.8rem" }}>
            <div><div className="pv-label">{D.live.session}</div><div className="pa-big" style={{ marginTop: "0.3rem" }}>LAP {frame.lap}<span className="pv-label" style={{ marginLeft: "0.5rem" }}>/ {D.live.total_laps}</span></div></div>
            <StateBadge badge={badge} ageS={ageS} big />
          </div>
          <div style={{ marginTop: "1rem" }}><StateSwitch mode={mode} setMode={setMode} /></div>
          <p className="pv-note" style={{ marginTop: "0.8rem" }}>
            {badge.key === "LIVE" && "Data age is within 10 s: LIVE."}
            {badge.key === "DELAYED" && "A deliberately delayed feed (about 45 s behind): never labelled LIVE."}
            {badge.key === "NO_LIVE_DATA" && "The last update is older than 90 s. The tower shows the last known positions and never says LIVE."}
            {badge.key === "FINAL" && "Session over and official results ingested and validated."}
            {` Frame ${idx + 1} of ${total}. Age is computed from server timestamps, never the visitor's clock.`}
          </p>
        </Panel>
        <div className="pa-grid2">
          <Panel><H right="race control">Messages</H><div className="pa-term">{[...frame.race_control].reverse().slice(0, 7).map((m, i) => <div key={i}><span className="t">L{m.lap}</span><span>{m.msg}</span></div>)}</div></Panel>
          <Panel><H right="weather">Conditions</H>
            <div className="pa-grid2" style={{ gap: "0.9rem" }}>
              <Big v={`${frame.track_c}°`} unit="track" /><Big v={`${frame.air_c}°`} unit="air" /><Big v={`${frame.humidity}%`} unit="humidity" /><Big v={`${frame.wind_ms}`} unit="wind m/s" />
            </div>
            <p className="pv-note" style={{ marginTop: "0.7rem" }}>{frame.rain ? "Rain" : "No rain"}. No gap timing or track-position dots: those live feeds are reported unavailable.</p></Panel>
        </div>
      </main>
    </div>
  );
}

function Model() {
  const REL = D.reliability, S = D.scorecard, wa = REL.winner_hit.a_real_grid, wb = REL.winner_hit.b_predicted_quali;
  const rows = [["Model, before qualifying", wb.model, "var(--teal)"], ["Pre-race standings leader", wb.prior_standings, "var(--text)"], ["Best constructor's driver", wb.prior_constructor, "var(--text)"], ["Model, real grid (after qualifying)", wa.model, "var(--teal)"], ["Pole sitter (real grid)", wa.prior_grid, "var(--text)"]];
  return (
    <div className="pa-body">
      <Tower title="Winner picked right" unit="43 races" rows={rows.map(([n, v, c]) => ({ key: n, pos: "·", code: n.split(",")[0].split(" ").slice(0, 2).join(" ").toUpperCase().slice(0, 14), color: c === "var(--teal)" ? "#2ee6c8" : "#777", val: pct(v.rate, 0), valColor: c }))} />
      <main className="pa-main">
        <Panel>
          <H right="43 out-of-sample races">How reliable is this?</H>
          <div className="pa-grid2" style={{ alignItems: "start" }}>
            <div><div className="pv-label" style={{ marginBottom: "0.4rem" }}>Win score vs what happened</div><ReliabilityChart which="win" /></div>
            <div><div className="pv-label" style={{ marginBottom: "0.4rem" }}>Podium score vs what happened</div><ReliabilityChart which="podium" /></div>
          </div>
          <p className="pv-note" style={{ marginTop: "0.8rem" }}>The dashed line is perfect calibration. Dots below it mean the model is over-confident; bar = 95% interval; dot size = number of driver-races. Every high-score bin sits below the line: the scores rank well but are not probabilities.</p>
        </Panel>
        <div className="pa-grid2">
          <Panel><H right="Brier score, lower is better">Baseline comparison (win)</H>
            <table className="pv-table"><thead><tr><th>Method</th><th className="r">Real grid</th><th className="r">Predicted grid</th></tr></thead><tbody>
              {[["Model, raw scores", "raw"], ["Model, rescaled per race", "norm"], ["Always 1/22", "base_rate"], ["Standings rank", "prior_standings"], ["Grid rank", "prior_grid"]].map(([n, k]) => <tr key={k}><td>{n}</td><td className="r">{REL.brier.a_real_grid[k].win.toFixed(4)}</td><td className="r">{REL.brier.b_predicted_quali[k].win.toFixed(4)}</td></tr>)}
            </tbody></table>
            <p className="pv-note" style={{ marginTop: "0.6rem" }}>Raw scores are worse than a constant. Rescaling fixes most of it but does not beat a one-line baseline.</p></Panel>
          <Panel><H right={`${S.n_snapshots} saved snapshots`}>Scorecard, labelled honestly</H>
            <div className="pv-wrap"><table className="pv-table"><thead><tr><th>Race</th><th>Kind</th><th className="r">Winner</th></tr></thead><tbody>
              {S.races.map((r) => <tr key={r.raceId}><td>R{r.round}</td><td style={{ color: r.kind === "genuine foresight" ? "var(--text)" : "var(--muted)" }}>{r.kind}</td><td className="r">{r.snapshot === "yes" ? <span className={`pv-chip ${r.winner_hit ? "pv-ok" : "pv-no"}`}>{r.winner_hit ? "HIT" : "MISS"}</span> : "-"}</td></tr>)}
            </tbody></table></div></Panel>
        </div>
      </main>
    </div>
  );
}

export default function DesignA() {
  const screen = useScreen();
  const S = { home: Home, race: RacePage, champ: Champ, live: Live, model: Model }[screen] || Home;
  return <div className="pa"><Header screen={screen} /><S /></div>;
}
