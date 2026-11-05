import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from "recharts";
import { CustomTooltip, RaceSelector, BackendPanel, SkeletonList } from "../shared.jsx";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TelemetryTraces } from "../components/TelemetryTraces.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import ScoreFigure from "../components/ScoreFigure.jsx";
import Panel from "../components/DashPanel.jsx";
import { API, UPCOMING_RACES_2026, UPCOMING_IDS, STANDINGS_GRID_2026 } from "../constants.js";
import { TEAMS } from "../teams.js";
import { rowsWithShares, pctLabel, teamColor, titleParts, score } from "../lib/homeModel.js";
import "./home.css";

// ── RACE · PREDICTOR ───────────────────────────────────────────
// Run the model on any race: upcoming rounds use the predicted grid (/whatif), completed ones the real grid (/predict).
// Same display language as Home: shares of the field with the raw model score on tap or hover. Rows keep the API order.
const featureLabels = {
  grid: "Grid Position", driver_season_points: "Driver Points",
  constructor_season_points: "Constructor Points", driver_circuit_podium_rate: "Circuit Win Rate",
  driver_recent_form: "Recent Form", constructor_recent_form: "Team Form", driver_dnf_rate: "DNF Rate",
};
const featureMax = { grid: 20, driver_season_points: 400, constructor_season_points: 700, driver_circuit_podium_rate: 1, driver_recent_form: 20, constructor_recent_form: 20, driver_dnf_rate: 1 };
const TABS = [["drivers", "TABLE"], ["chart", "CHARTS"], ["explainer", "EXPLAIN A DRIVER"]];

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
    axios.get(`${API}/races`).then((r) => setRaces(r.data)).catch(() => setOffline(true));
  }, []);

  const retry = () => {
    setOffline(false);
    axios.get(`${API}/races`).then((r) => setRaces(r.data)).catch(() => setOffline(true));
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
        const race = UPCOMING_RACES_2026.find((r) => String(r.raceId) === id);
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

  const rows = rowsWithShares(predictions);
  const podiums = predictions.filter((p) => p.podium === 1);
  const gridRows = isUpcoming ? [...rows].sort((a, b) => a.grid - b.grid) : rows;
  const podiumsCaught = podiums.filter((p) => p.podium_probability > 0.5).length;
  const accuracy = !isUpcoming && podiums.length > 0 ? Math.round((podiumsCaught / podiums.length) * 100) : null;

  // Winner-first framing: the predicted winner is whoever the win model ranks highest, which is not always the driver
  // the podium model ranks #1.
  const predictedWinner = rows.length > 0 ? [...rows].sort((a, b) => (b.win ?? 0) - (a.win ?? 0))[0] : null;
  const actualWinner = !isUpcoming ? predictions.find((p) => p.positionOrder === 1) : null;
  const winnerCorrect = !isUpcoming && predictedWinner && actualWinner ? predictedWinner.driverRef === actualWinner.driverRef : null;
  const podiumFavorites = predictions.filter((p) => p.podium_probability > 0.6).length;
  const predictedPole = gridRows[0];
  // The selector's label is "2026 Rd 20 — Brazilian Grand Prix (Nov 8)" or "2025 — Name"; keep just the race name.
  const raceName = (selectedRaceName || "").replace(/^\d{4}( Rd \d+)? — /, "").replace(/ \([A-Z][a-z]{2} \d+\)$/, "");
  const { base, suffix } = titleParts(raceName);
  const explainRow = explainDriver ? rows.find((r) => r.driverRef === explainDriver.driverRef) : null;

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">{selectedRaceName ? (isUpcoming ? "PRE-QUALIFYING PREDICTION · USES THE PREDICTED GRID" : "MODEL REPLAY WITH THE REAL GRID · NOT A FORECAST") : "RACE PREDICTOR · ANY RACE, PAST OR UPCOMING"}</div>
          <h1 className="wordfit">{selectedRaceName ? <>{base}{raceName !== base ? <> <em>Grand Prix</em></> : null}{suffix && <span> {suffix}</span>}</> : <>Race <em>predictor</em></>}</h1>
        </div>
      </header>

      <Panel title="Choose a Grand Prix" caption="Pick any past or upcoming race to run the model on it.">
        <RaceSelector upcoming={UPCOMING_RACES_2026} completed={races} value={selectedRaceId} onSelect={predict} />
      </Panel>

      {offline && <BackendPanel detail="The race list or prediction request failed." onRetry={retry} />}
      {loading && <SkeletonList rows={8} metrics={2} />}

      {!loading && rows.length > 0 && (
        <>
          <Panel title="Summary" caption={isUpcoming ? "The model's headline picks for this race before qualifying." : "How the model's picks compared with the real result."}>
            <div className="hm-tiles">
              <div className="hm-tile">
                <label className="teal">PREDICTED WINNER</label>
                <b className="pr-name">{predictedWinner && <TeamMark team={predictedWinner.teamId} size={22} />} {predictedWinner ? predictedWinner.driver_name.split(" ").pop() : "—"}</b>
                <small>{predictedWinner ? `${pctLabel(predictedWinner.winPct, predictedWinner.winShare)} win share` : ""}</small>
              </div>
              {isUpcoming ? (
                <>
                  <div className="hm-tile"><label>PODIUM FAVORITES</label><b>{podiumFavorites} drivers</b><small>podium score above 0.6</small></div>
                  <div className="hm-tile"><label className="teal">PREDICTED POLE</label><b className="pr-name">{predictedPole && <TeamMark team={predictedPole.teamId} size={22} />} {predictedPole?.driver_name.split(" ").pop() ?? "—"}</b></div>
                </>
              ) : (
                <>
                  <div className="hm-tile"><label>WINNER CORRECT?</label><b className={winnerCorrect ? "green" : winnerCorrect === false ? "red" : ""}>{winnerCorrect === null ? "—" : winnerCorrect ? "✓ yes" : "✗ no"}</b></div>
                  <div className="hm-tile"><label>PODIUMS CAUGHT</label><b>{accuracy !== null ? `${podiumsCaught}/${podiums.length}` : "—"}</b><small>{accuracy !== null ? `${accuracy}% of the real podium` : ""}</small></div>
                  <div className="hm-tile"><label>HIGH MODEL SCORE</label><b>{predictions.filter((p) => p.podium_probability > 0.5).length}</b><small>drivers flagged</small></div>
                </>
              )}
            </div>
          </Panel>

          {isUpcoming && (
            <Panel title="Predicted qualifying" caption="Order from the qualifying model (XGBoost regressor). It updates after real qualifying.">
              <ol className="hm-grid-list pr-cols">
                {gridRows.map((r) => (
                  <li key={r.driverRef} style={{ "--team": teamColor(r.teamId) }}>
                    <b>P{r.grid}</b><i className="hm-bar" /><TeamMark team={r.teamId} size={20} /><span>{r.code}</span><em>{r.driver_name}</em>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <div className="sub-nav wide2" role="group" aria-label="Predictor views">
            {TABS.map(([k, label]) => <button key={k} type="button" className="sub-tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
          </div>

          {tab === "drivers" && (
            <Panel title="Every driver" caption={`${isUpcoming ? "Pre-qualifying" : "Replay"} shares of this race's field, not a calibrated chance. Win shares add up to 100%. Tap or hover a figure for the raw model score.`}>
              <div className="pr-tbl" role="table" aria-label="All drivers">
                <div className="pr-tr pr-th" role="row"><span>POS</span><span /><span>DRIVER</span><span className="gold">WIN SHARE</span><span className="teal">PODIUM SHARE</span><span className="hm-hide-m" /></div>
                {rows.map((r) => (
                  <div className="pr-tr" role="row" key={r.driverRef} style={{ "--team": teamColor(r.teamId) }}>
                    <span className="hm-n">{r.pos}</span>
                    <span className="hm-tm"><i className="hm-bar" /><TeamMark team={r.teamId} size={22} /></span>
                    <span className="hm-drv"><b>{r.code}</b><span> {r.driver_name}</span>
                      <small>{isUpcoming ? `QUALI P${r.grid} · PRED P${r.pos}` : `GRID P${r.grid} · FIN P${r.positionOrder}`}{r.podium === 1 && <em className="green"> ✓ PODIUM</em>}</small></span>
                    <span className="gold hm-v"><ScoreFigure raw={r.win}>{pctLabel(r.winPct, r.winShare)}</ScoreFigure></span>
                    <span className="teal hm-v"><ScoreFigure raw={r.podium}>{pctLabel(r.podiumPct, r.podiumShare)}</ScoreFigure></span>
                    <button type="button" className="pr-explain" onClick={() => { setExplainDriver(r); setTab("explainer"); }} aria-label={`Explain ${r.driver_name}`}><span className="hm-hide-m">EXPLAIN </span>→</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {tab === "chart" && (
            <div className="hm-pair">
              <Panel title="Podium model score by driver" caption="Raw model score from 0 to 1. Red is the top pick; green finished on the podium.">
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={predictions} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" horizontal={false} />
                    <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.66)", fontSize: 10, fontFamily: "var(--mono)" }} />
                    <YAxis type="category" dataKey="driver_name" width={130} stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.66)", fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(225,6,0,0.04)" }} />
                    <Bar dataKey="podium_probability" name="Podium model score" radius={0}>
                      {predictions.map((p, i) => <Cell key={i} fill={p.podium === 1 ? "#00c853" : i === 0 ? "#e10600" : i < 3 ? "#ff4422" : "#2a2a38"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Predicted rank vs actual finish" caption={isUpcoming ? "The race has not happened yet, so only the predicted rank is drawn." : "Where the model ranked each driver and where they finished (lower is better)."}>
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={predictions.map((p, i) => ({ name: p.driver_name.split(" ").pop(), predicted: i + 1, actual: p.positionOrder }))}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--dimmed)" />
                    <XAxis dataKey="name" stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.66)", fontSize: 10 }} />
                    <YAxis reversed stroke="var(--dimmed)" tick={{ fill: "rgba(236,236,236,0.66)", fontSize: 10, fontFamily: "var(--mono)" }} domain={[1, 20]} />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0px", fontSize: "0.72rem", fontFamily: "var(--mono)" }} />
                    <Legend wrapperStyle={{ fontSize: "0.7rem", fontFamily: "var(--mono)" }} />
                    <Line type="monotone" dataKey="predicted" stroke="#e10600" strokeWidth={2} dot={{ r: 3, fill: "#e10600" }} name="Model" />
                    <Line type="monotone" dataKey="actual" stroke="#00c853" strokeWidth={2} dot={{ r: 3, fill: "#00c853" }} name="Actual" strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          )}

          {tab === "explainer" && (
            !explainRow ? (
              <Panel title="Explain a driver" caption="Why the model scored one driver the way it did."><p className="hm-note">Pick a driver with the EXPLAIN button in the table.</p></Panel>
            ) : (
              <div className="hm-grid">
                <div className="hm-main">
                  <GlassPanel tint={teamColor(explainRow.teamId)} className="hm-panel" tilt={false} style={{ padding: "1.2rem 1.4rem", "--team": teamColor(explainRow.teamId) }}>
                    <div className="dr-head">
                      <div>
                        <div className="hm-eyebrow">PREDICTION BREAKDOWN{explainRow.teamId ? ` · ${TEAMS[explainRow.teamId].name.toUpperCase()}` : ""}</div>
                        <h2 className="dr-name">{explainRow.driver_name}</h2>
                        <p className="hm-note">Podium model score {score(explainRow.podium)}, a {pctLabel(explainRow.podiumPct, explainRow.podiumShare)} podium share of the field.</p>
                      </div>
                      {explainRow.teamId && <TeamMark team={explainRow.teamId} size={40} />}
                    </div>
                  </GlassPanel>
                  <Panel title="Plain-English summary" caption="The same inputs, in a sentence.">
                    <p className="hm-note">
                      <span className="pr-ink">{explainRow.driver_name}</span> started from grid <span className="pr-ink">P{explainRow.grid ?? "N/A"}</span>, entered with <span className="pr-ink">{Number.isFinite(explainRow.driver_season_points) ? explainRow.driver_season_points.toFixed(0) : "N/A"} pts</span>, and has {Number.isFinite(explainRow.driver_circuit_podium_rate) && explainRow.driver_circuit_podium_rate > 0
                        ? <>a <span className="pr-ink">{(explainRow.driver_circuit_podium_rate * 100).toFixed(0)}%</span> podium rate</>
                        : "no podium history"} at this circuit. Recent avg finish: <span className="pr-ink">{Number.isFinite(explainRow.driver_recent_form) ? `P${explainRow.driver_recent_form.toFixed(1)}` : "N/A"}</span>.
                      {" "}Model output: <span className="pr-red">{score(explainRow.podium)}</span> podium model score.
                      {isUpcoming ? null : explainRow.podium === 1 ? <span className="green"> ✓ Podiumed.</span> : <span> Did not podium.</span>}
                    </p>
                  </Panel>
                </div>
                <aside className="hm-side">
                  <Panel title="Feature breakdown" caption="The inputs behind this driver's score. Green is favourable, red is not.">
                    <div className="md-feats">
                      {Object.entries(featureLabels).map(([key, label]) => {
                        const val = explainRow[key];
                        const max = featureMax[key];
                        const width = Math.min((val / max) * 100, 100);
                        const isGood = key === "grid" ? val <= 3 : key.includes("dnf") ? val < 0.1 : key.includes("form") ? val < 6 : val > max * 0.3;
                        return (
                          <div key={key} className="md-feat">
                            <div className="md-feat-h"><span>{label}</span><b style={{ color: isGood ? "var(--green)" : "#ff6b61" }}>{key.includes("rate") || key.includes("dnf") ? `${(val * 100).toFixed(0)}%` : Number.isFinite(val) ? val.toFixed(1) : "—"}</b></div>
                            <div className="hm-meter" aria-hidden="true"><i style={{ width: `${Number.isFinite(width) ? width : 0}%`, background: isGood ? "var(--green)" : "var(--red)" }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                </aside>
              </div>
            )
          )}
        </>
      )}

      {!loading && !offline && rows.length === 0 && (
        <GlassPanel style={{ position: "relative", padding: "4rem 2rem", minHeight: "260px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", textAlign: "center" }}>
          <span style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", zIndex: 0 }}><TelemetryTraces opacity={0.2} /></span>
          <span style={{ position: "relative", zIndex: 2, width: "8px", height: "8px", borderRadius: "50%", background: "var(--red)", animation: "pulse 1.6s ease-in-out infinite" }} />
          <p className="hm-note" style={{ position: "relative", zIndex: 2, margin: 0, letterSpacing: "0.16em" }}>SELECT A RACE TO RUN THE MODEL</p>
        </GlassPanel>
      )}
    </div>
  );
};

export default PredictorPage;
