// node analysis/25_projected_draw_compare.mjs   -- OLD draw (Plackett-Luce + floor) vs NEW (rank-anchored) on the real model scores
// for Brazil and Las Vegas (rows saved from the LOCAL backend POST /whatif), 10,000 seeds each. Compares with the real backtest profile.
import fs from "node:fs";
import { rankAnchoredOrder, modelRanking, mulberry32 } from "../frontend/src/lib/projectedRace.js";
const SEEDS = 10000;
// the old draw, verbatim from the first version of projectedRace.js
const oldWeights = (codes, scores) => {
  const win = codes.map((c) => Math.max(0, scores[c].win ?? 0)), pod = codes.map((c) => Math.max(0, scores[c].podium));
  const sw = win.reduce((a, b) => a + b, 0) || 1, sp = pod.reduce((a, b) => a + b, 0) || 1;
  return codes.map((_, i) => 0.5 * (win[i] / sw) + 0.5 * (pod[i] / sp) + 0.25 / codes.length);
};
const plackettLuce = (weights, rnd) => {
  const left = weights.map((w, i) => i), out = [];
  while (left.length) {
    const tot = left.reduce((a, i) => a + weights[i], 0);
    let u = rnd() * tot, pick = left.length - 1;
    for (let k = 0; k < left.length; k++) { u -= weights[left[k]]; if (u <= 0) { pick = k; break; } }
    out.push(left[pick]); left.splice(pick, 1);
  }
  return out;
};
const oldOrder = (codes, scores, rnd) => plackettLuce(oldWeights(codes, scores), rnd);
const real = JSON.parse(fs.readFileSync("analysis/out/projected_draw_profile.json", "utf8")).finishers;
const code = (n) => (n.trim().split(/\s+/).pop() || "").slice(0, 3).toUpperCase();
const pct = (x) => (100 * x).toFixed(1).padStart(5) + "%";
const out = [];
const say = (s = "") => { console.log(s); out.push(s); };

for (const [ref, label] of [["interlagos", "BRAZIL"], ["vegas", "LAS VEGAS"]]) {
  const rows = JSON.parse(fs.readFileSync(`analysis/proj/rows_${ref}.json`, "utf8"));
  const codes = rows.map((r) => code(r.driver_name)), scores = Object.fromEntries(rows.map((r) => [code(r.driver_name), { win: r.win_probability, podium: r.podium_probability }]));
  const rank = modelRanking(codes, scores), rankOf = new Array(codes.length); rank.forEach((i, r) => { rankOf[i] = r + 1; });
  const N = codes.length, half = N / 2;
  say(`\n===== ${label}  (${N} drivers, ${SEEDS} seeds each) =====`);
  const stats = {};
  for (const [name, draw] of [["OLD", oldOrder], ["NEW", rankAnchoredOrder]]) {
    const win = new Array(N).fill(0), pod = new Array(N).fill(0), sum = new Array(N).fill(0), top5 = new Array(N).fill(0);
    let overlap = 0, bhSeeds = 0, bhDrivers = 0, bhCount = 0, rank1win = 0, farDrop = 0, farRise = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const o = draw(codes, scores, mulberry32(s)), pos = new Array(N);
      o.forEach((i, p) => { pos[i] = p + 1; });
      let bh = 0;
      for (let i = 0; i < N; i++) {
        sum[i] += pos[i]; if (pos[i] === 1) win[i]++; if (pos[i] <= 3) pod[i]++; if (pos[i] <= 5) top5[i]++;
        if (rankOf[i] > half && pos[i] <= 5) { bh++; bhDrivers++; }
        if (rankOf[i] >= 7 && rankOf[i] <= 10 && pos[i] >= 17) farDrop++;
        if (rankOf[i] >= 8 && pos[i] <= 3) farRise++;
      }
      if (bh) bhSeeds++;
      overlap += rank.slice(0, 3).filter((i) => pos[i] <= 3).length;
      if (pos[rank[0]] === 1) rank1win++;
    }
    stats[name] = { win, pod, sum, overlap: overlap / SEEDS, bhSeeds: bhSeeds / SEEDS, bhDriver: bhDrivers / SEEDS / Math.floor(N / 2), rank1win: rank1win / SEEDS, farDrop: farDrop / SEEDS / 4, farRise: farRise / SEEDS };
  }
  say("model rank  driver   |  win freq OLD  NEW | podium freq OLD  NEW | mean position OLD  NEW");
  rank.forEach((i, r) => {
    const o = stats.OLD, n = stats.NEW;
    say(`   ${String(r + 1).padStart(2)}      ${codes[i].padEnd(5)}     |   ${pct(o.win[i] / SEEDS)} ${pct(n.win[i] / SEEDS)}  |   ${pct(o.pod[i] / SEEDS)} ${pct(n.pod[i] / SEEDS)}   |   ${(o.sum[i] / SEEDS).toFixed(1).padStart(5)} ${(n.sum[i] / SEEDS).toFixed(1).padStart(5)}`);
  });
  say(`top-3 overlap with the model's top 3 (mean of 3):  OLD ${stats.OLD.overlap.toFixed(2)}  NEW ${stats.NEW.overlap.toFixed(2)}   real backtest ${real.top3_overlap_mean}`);
  say(`model's rank-1 driver wins:                         OLD ${pct(stats.OLD.rank1win)}  NEW ${pct(stats.NEW.rank1win)}   real backtest ${pct(real.model_rank1_wins)}`);
  say(`(c) a model-bottom-half driver finishes in the top 5:`);
  say(`      share of seeds with at least one:   OLD ${pct(stats.OLD.bhSeeds)}  NEW ${pct(stats.NEW.bhSeeds)}   real backtest ${pct(real.races_with_a_bottom_half_driver_in_top5)}`);
  say(`      per bottom-half driver:             OLD ${pct(stats.OLD.bhDriver)}  NEW ${pct(stats.NEW.bhDriver)}   real backtest ${pct(real.bottom_half_in_top5_rate_per_driver)}`);
  say(`      a driver ranked 7-10 finishes 17th or worse (per driver):  OLD ${pct(stats.OLD.farDrop)}  NEW ${pct(stats.NEW.farDrop)}`);
  say(`      a driver ranked 8th or lower finishes on the podium (share of seeds): OLD ${pct(stats.OLD.farRise)}  NEW ${pct(stats.NEW.farRise)}`);
  say(`(d) six finishing orders from the NEW method (seeds 1-6, not picked):`);
  for (let s = 1; s <= 6; s++) say(`   seed ${s}: ` + rankAnchoredOrder(codes, scores, mulberry32(s)).map((i) => codes[i]).join(" "));
  say(`   model ranking:  ` + rank.map((i) => codes[i]).join(" "));
}
fs.writeFileSync("analysis/out/projected_draw_compare.txt", out.join("\n"));
