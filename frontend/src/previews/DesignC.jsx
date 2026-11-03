// DESIGN C · BROADCAST MINIMAL
// Sparse, oversized type, one hero per screen. A single glass panel per screen at most; hairline rules do the rest.
import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { D, initialMode, SCREENS, hrefFor, useScreen, useNow, countdownParts, when, pct, sc, raceDay, useMockLive, TYRE_LEGEND } from "./data.js";
import { StateSwitch, StateBadge, MockBanner, ReliabilityChart, StintBar, ScoreNote } from "./parts.jsx";

const Header = ({ screen }) => (
  <header className="pc-head">
    <img src="/f1-logo.png" alt="F1" style={{ height: 26, width: "auto" }} />
    <nav className="pc-tabs" aria-label="Preview screens">{SCREENS.map(([k, l]) => <a key={k} href={hrefFor("c", k)} className={screen === k ? "on" : ""}>{l}</a>)}</nav>
  </header>
);
const Eyebrow = ({ children }) => <div className="pc-eyebrow">{children}</div>;
const Sw = ({ c }) => <span className="pc-swatch" style={{ background: c }} />;

function Home() {
  const R = D.nextRace, C = D.championship, S = D.scorecard, REL = D.reliability;
  const now = useNow(); const cd = countdownParts(raceDay, now);
  const wb = REL.winner_hit.b_predicted_quali;
  const genuine = S.races.filter((r) => r.kind === "genuine foresight");
  return (
    <main className="pc-main">
      <section>
        <Eyebrow>Round {R.round} · {R.location}</Eyebrow>
        <h1 className="pc-hero">{R.name.replace(" Grand Prix", "")}<br /><span style={{ color: "var(--red)" }}>Grand Prix</span></h1>
        <div className="pc-count" aria-label="Countdown to the race">{cd.d}<small>D</small>{cd.h}<small>H</small>{cd.m}<small>M</small>{cd.s}<small>S</small></div>
        <p className="pc-sub">Lights out {when(raceDay)}. Qualifying {when(R.sessions[3].utc)}.</p>
      </section>
      <hr className="pc-rule" />
      <div className="pc-cols">
        <section>
          <Eyebrow>Drivers' champion · confirmed</Eyebrow>
          <div className="pc-fig" style={{ color: "var(--green)" }}>Antonelli</div>
          <p className="pv-note" style={{ marginTop: "0.9rem", fontSize: "0.86rem" }}>{C.drivers.leader.points} points, {C.drivers.points_gap} clear with {C.drivers.max_points_available} available. Clinched at the {C.drivers.clinched_at.race}, round {C.drivers.clinched_at.round}. Constructors still open.</p>
        </section>
        <section>
          <Eyebrow>Model scores · top 5</Eyebrow>
          <ul className="pc-list">{R.entries.slice(0, 5).map((e) => <li key={e.code}><b>{e.rank}</b><span><Sw c={e.color} />{e.code}</span><span className="pv-teal">{sc(e.podium_score, 2)}</span></li>)}</ul>
          <p className="pv-note" style={{ marginTop: "0.7rem" }}>Podium score, rescaled per race to sum to 3. Model scores, not probabilities.</p>
        </section>
        <section>
          <Eyebrow>Scorecard · honest</Eyebrow>
          <div className="pc-fig">{S.genuine_summary.n} <span style={{ fontSize: "0.4em", color: "var(--muted)" }}>of {S.n_snapshots}</span></div>
          <p className="pv-note" style={{ marginTop: "0.9rem", fontSize: "0.86rem" }}>snapshots were frozen before qualifying (races {genuine.map((g) => g.round).join(", ")}); the winner was named {S.genuine_summary.winner_hits} time{S.genuine_summary.winner_hits === 1 ? "" : "s"} in 3. The rest were backfilled after their races or taken after the cutoff.</p>
        </section>
      </div>
      <hr className="pc-rule" />
      <GlassPanel tilt={false} sweep={false}><section style={{ padding: "1.8rem 2rem 2rem" }}>
        <Eyebrow>How reliable is this?</Eyebrow>
        <div className="pc-cols">
          <div><div className="pc-fig pv-teal">{pct(wb.model.rate, 0)}</div><p className="pv-note" style={{ marginTop: "0.6rem" }}>winners picked right before qualifying ({wb.model.hits} of {wb.model.races} races)</p></div>
          <div><div className="pc-fig">{pct(wb.prior_standings.rate, 0)}</div><p className="pv-note" style={{ marginTop: "0.6rem" }}>with no model: just pick the standings leader</p></div>
          <div><div className="pc-fig">{REL.sums.b_predicted_quali.win.mean.toFixed(2)}</div><p className="pv-note" style={{ marginTop: "0.6rem" }}>win scores per race. Real probabilities would add to 1. <a className="pv-link" href={hrefFor("c", "model")}>The evidence</a></p></div>
        </div>
      </section></GlassPanel>
    </main>
  );
}

