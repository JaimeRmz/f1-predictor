import { useState, useEffect } from "react";
import axios from "axios";
import { Spinner, BackendPanel, SkeletonList } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import Panel from "../components/DashPanel.jsx";
import { teamIdByDriverName, driverCode, teamColor } from "../lib/homeModel.js";
import { API, UPCOMING_RACES_2026, COMPLETED_2026, NEXT_RACE } from "../constants.js";
import { useHealth } from "../health.jsx";
import { RaceStrategySection } from "../components/RaceStrategy.jsx";
import { supabase } from "../lib/supabaseClient.js";
import "./home.css";

// ── 2026 SEASON PAGE ───────────────────────────────────────────
// Round numbers follow the raceId 1184 renumbering (2026-10-08): Bahrain GP
// in Malaysia inserted at round 16, Singapore and everything after shifted
// up by one round. Rounds 9-15 predate that insertion and are unaffected.
const CALENDAR_FLAGS = { 9:"🇬🇧",10:"🇧🇪",11:"🇭🇺",12:"🇳🇱",13:"🇮🇹",14:"🇪🇸",15:"🇦🇿",16:"🇧🇭",17:"🇸🇬",18:"🇺🇸",19:"🇲🇽",20:"🇧🇷",21:"🇺🇸",22:"🇶🇦",23:"🇦🇪" };

