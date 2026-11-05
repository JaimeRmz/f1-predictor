// node analysis/26_projected_draw_tune.mjs   -- tune the rank-anchored draw directly on the production code, with the Brazil model scores
// (saved from the LOCAL backend), 6,000 seeds per evaluation, local random search over the 11 parameters.
// Priorities, in order: (1) the model's rank-1 driver wins 25-30% of seeds (aim 26%; real backtest 23%); (2) a bottom-half driver in the
// top 5 stays within ~4% per driver / ~38% of seeds (hinge: no pressure to go lower); (3) the best-finish ceilings (in the draw) and a mean
// finishing position that never improves as the model rank gets worse. Then closeness to the real backtest profile (podium / top-5 rates by
// rank bucket, median miss). Writes analysis/out/projected_draw_tuned.json.
import fs from "node:fs";
import { rankAnchoredOrder, modelRanking, mulberry32 } from "../frontend/src/lib/projectedRace.js";
const rows = JSON.parse(fs.readFileSync("analysis/proj/rows_interlagos.json", "utf8"));
const code = (n) => (n.trim().split(/\s+/).pop() || "").slice(0, 3).toUpperCase();
const codes = rows.map((r) => code(r.driver_name)), scores = Object.fromEntries(rows.map((r) => [code(r.driver_name), { win: r.win_probability, podium: r.podium_probability }]));
const N = codes.length, rank = modelRanking(codes, scores), rankOf = new Array(N); rank.forEach((i, r) => { rankOf[i] = r + 1; });
const REAL_POD = [0.674, 0.465, 0.388, 0.035, 0.019, 0], REAL_T5 = [0.837, 0.674, 0.682, 0.11, 0.056, 0.01], REAL_MED = [2, 1.5, 2, 3, 3, 3];
const bucketOf = (r) => (r === 1 ? 0 : r <= 3 ? 1 : r <= 6 ? 2 : r <= 10 ? 3 : r <= 15 ? 4 : 5);
const SEEDS = 6000;

const evaluate = (params, seeds = SEEDS, verbose = false) => {
  const mean = new Array(N).fill(0), pod = new Array(6).fill(0), t5 = new Array(6).fill(0), cnt = new Array(6).fill(0), errs = [[], [], [], [], [], []];
  let win1 = 0, bhSeeds = 0, bhDrv = 0, wins7 = 0, far = 0; const winBy = new Array(N).fill(0);
  for (let s = 1; s <= seeds; s++) {
    const o = rankAnchoredOrder(codes, scores, mulberry32(s * 7919 + 13), params), pos = new Array(N);
    o.forEach((i, p) => { pos[i] = p + 1; });
    let bh = 0;
    for (let i = 0; i < N; i++) {
      const r = rankOf[i], b = bucketOf(r);
      mean[r - 1] += pos[i]; cnt[b]++; if (pos[i] <= 3) pod[b]++; if (pos[i] <= 5) t5[b]++; errs[b].push(Math.abs(pos[i] - r));
      if (r > N / 2 && pos[i] <= 5) { bh++; bhDrv++; }
      if (r >= 7 && pos[i] === 1) wins7++;
      if (pos[i] === 1) winBy[r - 1]++;
      if (r >= 7 && r <= 10 && pos[i] >= 17) far++;
    }
    if (pos[rank[0]] === 1) win1++;
    if (bh) bhSeeds++;
  }
  const m = mean.map((v) => v / seeds), pw = win1 / seeds, bd = bhDrv / seeds / Math.floor(N / 2), bs = bhSeeds / seeds, w7 = wins7 / seeds;
  let loss = ((pw - 0.262) / 0.006) ** 2;                                            // (1)
  loss += (Math.max(0, bd - 0.037) / 0.003) ** 2 + (Math.max(0, bs - 0.36) / 0.02) ** 2;      // (2)
  for (let i = 1; i < N; i++) loss += (Math.max(0, m[i - 1] - m[i] - 0.05) / 0.08) ** 2;       // (3) monotone mean finish
  loss += (Math.max(0, w7 - 0.012) / 0.003) ** 2;                                    // ranks 7+ almost never win
  for (let r = 0; r < 5; r++) loss += (Math.max(0, winBy[r + 1] - winBy[r] + seeds * (r === 0 ? 0.025 : 0.008)) / seeds / 0.008) ** 2;       // win frequency must not rise down the top six
  loss += ((far / seeds / 4 - 0.17) / 0.08) ** 2;                                              // real: 7th-10th ranked finishes 17th or worse 17% of the time
  const med = errs.map((e) => e.sort((a, b) => a - b)[e.length >> 1]);
  for (let b = 0; b < 6; b++) loss += ((pod[b] / cnt[b] - REAL_POD[b]) / 0.06) ** 2 + ((t5[b] / cnt[b] - REAL_T5[b]) / 0.08) ** 2 + ((med[b] - REAL_MED[b]) / 1.2) ** 2;
  if (verbose) console.log({ winByRank: winBy.slice(0, 7).map((v) => (v / seeds).toFixed(3)).join(' '), far7to10: (far / seeds / 4).toFixed(3), rank1Win: pw.toFixed(3), bhPerDriver: bd.toFixed(3), bhPerSeed: bs.toFixed(3), wins7plus: w7.toFixed(4), meanPos: m.map((v) => v.toFixed(1)).join(" "), pod: pod.map((v, b) => (v / cnt[b]).toFixed(3)).join(" "), t5: t5.map((v, b) => (v / cnt[b]).toFixed(3)).join(" "), med: med.join(" ") });
  return loss;
};

const flat = (p) => [...p.wobble, ...p.upsetProb, p.upsetSize];
const unflat = (v) => ({ wobble: v.slice(0, 6).map((x) => Math.max(0.2, x)), upsetProb: v.slice(6, 10).map((x) => Math.min(0.95, Math.max(0, x))), upsetSize: Math.max(1, v[10]) });
const start = JSON.parse(fs.readFileSync("analysis/out/projected_draw_fit.json", "utf8"));
let best = flat({ wobble: start.wobble_sd, upsetProb: start.upset_prob, upsetSize: start.upset_sd }), bestL = evaluate(unflat(best));
console.log("start loss", bestL.toFixed(1));
let step = 0.35, rnd = mulberry32(2024);
for (let it = 0; it < 420; it++) {
  const cand = best.map((x, i) => x + (i >= 6 && i < 10 ? 0.05 : 1) * step * (rnd() + rnd() + rnd() - 1.5) * 1.6);
  const L = evaluate(unflat(cand));
  if (L < bestL) { best = cand; bestL = L; }
  if (it % 60 === 59) { step *= 0.7; console.log("iter", it + 1, "loss", bestL.toFixed(1)); }
}
const tuned = unflat(best);
console.log("tuned", JSON.stringify(tuned));
evaluate(tuned, 10000, true);
fs.writeFileSync("analysis/out/projected_draw_tuned.json", JSON.stringify(tuned, null, 1));