function RacePage() {
  const R = D.race, w = R.classification[0];
  return (
    <main className="pc-main">
      <section>
        <Eyebrow>Round {R.round} · {R.date}</Eyebrow>
        <h1 className="pc-hero">{w.surname}</h1>
        <p className="pc-sub"><span className="pv-green">Winner</span> of the {R.name}, {w.team}. Second {R.classification[1].surname}, third {R.classification[2].surname}.</p>
      </section>
      <hr className="pc-rule" />
      <section>
        <Eyebrow>Tyre strategy · top 6</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{R.classification.slice(0, 6).map((c) => <div key={c.code} style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 14, alignItems: "center", fontFamily: "var(--mono)" }}><span style={{ fontSize: "1.05rem", fontWeight: 700 }}><Sw c={c.color} />{c.code}</span><StintBar stints={c.stints} laps={R.total_laps} height={22} /></div>)}</div>
        <div className="pv-tyre-key" style={{ marginTop: "0.9rem" }}>{TYRE_LEGEND.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} {n}</span>)}</div>
        <p className="pv-note" style={{ marginTop: "0.9rem" }}>{R.note}</p>
      </section>
      <hr className="pc-rule" />
      <section>
        <Eyebrow>Model podium score vs result</Eyebrow>
        <ul className="pc-list">{R.classification.slice(0, 5).map((c) => <li key={c.code}><b className="pv-green">P{c.pos}</b><span><Sw c={c.color} />{c.surname}</span><span className="pv-teal">{sc(c.model_predicted_grid.podium_score, 2)}</span></li>)}</ul>
        <ScoreNote>Model scores from the Part 1B backtest on the predicted grid, rescaled per race. Green = result; teal = model.</ScoreNote>
      </section>
    </main>
  );
}

function Champ() {
  const C = D.championship, d = C.drivers;
  return (
    <main className="pc-main">
      <section>
        <Eyebrow>World champion · confirmed at the {d.clinched_at.race}</Eyebrow>
        <h1 className="pc-hero" style={{ color: "var(--green)" }}>Antonelli</h1>
        <div className="pc-count">{d.leader.points}<small>POINTS</small>+{d.points_gap}<small>CLEAR</small></div>
        <p className="pc-sub">{d.max_points_available} points remain; {d.runner_up.name} cannot catch up. Margin {d.surplus}.</p>
      </section>
      <hr className="pc-rule" />
      <div className="pc-cols" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <section>
          <Eyebrow>Top five</Eyebrow>
          <ul className="pc-list pc-big-list">{d.contenders.slice(0, 5).map((c, i) => <li key={c.code}><b>{i + 1}</b><span><Sw c={c.color} />{c.name}</span><span>{c.points}</span></li>)}</ul>
        </section>
        <section>
          <Eyebrow>Constructors · still open</Eyebrow>
          <ul className="pc-list">{C.constructors.contenders.slice(0, 3).map((c, i) => <li key={c.team}><b>{i + 1}</b><span><Sw c={c.color} />{c.team}</span><span>{c.points}</span></li>)}</ul>
          <p className="pv-note" style={{ marginTop: "0.6rem" }}>Mercedes +{C.constructors.points_gap}; {C.constructors.max_points_available} available.</p>
        </section>
      </div>
    </main>
  );
}

