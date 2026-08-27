import { useState, useEffect } from "react";
import axios from "axios";
import { Spinner, StatCard, SectionHeader, BackendPanel } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { API, UPCOMING_RACES_2026, COMPLETED_2026 } from "../constants.js";
import { useHealth } from "../health.jsx";
import { RaceStrategySection } from "../components/RaceStrategy.jsx";
import { supabase } from "../lib/supabaseClient.js";

// ── 2026 SEASON PAGE ───────────────────────────────────────────
const CALENDAR_FLAGS = { 9:"🇬🇧",10:"🇧🇪",11:"🇭🇺",12:"🇳🇱",13:"🇮🇹",14:"🇪🇸",15:"🇦🇿",16:"🇸🇬",17:"🇺🇸",18:"🇲🇽",19:"🇧🇷",20:"🇺🇸",21:"🇶🇦",22:"🇦🇪" };

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

  // Post-Dutch GP (round 12) standings. These are the OFFICIAL championship
  // totals from data/driver_standings.csv (raceId 1180), which include sprint
  // points -- they intentionally differ from /season/2026, whose totals are
  // summed from results.csv and so are race-only (sprint_results.csv has no
  // 2026 rows). Russell takes P2 from Hamilton on countback at 183 apiece.
  const standings = [
    { driver: "Kimi Antonelli",  team: "Mercedes",      pts: 242, wins: 6, color: "#00d2be" },
    { driver: "George Russell",  team: "Mercedes",      pts: 183, wins: 2, color: "#00d2be" },
    { driver: "Lewis Hamilton",  team: "Ferrari",       pts: 183, wins: 1, color: "#e10600" },
    { driver: "Lando Norris",    team: "McLaren",       pts: 159, wins: 2, color: "#ff8000" },
    { driver: "Charles Leclerc", team: "Ferrari",       pts: 155, wins: 1, color: "#e10600" },
    { driver: "Max Verstappen",  team: "Red Bull",      pts: 112, wins: 0, color: "#3671c6" },
    { driver: "Oscar Piastri",   team: "McLaren",       pts: 104, wins: 0, color: "#ff8000" },
    { driver: "Isack Hadjar",    team: "Red Bull",      pts: 68,  wins: 0, color: "#3671c6" },
    { driver: "Liam Lawson",     team: "Red Bull",      pts: 49,  wins: 0, color: "#3671c6" },
    { driver: "Pierre Gasly",    team: "Alpine",        pts: 44,  wins: 0, color: "#0093cc" },
  ];
  // Leader's points, so the top bar is full-width and the rest scale relative
  // to it — no manual update needed when the leader's total changes each race.
  const maxPts = Math.max(...standings.map(s => s.pts));

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader
        variant="glass"
        eyebrow="Live Test Set · Post-Training Data"
        title="2026 Formula One Season"
        right={<div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "rgba(255,255,255,0.7)", textAlign: "right" }}><div>12 RACES COMPLETE</div></div>}
      />

      {/* Season summary bar */}
      <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatCard label="Completed"  value="12 / 22"      sub="races"             />
        <StatCard label="Leader"     value="Antonelli"     accent="var(--red)"  sub="+59 pts gap" />
        <StatCard label="Remaining"  value="10"            sub="races to go"       />
        <StatCard label="Next Race"  value="Italian GP"    sub="Sep 6 · Monza" />
      </div>

      {/* Championship standings */}
      <GlassPanel className="chart-enter">
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">Driver Championship — after 12 rounds</span>
        </div>
        {standings.map((s, i) => (
          <div key={i} className="data-row stagger-item row-gap-tight" style={{ "--i": i, display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 1rem", borderBottom: i < standings.length - 1 ? "1px solid var(--border)" : "none" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "20px", flexShrink: 0 }}>{i + 1}</span>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "700", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.driver}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--muted)", opacity: 0.5, marginTop: "2px" }}>{s.team} · {s.wins} win{s.wins !== 1 ? "s" : ""}</div>
            </div>
            <div className="standings-bar" style={{ width: "140px", flexShrink: 0 }}>
              <div style={{ height: "2px", background: "var(--dimmed)", marginBottom: "3px" }}>
                <div className="prob-bar" style={{ height: "100%", width: `${(s.pts / maxPts) * 100}%`, background: i === 0 ? "var(--red)" : s.color }} />
              </div>
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.88rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--text)", width: "40px", textAlign: "right", flexShrink: 0 }}>{s.pts}</span>
          </div>
        ))}
      </GlassPanel>

      {/* Model accuracy tracker */}
      <GlassPanel className="chart-enter">
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <span className="section-label">Model Accuracy Tracker — 2026</span>
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
          <span className="section-label">Race Strategy &amp; Telemetry — completed rounds</span>
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

      {/* Remaining calendar */}
      <GlassPanel className="chart-enter">
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">Remaining 2026 Calendar — 10 rounds</span>
        </div>
        {UPCOMING_RACES_2026.map((r, i) => (
          <div key={i} className="data-row stagger-item" style={{ "--i": i, display: "flex", alignItems: "center", gap: "1rem", padding: "0.6rem 1rem", borderBottom: i < UPCOMING_RACES_2026.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", fontWeight: "700", color: "var(--muted)", width: "36px", flexShrink: 0 }}>RD {r.round}</div>
            <span style={{ fontSize: "1rem", flexShrink: 0 }}>{CALENDAR_FLAGS[r.round]}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "700", fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.name}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)", marginTop: "2px" }}>{r.circuit}</div>
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", flexShrink: 0 }}>{r.date}</span>
          </div>
        ))}
      </GlassPanel>
    </div>
  );
};


export default Season2026Page;
