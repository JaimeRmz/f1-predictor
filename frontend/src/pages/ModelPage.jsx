import Panel from "../components/DashPanel.jsx";
import { BACKTEST_FULL } from "../lib/homeModel.js";
import "./home.css";

// ── MODEL ──────────────────────────────────────────────────────
// What the model is, and how well it actually does. The headline evidence is the winner-pick backtest below (static
// results of the Stage 1 backtest, not fetched): the model is compared with simple rules, before and after qualifying.
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
  { stage: "03", name: "Podium Model", type: "XGBClassifier", desc: "Gives every driver a raw model score for finishing in the top 3.", metricLabel: "ROC-AUC", metricValue: "0.945" },
];

const howItWorks = [
  ["Data", "15 years of F1 results (2010–2024) merged across 9 tables — results, qualifying, standings, constructors, circuits, drivers, status."],
  ["Features", "9 engineered features using rolling averages and exponential decay. All calculated from strictly pre-race data — no leakage from future results."],
  ["Training", "XGBoost trained on 2010–2024 (6,436 entries). Time-based split — 2025–2026 seasons held out for evaluation."],
  ["Target", "Binary classification: did the driver finish top 3? Outputs a raw model score from 0 to 1 per driver (a score, not a probability; Home shows it as a share of the field)."],
  ["Evaluation", "Tested on the 2025–2026 holdout. ROC-AUC 0.945, measured after correcting two data-leakage bugs in feature engineering — the circuit-history rate (see features above) and a same-race constructor-feature leak. The figure is computed on strictly pre-race inputs, so it reflects honest out-of-sample performance rather than an inflated in-sample score."],
];

const pct = (h, n) => Math.round((100 * h) / n);

const HitGroup = ({ g, n }) => (
  <div className="md-group">
    <div className="md-group-h"><b>{g.label}</b><span>{g.sub}</span></div>
    {g.rows.map((r) => (
      <div key={r.key} className={`md-hit${r.model ? " model" : ""}`}>
        <span>{r.label}</span>
        <div className="hm-rel-bar" aria-hidden="true"><i style={{ width: `${(100 * r.hits) / n}%` }} /><u style={{ left: `${r.ci[0] * 100}%`, width: `${(r.ci[1] - r.ci[0]) * 100}%` }} /></div>
        <b>{pct(r.hits, n)}%<small>{r.hits} of {n}</small></b>
      </div>
    ))}
  </div>
);

const ModelPage = () => {
  const n = BACKTEST_FULL.races;
  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">MACHINE LEARNING · 3-MODEL XGBOOST PIPELINE</div>
          <h1 className="wordfit">How the <em>model</em> works</h1>
        </div>
      </header>

      <Panel title="How good is it, honestly?" caption={`How often each method named the race winner over ${n} past races (2025–2026) the model had not seen. The thin range on each bar is the 95% range.`}>
        <div className="md-groups">
          <HitGroup g={BACKTEST_FULL.predicted} n={n} />
          <HitGroup g={BACKTEST_FULL.real} n={n} />
        </div>
        <p className="hm-note">
          Before qualifying the model names the winner in 9 of {n} races, against 12 of {n} for simply picking the points leader. The ranges overlap widely, so the model is not shown to be better.
          Given the real grid it reaches 26 of {n}, but picking the pole sitter does slightly better (29 of {n}). Most of what the model knows about a race comes from the starting grid.
        </p>
      </Panel>

      <div className="hm-grid">
        <div className="hm-main">
          <Panel title="The prediction pipeline" caption="Three models in a row: the predicted grid feeds the winner and podium models.">
            <div className="md-stages">
              {pipeline.map((m) => (
                <div key={m.stage} className="md-stage">
                  <div className="hm-eyebrow red">STAGE {m.stage}</div>
                  <h3>{m.name}</h3>
                  <small>{m.type}</small>
                  <p className="hm-note">{m.desc}</p>
                  <label className="gold">{m.metricLabel.toUpperCase()}</label>
                  <b>{m.metricValue}</b>
                </div>
              ))}
            </div>
            <p className="hm-note dim">ROC-AUC measures how well a model ranks drivers from most to least likely to succeed. It is not the share of winners picked (see the comparison above).</p>
          </Panel>

          <Panel title="What the podium model looks at" caption="The inputs, ranked by how much each one moves the model's score.">
            <div className="md-feats">
              {features.map((f, i) => (
                <div key={f.name} className="md-feat">
                  <div className="md-feat-h"><span>{f.name}</span><b className={i < 2 ? "red" : ""}>{f.pct}%</b></div>
                  <div className="hm-meter" aria-hidden="true"><i style={{ width: `${f.pct}%`, background: i < 2 ? "var(--red)" : "rgba(236,236,236,0.45)" }} /></div>
                  <p className="hm-note dim">{f.desc}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="hm-side">
          <Panel title="Podium model at a glance" caption="The headline numbers, measured on 2025–2026 races held out of training.">
            <div className="hm-tiles">
              {[["ALGORITHM", "XGBoost"], ["ROC-AUC", "0.945"], ["RECALL", "89%"], ["TRAINING", "6,436"]].map(([l, v]) => (
                <div key={l} className="hm-tile"><label>{l}</label><b>{v}</b></div>
              ))}
            </div>
            <p className="hm-note dim">Recall: share of actual podium finishers the model flagged. Training: race entries 2010–2024.</p>
          </Panel>

          <Panel title="Raw model score vs share" caption="How the numbers on Home are made.">
            <p className="hm-note">
              Each driver gets a raw model score for winning and for the podium, computed on their own. Raw scores are independent per driver, not shares of anything:
              across a field the win scores add up to about 3 and the podium scores to about 5, not to 1 and 3.
              Home therefore shows shares: a driver's raw win score divided by the field's total (so win shares add up to 100%), and the raw podium
              score divided by the field's total times 3 (podium shares add up to 300%, since three drivers finish on the podium).
              Shares describe relative strength inside one race's field, not a calibrated chance. The raw model score is available on tap or hover on every figure on Home.
              Drivers are ranked by raw podium score; shares never change the order.
            </p>
          </Panel>

          <Panel title="How it works" caption="Data, features, training and evaluation in five lines.">
            <div className="md-how">
              {howItWorks.map(([title, body]) => (
                <div key={title}><b>{title.toUpperCase()}</b><span>{body}</span></div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
};

export default ModelPage;