function Live() {
  const [mode, setMode] = useState(initialMode);
  const { frame, move, badge, ageS } = useMockLive(mode);
  const leader = frame.order[0];
  return (
    <main className="pc-main">
      <MockBanner />
      <section>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.2rem" }}><StateBadge badge={badge} ageS={ageS} big /><Eyebrow>{D.live.session} · lap {frame.lap} of {D.live.total_laps}</Eyebrow></div>
        <h1 className="pc-hero"><Sw c={D.live.drivers[leader].color} />{leader}</h1>
        <p className="pc-sub">leads. {D.live.drivers[leader].name}, {D.live.drivers[leader].team}.</p>
      </section>
      <hr className="pc-rule" />
      <div className="pc-cols" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
        <section><Eyebrow>Positions</Eyebrow><ul className="pc-list">{frame.order.slice(0, 10).map((c, i) => <li key={c}><b>{i + 1}</b><span><Sw c={D.live.drivers[c].color} />{c}</span><span style={{ color: move[c] > 0 ? "var(--green)" : "var(--red)" }}>{move[c] > 0 ? `▲${move[c]}` : move[c] < 0 ? `▼${-move[c]}` : ""}</span></li>)}</ul></section>
        <section><Eyebrow>Race control</Eyebrow><div className="pa-term">{[...frame.race_control].reverse().slice(0, 4).map((m, i) => <div key={i}><span className="t">L{m.lap}</span><span>{m.msg}</span></div>)}</div></section>
        <section><Eyebrow>Weather</Eyebrow><div className="pc-fig">{frame.track_c}°</div><p className="pv-note" style={{ marginTop: "0.5rem" }}>track · air {frame.air_c}° · humidity {frame.humidity}% · wind {frame.wind_ms} m/s · {frame.rain ? "rain" : "dry"}</p></section>
      </div>
      <hr className="pc-rule" />
      <section><Eyebrow>Simulate the feed</Eyebrow><StateSwitch mode={mode} setMode={setMode} />
        <p className="pv-note" style={{ marginTop: "0.8rem" }}>Positions, race control and weather only; no gap timing, no track dots. Stale or delayed data is never labelled LIVE.</p></section>
    </main>
  );
}

function Model() {
  const REL = D.reliability, S = D.scorecard, wb = REL.winner_hit.b_predicted_quali, wa = REL.winner_hit.a_real_grid;
  return (
    <main className="pc-main">
      <section>
        <Eyebrow>How reliable is this? · 43 out-of-sample races</Eyebrow>
        <h1 className="pc-hero" style={{ fontSize: "clamp(2.2rem, 6vw, 5.2rem)" }}>Good at ranking.<br /><span style={{ color: "var(--muted)" }}>Not a probability.</span></h1>
        <GlassPanel tilt={false} sweep={false} style={{ marginTop: "2.2rem", maxWidth: 700 }}><div style={{ padding: "1.2rem 1.4rem" }}><ReliabilityChart which="win" w={640} h={380} /></div></GlassPanel>
        <p className="pc-sub">Dashed line: what perfect would look like. Every dot sits below it: when the model said 90%+, the driver won {pct(REL.reliability_win.b_predicted_quali[9].observed, 0)} of the time (predicted grid) or {pct(REL.reliability_win.a_real_grid[9].observed, 0)} (real grid).</p>
      </section>
      <hr className="pc-rule" />
      <div className="pc-cols">
        <section><Eyebrow>Winner picked right</Eyebrow><div className="pc-fig pv-teal">{pct(wb.model.rate, 0)}</div><p className="pv-note" style={{ marginTop: "0.6rem" }}>before qualifying; the standings leader gets {pct(wb.prior_standings.rate, 0)}</p></section>
        <section><Eyebrow>With the real grid</Eyebrow><div className="pc-fig pv-teal">{pct(wa.model.rate, 0)}</div><p className="pv-note" style={{ marginTop: "0.6rem" }}>after qualifying; pole sitter alone gets {pct(wa.prior_grid.rate, 0)}</p></section>
        <section><Eyebrow>Genuine foresight picks</Eyebrow><div className="pc-fig">{S.genuine_summary.n} <span style={{ fontSize: "0.4em", color: "var(--muted)" }}>of {S.n_snapshots}</span></div><p className="pv-note" style={{ marginTop: "0.6rem" }}>{S.note}</p></section>
      </div>
    </main>
  );
}

export default function DesignC() {
  const screen = useScreen();
  const S = { home: Home, race: RacePage, champ: Champ, live: Live, model: Model }[screen] || Home;
  return <div className="pc"><Header screen={screen} /><S /></div>;
}