const Season2026Page = () => {
  const [accuracy, setAccuracy] = useState(null);
  const [loadingAcc, setLoadingAcc] = useState(true);
  const [accFailed, setAccFailed] = useState(false);
  const { wakeEpoch } = useHealth();

  // Race-strategy expand state, local to this page (independent of My Picks).
  // The latest completed race (last COMPLETED_2026 entry) starts expanded so the
  // feature is visible on first visit; it advances automatically each round.
  const [openRaces, setOpenRaces] = useState(
    () => new Set([COMPLETED_2026[COMPLETED_2026.length - 1].raceId])
  );
  const toggleRace = (rid) => setOpenRaces(s => {
    const n = new Set(s);
    n.has(rid) ? n.delete(rid) : n.add(rid);
    return n;
  });

  // Standings come from /championship/status (the official totals, sprint points included) and the win counts from
  // /season/2026 (race results). Nothing is hand-maintained here any more. If a source is down the panel says so.
  const [stand, setStand] = useState({ status: "loading", rows: [], asOf: null });
  const loadStandings = () => {
    Promise.allSettled([
      axios.get(`${API}/championship/status`, { timeout: 70000 }),
      axios.get(`${API}/season/2026`, { timeout: 70000 }),
    ]).then(([st, se]) => {
      if (st.status !== "fulfilled") { setStand({ status: "error", rows: [], asOf: null }); return; }
      const wins = {};
      if (se.status === "fulfilled") se.value.data.forEach((d) => { wins[d.driver_name] = d.wins; });
      const rows = st.value.data.drivers.contenders.map((c) => ({ driver: c.name, pts: c.points, wins: wins[c.name] ?? null, tid: teamIdByDriverName(c.name) }));
      setStand({ status: "ready", rows, asOf: st.value.data.as_of, clinched: st.value.data.drivers.clinched });
    });
  };
  useEffect(loadStandings, [wakeEpoch]);
  const standings = stand.rows;
  const roundsDone = COMPLETED_2026.length;
  const totalRounds = roundsDone + UPCOMING_RACES_2026.length;
  // Leader's points, so the top bar is full-width and the rest scale relative
  // to it — no manual update needed when the leader's total changes each race.
  const maxPts = Math.max(...standings.map((r) => r.pts), 1);

  // Two evaluation methodologies live in one table:
  //  • "snapshot"  — a model_snapshots row frozen BEFORE that round's qualifying
  //                  (snapshotted_at < qualiISO): genuine foresight. Predicted
  //                  winner/top-3 come from the frozen refs, NOT recomputed.
  //  • "live"      — no pre-quali snapshot (either none at all, or a post-quali
  //                  backfill — rounds 1-10 were backfilled 2026-07-23 via the
  //                  /predict real-grid path, AFTER their quali). We show the live
  //                  /predict/{raceId} ranking, which uses the REAL grid (the
  //                  model's strongest feature): valid test-set accuracy, NOT
  //                  foresight. Merely having a snapshot row is NOT enough.
  // The ACTUAL result always comes from /predict (positionOrder/podium), for both.
  const loadAccuracy = () => {
    setLoadingAcc(true);
    const ids = COMPLETED_2026.map(r => r.raceId);

    const snapsP = supabase.from("model_snapshots")
      .select("race_id, predicted_p1, predicted_p2, predicted_p3, snapshotted_at")
      .in("race_id", ids);

    const actualsP = Promise.all(COMPLETED_2026.map(r =>
      axios.get(`${API}/predict/${r.raceId}`)
        .then(res => ({ meta: r, data: res.data }))
        .catch(() => ({ meta: r, __failed: true }))
    ));

    Promise.all([snapsP, actualsP]).then(([snapsRes, actuals]) => {
      // Snapshot read failing just means every row falls back to "live" — not fatal.
      const snapByRace = {};
      if (!snapsRes.error) (snapsRes.data || []).forEach(s => {
        if (s.predicted_p1) snapByRace[s.race_id] = s;
      });

      // Every /predict failing means the backend is down/warming, not real 0%.
      if (actuals.every(a => a.__failed)) { setAccFailed(true); setLoadingAcc(false); return; }
      setAccFailed(false);

      const results = actuals.map(a => {
        const r = a.meta;
        const snap = snapByRace[r.raceId];
        // Genuine foresight only if the snapshot was frozen before quali started.
        const isPreRace = !!snap && !!r.qualiISO && new Date(snap.snapshotted_at) < new Date(r.qualiISO);
        const source = isPreRace ? "snapshot" : "live";
        if (a.__failed) {
          return { ...r, source, __failed: true, predictedNames: ["—", "—", "—"],
            actualNames: ["—", "—", "—"], predictedWinnerName: "—", actualWinnerName: "—",
            podiumCorrect: false, winnerCorrect: false };
        }
        const rows = a.data;
        const lastName = (full) => (full ? full.split(" ").pop() : full);
        const nameOf = (ref) => { const h = rows.find(d => d.driverRef === ref); return h ? lastName(h.driver_name) : ref; };

        // Actual result — always from /predict, for both methodologies.
        const actualSet = new Set(rows.filter(d => d.podium === 1).map(d => d.driverRef));
        const actualWinner = rows.find(d => d.positionOrder === 1);
        const actualNames = rows.filter(d => d.podium === 1)
          .sort((x, y) => x.positionOrder - y.positionOrder).map(d => lastName(d.driver_name));

        // Predicted — frozen pre-quali snapshot if genuine foresight, else live
        // /predict ranking (covers no-snapshot AND post-quali-backfill rows).
        let predRefs, predWinnerRef;
        if (isPreRace) {
          predRefs = [snap.predicted_p1, snap.predicted_p2, snap.predicted_p3];
          predWinnerRef = snap.predicted_p1;
        } else {
          const byProb = [...rows].sort((x, y) => y.podium_probability - x.podium_probability);
          const byWin = [...rows].sort((x, y) => (y.win_probability ?? 0) - (x.win_probability ?? 0));
          predRefs = byProb.slice(0, 3).map(d => d.driverRef);
          predWinnerRef = byWin[0]?.driverRef ?? null;
        }
        const predSet = new Set(predRefs);
        const podiumCorrect = predSet.size === actualSet.size && [...predSet].every(d => actualSet.has(d));
        const winnerCorrect = !!predWinnerRef && !!actualWinner && predWinnerRef === actualWinner.driverRef;

        return {
          ...r,
          source,
          predictedNames: predRefs.map(nameOf),
          actualNames,
          predictedWinnerName: predWinnerRef ? nameOf(predWinnerRef) : "—",
          actualWinnerName: actualWinner ? lastName(actualWinner.driver_name) : "—",
          podiumCorrect,
          winnerCorrect,
        };
      });

      // Split the tally: pre-race (snapshot) vs test-set (live) are different measures.
      const summarize = (subset) => {
        const scored = subset.filter(r => !r.__failed);
        const w = scored.filter(r => r.winnerCorrect).length;
        const p = scored.filter(r => r.podiumCorrect).length;
        return {
          n: scored.length, winnerCorrect: w, podiumCorrect: p,
          winnerPct: scored.length ? Math.round(w / scored.length * 100) : 0,
          podiumPct: scored.length ? Math.round(p / scored.length * 100) : 0,
        };
      };

      setAccuracy({
        races: results,
        preRace: summarize(results.filter(r => r.source === "snapshot")),
        testSet: summarize(results.filter(r => r.source === "live")),
      });
      setLoadingAcc(false);
    });
  };

  // Reload on mount and again each time the backend transitions to ready.
  // loadAccuracy sets a loading flag then fetches — a standard data-loading
  // effect; the sync setState is intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(loadAccuracy, [wakeEpoch]);

  const leader = standings[0], second = standings[1];
  const next = new Date(NEXT_RACE.raceISO).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">LIVE TEST SET · POST-TRAINING DATA</div>
          <h1 className="wordfit">2026 <em>season</em></h1>
        </div>
        <div className="hm-count"><div className="hm-digits"><span>{String(roundsDone).padStart(2, "0")}<small>RACES COMPLETE</small></span></div></div>
      </header>

      <Panel title="Season at a glance" caption="Where the 2026 season stands today.">
        <div className="hm-tiles">
          <div className="hm-tile"><label>COMPLETED</label><b>{roundsDone} / {totalRounds}</b><small>races</small></div>
          <div className="hm-tile"><label>LEADER</label><b className="red">{leader ? leader.driver.split(" ").pop() : "—"}</b><small>{leader && second ? `+${leader.pts - second.pts} pts gap` : "standings loading"}</small></div>
          <div className="hm-tile"><label>REMAINING</label><b>{UPCOMING_RACES_2026.length}</b><small>races to go</small></div>
          <div className="hm-tile"><label>NEXT RACE</label><b>{NEXT_RACE.name.replace(" Grand Prix", "")}</b><small>{next} · {NEXT_RACE.circuit}</small></div>
        </div>
      </Panel>

      <div className="hm-grid">
        <div className="hm-main">
          <Panel title="Driver championship" caption={stand.asOf ? `Official points after ${stand.asOf.race} (round ${stand.asOf.round}). Top ten.` : "Official points, top ten."}>
            {stand.status === "loading" && <SkeletonList rows={5} metrics={1} />}
            {stand.status === "error" && <p className="hm-note">The standings could not be loaded. <button type="button" className="hm-link" onClick={() => { setStand({ status: "loading", rows: [], asOf: null }); loadStandings(); }}>Retry</button></p>}
            {stand.status === "ready" && (
              <div className="ch-tbl se-tbl" role="table" aria-label="Driver championship">
                {standings.map((r, i) => (
                  <div className="ch-tr se-tr" role="row" key={r.driver} style={{ "--team": teamColor(r.tid) }}>
                    <span className="hm-n">{i + 1}</span>
                    <span className="hm-tm"><i className="hm-bar" />{r.tid ? <TeamMark team={r.tid} size={22} /> : <span style={{ width: 30 }} />}</span>
                    <span className="hm-drv"><b>{driverCode(r.driver)}</b><span> {r.driver}</span><small>{r.wins == null ? "wins not available" : `${r.wins} win${r.wins === 1 ? "" : "s"}`}</small></span>
                    <span className="hm-meter hm-hide-m" aria-hidden="true"><i style={{ width: `${(100 * r.pts) / maxPts}%` }} /></span>
                    <span className="hm-v ch-pts">{r.pts}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <aside className="hm-side">
          <Panel title={`Remaining calendar`} caption={`${UPCOMING_RACES_2026.length} rounds still to run.`}>
            <ul className="hm-sched">
              {UPCOMING_RACES_2026.map((r) => (
                <li key={r.raceId} className={r.raceId === NEXT_RACE.raceId ? "race" : ""}>
                  <span>{CALENDAR_FLAGS[r.round]} R{r.round} {r.name.replace(" Grand Prix", "")}</span>
                  <time>{r.date}</time>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      {/* Model accuracy tracker */}
      <GlassPanel className="chart-enter">
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div><span className="section-label">Model Accuracy Tracker — 2026</span><div className="hm-note" style={{ marginTop: 4 }}>How the model's picks compared with what happened. Pre-race rows are genuine foresight; post-quali rows are not.</div></div>
          {!loadingAcc && accuracy && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end" }}>
              {/* Pre-race (snapshot) cohort — small sample so far, counts only. */}
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", fontWeight: "700" }}>
                <span className="live-pulse" style={{ color: "var(--gold)", letterSpacing: "0.08em", display: "inline-block" }}>PRE-RACE</span>
                <span style={{ color: "var(--text)" }}> · WIN {accuracy.preRace.winnerCorrect}/{accuracy.preRace.n} · POD {accuracy.preRace.podiumCorrect}/{accuracy.preRace.n}</span>
              </span>
              {/* Test-set (live, post-qualifying) cohort — larger sample, show %. */}
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", fontWeight: "700" }}>
                <span style={{ color: "var(--muted)", letterSpacing: "0.08em" }}>TEST-SET</span>
                <span style={{ color: "var(--text)", opacity: 0.8 }}> · WIN {accuracy.testSet.winnerCorrect}/{accuracy.testSet.n} · {accuracy.testSet.winnerPct}% · POD {accuracy.testSet.podiumCorrect}/{accuracy.testSet.n} · {accuracy.testSet.podiumPct}%</span>
              </span>
            </div>
          )}
        </div>
        {accFailed ? (
          <div style={{ padding: "1rem" }}>
            <BackendPanel detail="The 2026 accuracy backfill request failed." onRetry={loadAccuracy} />
          </div>
        ) : loadingAcc ? <Spinner text="LOADING ACCURACY DATA..." /> : accuracy && (
          <>
            {/* Methodology legend — the table mixes two kinds of evaluation. */}
            <div style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "1.25rem", flexWrap: "wrap", fontFamily: "var(--mono)", fontSize: "0.56rem", color: "var(--muted)", lineHeight: 1.5 }}>
              <span><span style={{ color: "var(--gold)", fontWeight: 700 }}>● PRE-RACE</span> — frozen pre-qualifying snapshot (genuine foresight)</span>
              <span><span style={{ fontWeight: 700 }}>● POST-QUALI</span> — live model on the real grid (test-set accuracy, not foresight)</span>
            </div>
            <div className="accuracy-grid" style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 44px 1fr 1fr 44px", borderBottom: "1px solid var(--border)" }}>
              {[
                { h: "RACE" }, { h: "PRED. WINNER" }, { h: "ACTUAL WINNER" }, { h: "WIN" },
                { h: "PREDICTED TOP 3", hideMobile: true }, { h: "ACTUAL TOP 3", hideMobile: true }, { h: "POD" },
              ].map((col, i) => (
                <div key={i} className={col.hideMobile ? "hide-mobile" : undefined} style={{ padding: "0.45rem 0.75rem", fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", color: "var(--muted)", letterSpacing: "0.1em" }}>{col.h}</div>
              ))}
            </div>
            {accuracy.races.map((r, i) => (
              <div key={i} className="data-row stagger-item accuracy-grid" style={{ "--i": i, display: "grid", gridTemplateColumns: "100px 1fr 1fr 44px 1fr 1fr 44px", borderBottom: i < accuracy.races.length - 1 ? "1px solid var(--border)" : "none", borderLeft: r.podiumCorrect ? "3px solid var(--green)" : "3px solid var(--dimmed)" }}>
                <div style={{ padding: "0.6rem 0.75rem" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", fontWeight: "700" }}>RD {r.round} {r.flag}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--text)", marginTop: "2px", fontWeight: "600" }}>{r.name}</div>
                  <span className={r.source === "snapshot" ? "live-pulse" : undefined} style={{
                    display: "inline-block", marginTop: "4px", fontFamily: "var(--mono)", fontSize: "0.5rem",
                    fontWeight: "700", letterSpacing: "0.06em", padding: "1px 5px", borderRadius: "3px",
                    color: r.source === "snapshot" ? "var(--gold)" : "var(--muted)",
                    background: r.source === "snapshot" ? "rgba(255,199,0,0.12)" : "rgba(255,255,255,0.05)",
                    border: "1px solid " + (r.source === "snapshot" ? "rgba(255,199,0,0.4)" : "rgba(255,255,255,0.15)"),
                  }}>{r.source === "snapshot" ? "PRE-RACE" : "POST-QUALI"}</span>
                </div>
                <div style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--gold)", display: "flex", alignItems: "center" }}>
                  {r.predictedWinnerName}
                </div>
                <div style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--text)", display: "flex", alignItems: "center" }}>
                  {r.actualWinnerName}
                </div>
                <div style={{ padding: "0.6rem 0.75rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: r.winnerCorrect ? "var(--gold)" : "var(--dimmed)" }}>{r.winnerCorrect ? "✓" : "✗"}</span>
                </div>
                <div className="hide-mobile" style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", display: "flex", alignItems: "center" }}>
                  {r.predictedNames.join(" · ")}
                </div>
                <div className="hide-mobile" style={{ padding: "0.6rem 0.75rem", fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--text)", display: "flex", alignItems: "center" }}>
                  {r.actualNames.join(" · ")}
                </div>
                <div style={{ padding: "0.6rem 0.75rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: r.podiumCorrect ? "var(--green)" : "var(--dimmed)" }}>{r.podiumCorrect ? "✓" : "✗"}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </GlassPanel>


      {/* Race strategy & telemetry (OpenF1) — one collapsible row per completed round */}
      <GlassPanel className="chart-enter">
        <div style={{ padding: "0.75rem 1rem" }}>
          <span className="section-label">Race Strategy &amp; Telemetry — completed rounds</span><div className="hm-note" style={{ marginTop: 4 }}>Tyre stints and telemetry from OpenF1, one row per completed race. Open a row to see it.</div>
        </div>
        {COMPLETED_2026.map((r) => (
          <RaceStrategySection
            key={r.raceId}
            raceId={r.raceId}
            open={openRaces.has(r.raceId)}
            onToggle={() => toggleRace(r.raceId)}
            label={<><span style={{ color: "var(--muted)", marginRight: "0.5rem" }}>RD {r.round}</span>{r.flag} {r.name}</>}
          />
        ))}
      </GlassPanel>

    </div>
  );
};


export default Season2026Page;
