import { useState, useEffect } from "react";
import axios from "axios";
import { Spinner, StatCard, SectionHeader } from "../shared.jsx";
import { API, card, UPCOMING_RACES_2026 } from "../constants.js";

// ── 2026 SEASON PAGE ───────────────────────────────────────────
const COMPLETED_2026 = [
    { raceId: 1169, round: 1, name: "Australian GP",         flag: "🇦🇺" },
    { raceId: 1170, round: 2, name: "Chinese GP",             flag: "🇨🇳" },
    { raceId: 1171, round: 3, name: "Japanese GP",            flag: "🇯🇵" },
    { raceId: 1172, round: 4, name: "Miami GP",               flag: "🇺🇸" },
    { raceId: 1173, round: 5, name: "Canadian GP",            flag: "🇨🇦" },
    { raceId: 1174, round: 6, name: "Monaco GP",              flag: "🇲🇨" },
    { raceId: 1175, round: 7, name: "Spanish GP (Barcelona)", flag: "🇪🇸" },
    { raceId: 1176, round: 8, name: "Austrian GP",            flag: "🇦🇹" },
];

const CALENDAR_FLAGS = { 9:"🇬🇧",10:"🇧🇪",11:"🇭🇺",12:"🇳🇱",13:"🇮🇹",14:"🇪🇸",15:"🇦🇿",16:"🇸🇬",17:"🇺🇸",18:"🇲🇽",19:"🇧🇷",20:"🇺🇸",21:"🇶🇦",22:"🇦🇪" };

const Season2026Page = () => {
  const [accuracy, setAccuracy] = useState(null);
  const [loadingAcc, setLoadingAcc] = useState(true);

  const standings = [
    { driver: "Kimi Antonelli",  team: "Mercedes",     pts: 171, wins: 5, color: "#00d2be" },
    { driver: "George Russell",  team: "Mercedes",      pts: 131, wins: 2, color: "#00d2be" },
    { driver: "Lewis Hamilton",  team: "Ferrari",       pts: 125, wins: 1, color: "#e10600" },
    { driver: "Oscar Piastri",   team: "McLaren",       pts: 80,  wins: 0, color: "#ff8000" },
    { driver: "Lando Norris",    team: "McLaren",       pts: 79,  wins: 0, color: "#ff8000" },
    { driver: "Charles Leclerc", team: "Ferrari",       pts: 79,  wins: 0, color: "#e10600" },
    { driver: "Max Verstappen",  team: "Red Bull",      pts: 73,  wins: 0, color: "#3671c6" },
    { driver: "Isack Hadjar",    team: "Red Bull",      pts: 42,  wins: 0, color: "#3671c6" },
    { driver: "Pierre Gasly",    team: "Alpine",        pts: 41,  wins: 0, color: "#0093cc" },
    { driver: "Liam Lawson",     team: "Racing Bulls",  pts: 30,  wins: 0, color: "#6692ff" },
  ];

  useEffect(() => {
    Promise.all(COMPLETED_2026.map(r =>
      axios.get(`${API}/predict/${r.raceId}`)
        .then(res => {
          const byProb = [...res.data].sort((a, b) => b.podium_probability - a.podium_probability);
          const predSet = new Set(byProb.slice(0, 3).map(d => d.driverRef));
          const actualSet = new Set(res.data.filter(d => d.podium === 1).map(d => d.driverRef));
          const podiumCorrect = predSet.size === actualSet.size && [...predSet].every(d => actualSet.has(d));

          const byWin = [...res.data].sort((a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0));
          const predictedWinner = byWin[0];
          const actualWinner = res.data.find(d => d.positionOrder === 1);
          const winnerCorrect = !!predictedWinner && !!actualWinner && predictedWinner.driverRef === actualWinner.driverRef;

          return {
            ...r,
            predictedNames: byProb.slice(0, 3).map(d => d.driver_name.split(" ").pop()),
            actualNames: res.data.filter(d => d.podium === 1)
              .sort((a, b) => a.positionOrder - b.positionOrder)
              .map(d => d.driver_name.split(" ").pop()),
            predictedWinnerName: predictedWinner?.driver_name.split(" ").pop() ?? "—",
            actualWinnerName: actualWinner?.driver_name.split(" ").pop() ?? "—",
            podiumCorrect,
            winnerCorrect,
          };
        })
        .catch(() => ({ ...r, predictedNames: ["—", "—", "—"], actualNames: ["—", "—", "—"], predictedWinnerName: "—", actualWinnerName: "—", podiumCorrect: false, winnerCorrect: false }))
    )).then(results => {
      const podiumCorrectCount = results.filter(r => r.podiumCorrect).length;
      const winnerCorrectCount = results.filter(r => r.winnerCorrect).length;
      setAccuracy({
        races: results,
        podiumCorrectCount, winnerCorrectCount,
        podiumPct: Math.round(podiumCorrectCount / results.length * 100),
        winnerPct: Math.round(winnerCorrectCount / results.length * 100),
      });
      setLoadingAcc(false);
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader
        eyebrow="Live Test Set · Post-Training Data"
        title="2026 Formula One Season"
        right={<div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "rgba(255,255,255,0.7)", textAlign: "right" }}><div>8 RACES COMPLETE</div></div>}
      />

      {/* Season summary bar */}
      <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatCard label="Completed"  value="8 / 22"       sub="races"             />
        <StatCard label="Leader"     value="Antonelli"     accent="var(--red)"  sub="+40 pts gap" />
        <StatCard label="Remaining"  value="14"            sub="races to go"       />
        <StatCard label="Next Race"  value="British GP"    sub="Jul 5 · Silverstone" />
      </div>

      {/* Championship standings */}
      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">Driver Championship — after 8 rounds</span>
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
                <div className="prob-bar" style={{ height: "100%", width: `${(s.pts / 171) * 100}%`, background: i === 0 ? "var(--red)" : s.color }} />
              </div>
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.88rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--text)", width: "40px", textAlign: "right", flexShrink: 0 }}>{s.pts}</span>
          </div>
        ))}
      </div>

      {/* Model accuracy tracker */}
      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <span className="section-label">Model Accuracy Tracker — 2026</span>
          {!loadingAcc && accuracy && (
            <div style={{ display: "flex", gap: "1rem" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", fontWeight: "700", color: accuracy.winnerPct >= 50 ? "var(--gold)" : "var(--red)" }}>
                WINNER {accuracy.winnerCorrectCount}/{accuracy.races.length} · {accuracy.winnerPct}%
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", fontWeight: "700", color: accuracy.podiumPct >= 50 ? "var(--green)" : "var(--red)" }}>
                PODIUM {accuracy.podiumCorrectCount}/{accuracy.races.length} · {accuracy.podiumPct}%
              </span>
            </div>
          )}
        </div>
        {loadingAcc ? <Spinner text="LOADING ACCURACY DATA..." /> : (
          <>
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
      </div>

      {/* Remaining calendar */}
      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">Remaining 2026 Calendar — 14 rounds</span>
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
      </div>
    </div>
  );
};


export default Season2026Page;
