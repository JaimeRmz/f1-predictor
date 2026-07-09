import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, Legend
} from "recharts";
import { StatCard, Pill, CustomTooltip, SectionHeader, CountUp, RaceSelector, BackendPanel, SkeletonList } from "../shared.jsx";
import { API, card, CONSTRUCTOR_OVERRIDES, UPCOMING_RACES_2026, UPCOMING_IDS, STANDINGS_GRID_2026 } from "../constants.js";

// ── PREDICTOR PAGE ─────────────────────────────────────────────
const PredictorPage = () => {
  const [races, setRaces] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRaceId, setSelectedRaceId] = useState("");
  const [selectedRaceName, setSelectedRaceName] = useState("");
  const [tab, setTab] = useState("drivers");
  const [explainDriver, setExplainDriver] = useState(null);
  const [isUpcoming, setIsUpcoming] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    axios.get(`${API}/races`).then(r => setRaces(r.data)).catch(() => setOffline(true));
  }, []);

  const retry = () => {
    setOffline(false);
    axios.get(`${API}/races`).then(r => setRaces(r.data)).catch(() => setOffline(true));
    if (selectedRaceId) predict(selectedRaceId, selectedRaceName);
  };

  const predict = async (id, label) => {
    if (!id) return;
    setSelectedRaceId(id);
    setSelectedRaceName(label);
    setLoading(true); setPredictions([]); setExplainDriver(null); setOffline(false);
    try {
      if (UPCOMING_IDS.has(id)) {
        setIsUpcoming(true);
        const race = UPCOMING_RACES_2026.find(r => String(r.raceId) === id);
        const circuitRef = race?.circuitRef ?? "";
        const res = await axios.post(`${API}/whatif?circuitRef=${circuitRef}&auto_quali=true`, STANDINGS_GRID_2026);
        setPredictions(res.data);
      } else {
        setIsUpcoming(false);
        const res = await axios.get(`${API}/predict/${id}`);
        setPredictions(res.data);
      }
      setTab("drivers");
    } catch (err) {
      console.error("Prediction failed:", err);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  };

  const podiums = predictions.filter(p => p.podium === 1);
  const gridPredictions = isUpcoming
    ? [...predictions].sort((a, b) => a.grid - b.grid)
    : predictions;
  const podiumsCaught = podiums.filter(p => p.podium_probability > 0.5).length;
  const accuracy = !isUpcoming && podiums.length > 0
    ? Math.round((podiumsCaught / podiums.length) * 100)
    : null;

  // Winner-first framing: predicted winner is whoever the win model ranks
  // highest, which isn't always the same driver the podium model ranks #1.
  const predictedWinner = predictions.length > 0
    ? [...predictions].sort((a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0))[0]
    : null;
  const actualWinner = !isUpcoming ? predictions.find(p => p.positionOrder === 1) : null;
  const winnerCorrect = !isUpcoming && predictedWinner && actualWinner
    ? predictedWinner.driverRef === actualWinner.driverRef
    : null;
  const podiumFavorites = predictions.filter(p => p.podium_probability > 0.6).length;
  const predictedPole = gridPredictions[0];

  const featureLabels = {
    grid: "Grid Position", driver_season_points: "Driver Points",
    constructor_season_points: "Constructor Points", driver_circuit_podium_rate: "Circuit Win Rate",
    driver_recent_form: "Recent Form", constructor_recent_form: "Team Form", driver_dnf_rate: "DNF Rate",
  };
  const featureMax = { grid: 20, driver_season_points: 400, constructor_season_points: 700, driver_circuit_podium_rate: 1, driver_recent_form: 20, constructor_recent_form: 20, driver_dnf_rate: 1 };

  return (
    <div>
      <div className="card-lift" style={{ ...card, padding: "1.25rem", marginBottom: "1rem" }}>
        <div className="section-label" style={{ marginBottom: "0.6rem" }}>Select Grand Prix</div>
        <RaceSelector upcoming={UPCOMING_RACES_2026} completed={races} value={selectedRaceId} onSelect={predict} />
      </div>

      {offline && <BackendPanel detail="The race list or prediction request failed." onRetry={retry} />}

      {loading && <SkeletonList rows={10} />}

      {!loading && predictions.length > 0 && (
        <>
          <div className="accent-strip scanline-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: "900", letterSpacing: "0.08em", textTransform: "uppercase", fontStyle: "italic" }}>{selectedRaceName}</span>
            {isUpcoming
              ? <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", fontWeight: "700", color: "var(--gold)", letterSpacing: "0.1em" }}>UPCOMING RACE</span>
              : accuracy !== null && <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", fontWeight: "700", opacity: 0.85 }}>ACCURACY: {accuracy}%</span>
            }
          </div>

          {isUpcoming && (
            <>
              {/* ── SECTION 1: PREDICTED QUALIFYING — order only, no probabilities ── */}
              <SectionHeader eyebrow="XGBoost Regressor · Qualifying Model" title="Predicted Qualifying" />
              <div className="chart-enter" style={{ ...card, marginBottom: "0.75rem" }}>
                {gridPredictions.map((p, i) => (
                  <div key={p.driverRef} className="data-row stagger-item" style={{
                    "--i": i,
                    display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.6rem 1rem",
                    borderBottom: i < gridPredictions.length - 1 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "26px", flexShrink: 0 }}>P{p.grid}</div>
                    <div style={{ flex: 1, fontWeight: "700", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.driver_name}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)" }}>{CONSTRUCTOR_OVERRIDES[p.driverRef] || p.team}</div>
                  </div>
                ))}
              </div>
              <div style={{ ...card, padding: "14px 20px", marginBottom: "2rem", display: "flex", gap: "0.6rem", alignItems: "center", borderLeft: "3px solid var(--gold)" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--gold)", fontWeight: "700", flexShrink: 0 }}>NOTE</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", lineHeight: 1.6 }}>
                  Grid auto-predicted by qualifying model · updates after real qualifying
                </span>
              </div>

              {/* ── divider between the two sections ── */}
              <div style={{ height: "1px", background: "var(--border)", margin: "0 0 1.5rem" }} />

              {/* ── SECTION 2: PRE-RACE PREDICTION — podium & win probabilities, ordered by predicted grid ── */}
              <SectionHeader eyebrow="XGBoost Classifiers · Podium & Win Models" title="Pre-Race Prediction" />
            </>
          )}

          <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "1rem" }}>
            <StatCard
              label="Predicted Winner"
              value={predictedWinner ? `${predictedWinner.driver_name.split(" ").pop()} · ${((predictedWinner.win_probability ?? 0) * 100).toFixed(1)}%` : "—"}
              accent="var(--gold)"
            />
            {isUpcoming ? (
              <>
                <StatCard label="Podium Favorites" value={`${podiumFavorites} drivers`} sub="podium % > 60" />
                <StatCard label="Predicted Pole" value={predictedPole?.driver_name.split(" ").pop() ?? "—"} accent="var(--red)" />
              </>
            ) : (
              <>
                <StatCard label="Winner Correct?" value={winnerCorrect === null ? "—" : winnerCorrect ? "✓" : "✗"} accent={winnerCorrect ? "var(--green)" : "var(--red)"} />
                <StatCard label="Podiums Caught" value={accuracy !== null ? `${podiumsCaught}/${podiums.length} · ${accuracy}%` : "—"} />
                <StatCard label="High Confidence" value={predictions.filter(p => p.podium_probability > 0.5).length} sub="drivers flagged" />
              </>
            )}
          </div>

          <div style={{ borderBottom: "1px solid var(--border)", marginBottom: "1rem", display: "flex" }}>
            {["drivers", "chart", "explainer"].map(t => <Pill key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Pill>)}
          </div>

          {tab === "drivers" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0 1.25rem 0.4rem" }}>
                <div style={{ width: "22px", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }} />
                <div style={{ width: "90px", flexShrink: 0, textAlign: "right", fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--gold)", fontWeight: "700", letterSpacing: "0.1em" }}>WIN %</div>
                <div style={{ width: "90px", flexShrink: 0, textAlign: "right", fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", fontWeight: "700", letterSpacing: "0.1em" }}>PODIUM %</div>
                <div style={{ width: "70px", flexShrink: 0 }} />
              </div>
              {predictions.map((p, i) => (
                <div key={i} onClick={() => { setExplainDriver(p); setTab("explainer"); }}
                  className="data-row clickable stagger-item row-gap-tight"
                  style={{
                    ...card, "--i": i, padding: "16px", display: "flex", alignItems: "center", gap: "1rem",
                    borderLeft: p.podium === 1 ? "3px solid var(--green)" : i === 0 ? "3px solid var(--red)" : "3px solid var(--dimmed)",
                    background: i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                  }}>
                  <div style={{ fontFamily: "var(--mono)", width: "22px", fontSize: "0.75rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", flexShrink: 0 }}>P{i+1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "700", fontSize: "0.88rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.driver_name}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--muted)", marginTop: "2px" }}>
                      {isUpcoming ? `QUALI P${p.grid} · PRED P${i + 1}` : `GRID P${p.grid} · FIN P${p.positionOrder}`}
                      {p.podium === 1 && <span style={{ color: "var(--green)", marginLeft: "8px" }}>✓ PODIUM</span>}
                    </div>
                  </div>
                  <div className="pred-metric" style={{ width: "90px", flexShrink: 0 }}>
                    <div style={{ height: "2px", background: "var(--dimmed)", marginBottom: "4px", overflow: "hidden" }}>
                      <div className="prob-bar" style={{ height: "100%", width: `${((p.win_probability ?? 0) * 100).toFixed(0)}%`, background: "var(--gold)" }} />
                    </div>
                    <div style={{ fontFamily: "var(--mono)", textAlign: "right", fontSize: "0.82rem", fontWeight: "700", color: p.win_probability > 0.3 ? "var(--gold)" : "var(--muted)" }}><CountUp value={(p.win_probability ?? 0) * 100} suffix="%" /></div>
                  </div>
                  <div className="pred-metric" style={{ width: "90px", flexShrink: 0 }}>
                    <div style={{ height: "2px", background: "var(--dimmed)", marginBottom: "4px", overflow: "hidden" }}>
                      <div className="prob-bar" style={{ height: "100%", width: `${(p.podium_probability * 100).toFixed(0)}%`, background: p.podium === 1 ? "var(--green)" : "var(--red)" }} />
                    </div>
                    <div style={{ fontFamily: "var(--mono)", textAlign: "right", fontSize: "0.82rem", fontWeight: "700", color: p.podium_probability > 0.5 ? "var(--red)" : "var(--muted)" }}><CountUp value={p.podium_probability * 100} suffix="%" /></div>
                  </div>
                  <div className="hide-mobile" style={{ width: "70px", flexShrink: 0, fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--dimmed)", letterSpacing: "0.06em" }}>EXPLAIN →</div>
                </div>
              ))}
            </div>
          )}

          {tab === "chart" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="chart-enter" style={{ ...card, padding: "20px" }}>
                <div className="section-label" style={{ marginBottom: "1rem" }}>Podium Probability by Driver</div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={predictions} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" horizontal={false} />
                    <XAxis type="number" domain={[0, 1]} tickFormatter={v => `${(v*100).toFixed(0)}%`} stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} />
                    <YAxis type="category" dataKey="driver_name" width={130} stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(225,6,0,0.04)" }} />
                    <Bar dataKey="podium_probability" radius={0}>
                      {predictions.map((p, i) => <Cell key={i} fill={p.podium === 1 ? "#00c853" : i === 0 ? "#e10600" : i < 3 ? "#ff4422" : "#2a2a38"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-enter" style={{ ...card, padding: "20px" }}>
                <div className="section-label" style={{ marginBottom: "1rem" }}>Predicted Rank vs Actual Finish</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={predictions.map((p, i) => ({ name: p.driver_name.split(" ").pop(), predicted: i + 1, actual: p.positionOrder }))}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                    <XAxis dataKey="name" stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                    <YAxis reversed stroke="var(--dimmed)" tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }} domain={[1, 20]} />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                    <Legend wrapperStyle={{ fontSize: "0.68rem", fontFamily: "var(--mono)", color: "var(--muted)" }} />
                    <Line type="monotone" dataKey="predicted" stroke="#e10600" strokeWidth={2} dot={{ r: 3, fill: "#e10600" }} name="Model" />
                    <Line type="monotone" dataKey="actual" stroke="#00c853" strokeWidth={2} dot={{ r: 3, fill: "#00c853" }} name="Actual" strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {tab === "explainer" && (
            <div>
              {!explainDriver ? (
                <div style={{ ...card, padding: "3rem", textAlign: "center" }}>
                  <p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.75rem", letterSpacing: "0.1em" }}>SELECT A DRIVER IN THE DRIVERS TAB</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div className="accent-strip">
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.25em", opacity: 0.75, marginBottom: "0.25rem" }}>PREDICTION BREAKDOWN</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "900", fontStyle: "italic", letterSpacing: "0.02em" }}>{explainDriver.driver_name.toUpperCase()}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", opacity: 0.9, marginTop: "3px" }}>{(explainDriver.podium_probability * 100).toFixed(1)}% PODIUM PROBABILITY</div>
                  </div>
                  <div className="chart-enter" style={{ ...card }}>
                    <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
                      <span className="section-label">Feature Breakdown</span>
                    </div>
                    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                      {Object.entries(featureLabels).map(([key, label]) => {
                        const val = explainDriver[key];
                        const max = featureMax[key];
                        const pct = Math.min((val / max) * 100, 100);
                        const isGood = key === "grid" ? val <= 3 : key.includes("dnf") ? val < 0.1 : key.includes("form") ? val < 6 : val > max * 0.3;
                        return (
                          <div key={key}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                              <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
                              <span style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: isGood ? "var(--green)" : "var(--red)" }}>
                                {key.includes("rate") || key.includes("dnf") ? `${(val * 100).toFixed(0)}%` : val?.toFixed(1)}
                              </span>
                            </div>
                            <div style={{ height: "3px", background: "var(--dimmed)", overflow: "hidden" }}>
                              <div className="prob-bar" style={{ height: "100%", width: `${pct}%`, background: isGood ? "var(--green)" : "var(--red)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="chart-enter" style={{ ...card, padding: "1.25rem" }}>
                    <div className="section-label" style={{ marginBottom: "0.6rem" }}>Plain English Summary</div>
                    <p style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.9, margin: 0 }}>
                      <span style={{ color: "var(--text)" }}>{explainDriver.driver_name}</span> started from grid <span style={{ color: "var(--text)" }}>P{explainDriver.grid ?? "N/A"}</span>, entered with <span style={{ color: "var(--text)" }}>{Number.isFinite(explainDriver.driver_season_points) ? explainDriver.driver_season_points.toFixed(0) : "N/A"} pts</span>, and has {Number.isFinite(explainDriver.driver_circuit_podium_rate)
                        ? <>a <span style={{ color: "var(--text)" }}>{(explainDriver.driver_circuit_podium_rate * 100).toFixed(0)}%</span> podium rate</>
                        : "no podium history"} at this circuit. Recent avg finish: <span style={{ color: "var(--text)" }}>{Number.isFinite(explainDriver.driver_recent_form) ? `P${explainDriver.driver_recent_form.toFixed(1)}` : "N/A"}</span>. Model output: <span style={{ color: "var(--red)" }}>{(explainDriver.podium_probability * 100).toFixed(1)}%</span> podium probability.
                      {isUpcoming ? null : explainDriver.podium === 1 ? <span style={{ color: "var(--green)" }}> ✓ Podiumed.</span> : <span style={{ color: "var(--muted)" }}> Did not podium.</span>}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && !offline && predictions.length === 0 && (
        <div style={{ textAlign: "center", padding: "5rem 0" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: "var(--muted)", letterSpacing: "0.2em" }}>SELECT A RACE TO RUN THE MODEL</div>
        </div>
      )}
    </div>
  );
};


export default PredictorPage;
