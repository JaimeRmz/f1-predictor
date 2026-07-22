import { Fragment } from "react";
import { StatCard, SectionHeader } from "../shared.jsx";
import { card } from "../constants.js";

// ── MODEL PAGE ─────────────────────────────────────────────────
const ModelPage = () => {
  const features = [
    { name: "Grid Position",          pct: 44.3, desc: "Starting position. P1/P2 qualifiers podium ~75% of the time. The dominant predictor by a wide margin." },
    { name: "Recent Points (Last 5)", pct: 25.4, desc: "Sum of points scored in the driver's last 5 races (cross-season). Captures current form and corrects overestimation of drivers with strong historical records but recent underperformance." },
    { name: "Constructor Points",     pct: 5.1,  desc: "Team's season championship points — proxy for current car pace." },
    { name: "Constructor Form",       pct: 4.7,  desc: "Constructor's avg finish position over last 3 races." },
    { name: "Driver Points",          pct: 4.4,  desc: "Season-long consistency and relative car quality." },
    { name: "Driver Recent Form",     pct: 4.4,  desc: "Avg finish position over last 3 races. Captures driver momentum independently of points." },
    { name: "Constructor DNF Rate",   pct: 4.1,  desc: "Team reliability signal over last 10 races." },
    { name: "Driver DNF Rate",        pct: 3.9,  desc: "Driver reliability history over last 10 races." },
    { name: "Circuit Podium Rate",    pct: 3.9,  desc: "Exponentially decayed podium rate at this specific circuit (weight = 0.75^years_ago — each year further back counts 75% less). Was 42% importance in the original model; reduced to 3.9% after fixing a data leakage bug where the flat all-time average included test-set years, artificially inflating its predictive power." },
  ];

  const pipeline = [
    { stage: "01", name: "Qualifying Model", type: "XGBRegressor", desc: "Predicts each driver's grid position ahead of a race.", metricLabel: "Top-10 Accuracy", metricValue: "77.8%" },
    { stage: "02", name: "Winner Model", type: "XGBClassifier", desc: "Predicts who wins the race, using the predicted grid as input.", metricLabel: "ROC-AUC", metricValue: "0.972" },
    { stage: "03", name: "Podium Model", type: "XGBClassifier", desc: "Predicts every driver's odds of finishing in the top 3.", metricLabel: "ROC-AUC", metricValue: "0.945" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader eyebrow="Machine Learning · 3-Model Pipeline" title="The Prediction Pipeline" />

      <div style={{ display: "flex", alignItems: "stretch", gap: "0.4rem", flexWrap: "wrap" }}>
        {pipeline.map((m, i, arr) => (
          <Fragment key={m.stage}>
            <div className="card-lift stagger-item" style={{ ...card, "--i": i, padding: "1.25rem", flex: "1 1 220px", minWidth: "200px" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--red)", fontWeight: "700", letterSpacing: "0.15em" }}>STAGE {m.stage}</div>
              <div style={{ fontSize: "1rem", fontWeight: "900", fontStyle: "italic", textTransform: "uppercase", marginTop: "0.4rem" }}>{m.name}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.15rem" }}>{m.type}</div>
              <p style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", lineHeight: 1.6, margin: "0.75rem 0" }}>{m.desc}</p>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--gold)", letterSpacing: "0.1em", fontWeight: "700" }}>{m.metricLabel}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "1.15rem", color: "var(--text)", fontWeight: "700" }}>{m.metricValue}</div>
            </div>
            {i < arr.length - 1 && (
              <div className="hide-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", color: "var(--red)", flex: "0 0 auto", padding: "0 0.25rem" }}>→</div>
            )}
          </Fragment>
        ))}
      </div>
      <div style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", opacity: 0.75 }}>
        For upcoming races, the qualifying model's predicted grid feeds directly into the winner and podium models.
      </div>

      <SectionHeader eyebrow="Machine Learning · XGBoost Classifier" title="Podium Model Documentation" />

      <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatCard label="Algorithm" value="XGBoost" accent="var(--red)" sub="gradient boosted trees" />
        <StatCard label="ROC-AUC" value="0.945" accent="var(--red)" sub="2025–2026 test set" />
        <StatCard label="Recall" value="89%" sub="podiums caught" />
        <StatCard label="Training" value="6,436" sub="race entries 2010–2024" />
      </div>

      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "2px" }}>
          <span className="section-label">Podium Model Features</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)" }}>The qualifying and winner models draw on a similar feature set.</span>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {features.map((f, i) => (
            <div key={i} className="stagger-item" style={{ "--i": i }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em" }}>{f.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", fontWeight: "700", color: i < 2 ? "var(--red)" : "var(--muted)" }}>{f.pct}%</span>
              </div>
              <div style={{ height: "3px", background: "var(--dimmed)", marginBottom: "5px", overflow: "hidden" }}>
                <div className="prob-bar" style={{ height: "100%", width: `${f.pct}%`, background: i < 2 ? "var(--red)" : i < 4 ? "rgba(225,6,0,0.4)" : "var(--dimmed)" }} />
              </div>
              <p style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-enter" style={{ ...card }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <span className="section-label">How It Works</span>
        </div>
        <div style={{ padding: "1rem" }}>
          {[
            ["Data", "15 years of F1 results (2010–2024) merged across 9 tables — results, qualifying, standings, constructors, circuits, drivers, status."],
            ["Features", "9 engineered features using rolling averages and exponential decay. All calculated from strictly pre-race data — no leakage from future results."],
            ["Training", "XGBoost trained on 2010–2024 (6,436 entries). Time-based split — 2025–2026 seasons held out for evaluation."],
            ["Target", "Binary classification: did the driver finish top 3? Outputs 0–100% podium probability."],
            ["Evaluation", "Tested on the 2025–2026 holdout. ROC-AUC 0.945, measured after correcting two data-leakage bugs in feature engineering — the circuit-history rate (see features above) and a same-race constructor-feature leak. The figure is computed on strictly pre-race inputs, so it reflects honest out-of-sample performance rather than an inflated in-sample score."],
          ].map(([title, body], i, arr) => (
            <div key={i} style={{ display: "flex", gap: "1.25rem", padding: "0.75rem 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.65rem", fontWeight: "700", flexShrink: 0, width: "70px", paddingTop: "1px", letterSpacing: "0.05em" }}>{title.toUpperCase()}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.8 }}>{body}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


export default ModelPage;
