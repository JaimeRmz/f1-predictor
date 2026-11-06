// node src/lib/run-test.mjs   (run from frontend/)
import assert from "node:assert/strict";
import { generateProjectedRace, rankAnchoredOrder, modelRanking, mulberry32, drawnOrder, typicalSeed, DEFAULT_SEED } from "./projectedRace.js";
import { rankRows, driverCode } from "./homeModel.js";
import { ROWS } from "./projectedFixtures.mjs";
import { decodeReplay, decodeDelta, boardAt, lapAt } from "./replay.js";
import { inputsFromRows } from "./projectedInputs.js";

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (got, want, msg) => { assert.deepEqual(got, want, msg); n++; };

// ── a synthetic "stadium" circuit: two 1200 m straights joined by two semicircles (about 3.7 km), start line on the bottom straight,
// pit lane 25 m outside it. Same pack layout as scripts/build_circuit_packs.py writes (decimetres, delta-encoded).
const delta = (a) => a.map((v, i) => Math.round(v) - (i ? Math.round(a[i - 1]) : 0));
const stadium = (laps = 30) => {
  const S = 1200, R = 200, per = 2 * S + 2 * Math.PI * R, V = 420, xs = [], ys = [];
  const at = (s) => {                                   // s metres along the lap from the line at (-300, 0)
    s = ((s % per) + per) % per;
    const bottomLeft = 600 - 300;                       // distance from (-300,0) to the end of the bottom straight at x=600 -> 900
    if (s < 900) return [-300 + s, 0];
    s -= 900;
    if (s < Math.PI * R) { const a = -Math.PI / 2 + s / R; return [600 + R * Math.cos(a), R + R * Math.sin(a)]; }
    s -= Math.PI * R;
    if (s < S) return [600 - s, 2 * R];
    s -= S;
    if (s < Math.PI * R) { const a = Math.PI / 2 + s / R; return [-600 + R * Math.cos(a), R + R * Math.sin(a)]; }
    s -= Math.PI * R;
    return [-600 + s, 0];                               // last 300 m of the bottom straight, up to the line
  };
  for (let i = 0; i < V; i++) { const p = at((i * per) / V); xs.push(p[0] * 10); ys.push(p[1] * 10); }
  const px = [], py = [];
  for (let x = -350; x <= 150; x += 25) { px.push(x * 10); py.push(-250); }
  return {
    v: 1, circuitRef: "stadium", source: { raceId: 0, year: 2025, name: "Test Grand Prix" }, laps, length_m: Math.round(per),
    outline: { x: delta(xs), y: delta(ys) }, sf: { x: -3000, y: 0, dx: 10, dy: 0 },
    pit: { x: delta(px), y: delta(py), enter: Math.round(V * (1 - 50 / per)), exit: Math.round((V * 450) / per), length_m: 500, lane_s: 26, stop_s: 2.5 },
    license: "test", lap_s: 68, lap_fast_s: 67, pit_loss_s: 20, stops: { counts: { 1: 7, 2: 3 }, first: [0.2, 0.35, 0.5], second: [0.55, 0.68, 0.8] },
  };
};
const CODES = "AAA BBB CCC DDD EEE FFF GGG HHH III JJJ KKK LLL MMM NNN OOO PPP QQQ RRR SSS TTT".split(" ");
const grid = CODES.map((c, i) => ({ code: c, name: `Driver ${c}`, team: `Team ${i >> 1}`, colour: "ffffff" }));
const scoresOf = (list = CODES) => Object.fromEntries(list.map((c, i) => [c, { win: Math.max(0, 0.3 - i * 0.02), podium: Math.max(0.01, 0.6 - i * 0.03) }]));
const pack = stadium(30);

// ── helpers that read a generated race back like a stranger would (positions only)
const track = (j, c) => ({ x: decodeDelta(j.pos[c].x), y: decodeDelta(j.pos[c].y) });
const crossings = (j, c, sf) => {                       // forward crossings of the start line within 60 m of it
  const { x, y } = track(j, c);
  let k = 0, prev = (x[0] - sf.x) * sf.dx + (y[0] - sf.y) * sf.dy;
  for (let i = 1; i < x.length; i++) {
    const cur = (x[i] - sf.x) * sf.dx + (y[i] - sf.y) * sf.dy, lat = Math.abs(-(x[i] - sf.x) * sf.dy + (y[i] - sf.y) * sf.dx) / Math.hypot(sf.dx, sf.dy);
    if (prev < 0 && cur >= 0 && lat < 600) k++;
    prev = cur;
  }
  return k;
};
const distToPath = (px, py, path) => {
  let best = Infinity;
  for (let i = 1; i < path.x.length; i++) {
    const ax = path.x[i - 1], ay = path.y[i - 1], bx = path.x[i], by = path.y[i], dx = bx - ax, dy = by - ay;
    const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (ax + u * dx), py - (ay + u * dy)));
  }
  return best;
};

// ── the draw: rank-anchored, noise set from the model's real backtest errors
const brazil = ["ANT", "VER", "RUS", "LEC", "HAM", "NOR", "HAD", "PIA", "HUL", "LAW", "LIN", "BOR", "GAS", "COL", "BEA", "ALO", "SAI", "ALB", "STR", "BOT", "PER"];
const brazilScores = Object.fromEntries(brazil.map((c, i) => [c, { win: [0.958, 0.762, 0.091, 0.484, 0.571, 0.044, 0.054, 0.009, 0.001, 0.009, 0.002][i] ?? 0, podium: [0.958, 0.917, 0.905, 0.871, 0.693, 0.442, 0.162, 0.107, 0.065, 0.053, 0.025, 0.025, 0.021, 0.009, 0.003, 0.002, 0.002, 0.001, 0, 0, 0][i] }]));
eq(modelRanking(["B", "A", "C"], { A: { win: 0.2, podium: 0.9 }, B: { win: 0.1, podium: 0.5 }, C: { win: 0.8, podium: 0.4 } }), [2, 1, 0], "the highest win score takes P1, the rest follow by podium score");
eq(modelRanking(["B", "A"], { A: { win: 0, podium: 0.5 }, B: { win: 0, podium: 0.5 } }), [0, 1], "full ties keep the given order");
eq(rankAnchoredOrder(brazil, brazilScores, mulberry32(1)).slice().sort((x, y) => x - y), brazil.map((_, i) => i), "a draw is a permutation");
eq(rankAnchoredOrder(brazil, brazilScores, mulberry32(9)), rankAnchoredOrder(brazil, brazilScores, mulberry32(9)), "the draw is deterministic per seed");
{
  const R = 6000, rnd = mulberry32(7), wins = new Array(21).fill(0), podium = new Array(21).fill(0), top5 = new Array(21).fill(0), sum = new Array(21).fill(0);
  for (let i = 0; i < R; i++) {
    rankAnchoredOrder(brazil, brazilScores, rnd).forEach((d, p) => { sum[d] += p + 1; if (p === 0) wins[d]++; if (p < 3) podium[d]++; if (p < 5) top5[d]++; });
  }
  ok(wins[0] / R > 0.15 && wins[0] / R < 0.4, `the model's top driver wins ${(100 * wins[0] / R).toFixed(1)}% of draws (real backtest 23%)`);
  ok(wins[0] > wins[1] && wins[1] > wins[2], "win frequency follows the model ranking at the top");
  ok(wins.slice(6).reduce((a, b) => a + b, 0) / R < 0.025, "drivers ranked 7th or lower rarely win (real backtest: none in 43 races; this draw: under 2%)");
  ok(podium.slice(6).reduce((a, b) => a + b, 0) / R > 0.1 && podium.slice(6).reduce((a, b) => a + b, 0) / R < 0.4, "a podium place goes to someone ranked 7th or lower in some draws (real backtest: ~0.23 per race)");
  ok(top5[20] >= 1 && top5[20] / R < 0.05, "the lowest-ranked driver sometimes, but rarely, finishes in the top five");
  for (let i = 1; i < 21; i++) ok(sum[i] / R > sum[i - 1] / R - 0.3, `average finishing position never improves (to within 0.3 places) as the model rank gets worse (rank ${i + 1})`);
  ok(sum[0] / R < 5 && sum[20] / R > 16, "front runners finish near the front on average and the back stays at the back");
}

// ── determinism
const a = generateProjectedRace(pack, grid, scoresOf(), 4242), b = generateProjectedRace(pack, grid, scoresOf(), 4242), c2 = generateProjectedRace(pack, grid, scoresOf(), 4243);
ok(JSON.stringify(a) === JSON.stringify(b), "same seed gives the same race");
ok(JSON.stringify(a) !== JSON.stringify(c2) && a.race.projected.order.join() !== c2.race.projected.order.join(), "a different seed gives a different race");
ok(a.race.projected.seed === 4242, "the seed is reported");

// ── across many seeds: laps, order, speed, overlap, pits, lapped cars
let lappedSeen = 0, strongOnTop = 0, runs = 0, nearSecs = 0, carSecs = 0;
const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 37);
for (const seed of SEEDS) {
  const j = generateProjectedRace(pack, grid, scoresOf(), seed), codes = j.drivers.map((d) => d.code);
  eq(codes.length, 20, "every scored driver is simulated");
  // each car crosses the line once to start and once per completed lap
  for (const d of j.drivers) {
    eq(crossings(j, d.code, j.track.sf), d.laps + 1, `${d.code} line crossings (seed ${seed})`);
    eq(j.lap_starts[d.code].length, d.laps + 1, "lap_starts has one entry per lap start plus the finish");
    ok(d.laps <= 30 && d.laps >= 28, "a car is at most two laps down in this setup");
  }
  // classification by laps then finishing time equals the drawn order, and so does the official board's last entry
  const cls = j.drivers.slice().sort((p, q) => q.laps - p.laps || j.lap_starts[p.code].at(-1) - j.lap_starts[q.code].at(-1)).map((d) => d.code);
  eq(cls, j.race.projected.order, `finishing order equals the drawn order (seed ${seed})`);
  eq(codes.slice().sort((p, q) => j.board[p].at(-1)[1] - j.board[q].at(-1)[1]), j.race.projected.order, "the order board ends on the drawn order");
  if (j.drivers.some((d) => d.laps < 30)) {
    lappedSeen++;
    const lapped = j.drivers.filter((d) => d.laps < 30).map((d) => d.code), back = j.race.projected.order.slice(-lapped.length);
    eq(lapped.slice().sort(), back.slice().sort(), "lapped cars are exactly the last classified cars");
    ok(j.laps.every((r) => Object.entries(r.gap).every(([cd, g]) => typeof g !== "string" || lapped.includes(cd))), "a '+N LAP' label only ever sits on a car that finishes lapped");
  }
  // no teleporting: nobody moves faster than 115 m/s between two seconds, and the pit-lane speed limit holds inside the lane
  for (const d of j.drivers) {
    const { x, y } = track(j, d.code);
    for (let i = 1; i < x.length; i++) if (Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) > 1150) assert.fail(`${d.code} jumps ${(Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / 10).toFixed(0)} m at ${i}s (seed ${seed})`);
    n++;
  }
  // cars are not stacked on top of each other (grid start and pit lane excluded)
  const lo = j.race.lights_out + 15, pos = Object.fromEntries(codes.map((cd) => [cd, track(j, cd)])), inPit = (cd, t) => (j.in_pit[cd] || []).some(([s, e]) => t >= s - 1 && t <= e + 1);
  for (let t = Math.ceil(lo); t < j.race.chequered - 5; t += 3) {
    for (let p = 0; p < codes.length; p++) {
      if (inPit(codes[p], t)) continue;
      carSecs++;
      for (let q = 0; q < codes.length; q++) {
        if (q === p || inPit(codes[q], t)) continue;
        if (Math.hypot(pos[codes[p]].x[t] - pos[codes[q]].x[t], pos[codes[p]].y[t] - pos[codes[q]].y[t]) < 30) { nearSecs++; break; }
      }
    }
  }
  // pit stops: 1 or 2 per car, and while a car is in its stop window every sampled position lies on the pit lane path
  const stops = {};
  for (const p of j.pits) {
    stops[p.d] = (stops[p.d] || 0) + 1;
    const { x, y } = pos[p.d];
    let checked = 0;
    for (let t = Math.ceil(p.t - p.lane_s + 2); t <= Math.floor(p.t - 2); t++) { ok(distToPath(x[t], y[t], pack.pit && { x: decodeDelta(pack.pit.x), y: decodeDelta(pack.pit.y) }) < 60, `${p.d} at ${t}s is off the pit lane (seed ${seed})`); checked++; }
    ok(checked >= 10, "a stop window is long enough to check");
    ok((j.in_pit[p.d] || []).some(([s, e]) => s <= p.t - p.lane_s + 0.2 && e >= p.t - 0.2), "the stop is listed in in_pit");
  }
  for (const d of codes) ok(stops[d] >= 1 && stops[d] <= 2, `${d} makes one or two stops`);
  // gaps never decrease down the order: seconds first (non-decreasing), then "+1 LAP" / "+2 LAPS" (non-decreasing), the leader at 0
  for (const row of j.laps) {
    let lastSec = 0, lastLaps = 0, sawLapped = false;
    row.order.forEach((cd, p) => {
      const g = row.gap[cd];
      if (g === undefined) { ok(row.lap === 1 && p > 0, `lap 1 only lists the leader's gap (${cd})`); return; }
      if (p === 0) { eq(g, 0, "the leader's gap is 0"); return; }
      if (typeof g === "string") { sawLapped = true; const nl = Number(g.match(/\+(\d+)/)[1]); ok(nl >= lastLaps, `lapped gaps do not decrease (${cd}, lap ${row.lap}, seed ${seed})`); lastLaps = nl; }
      else { ok(!sawLapped, `a car with a time gap sits behind a lapped car (${cd}, lap ${row.lap}, seed ${seed})`); ok(g >= lastSec - 1e-9, `gaps do not decrease down the order (${cd}, lap ${row.lap}, seed ${seed}: ${g} after ${lastSec})`); lastSec = g; }
    });
  }
  // the output is a valid replay file for the existing player code
  const rep = decodeReplay(j);
  eq([rep.cars.length, rep.lapsTotal, lapAt(rep, j.race.chequered), rep.outages.length, rep.bands.length], [20, 30, 30, 0, 0], "decodes like a recorded replay");
  eq(boardAt(rep, rep.startT).map((r) => r.code), grid.map((g) => g.code), "the board starts in predicted grid order");
  ok(j.flags.every((f) => f.kind === "CHEQUERED") && j.bands.length === 0 && Object.keys(j.gaps).length === 0, "no safety cars, red flags, retirements or data holes");
  ok(j.drivers.every((d) => d.status === null && d.out_t === null), "nobody retires");
  runs++;
  if (j.race.projected.order.slice(0, 3).includes("AAA") || j.race.projected.order.slice(0, 3).includes("BBB")) strongOnTop++;
}
ok(nearSecs / carSecs < 0.03, `cars within 3 m of another car for ${((100 * nearSecs) / carSecs).toFixed(2)}% of the time`);
ok(lappedSeen >= 1, "lapped cars occurred in the sample");
ok(strongOnTop > runs * 0.3, "the top-scored drivers are on the podium in many races");

// ── the highest-scored driver wins far more often than the lowest (many short races)
{
  const short = stadium(8);
  let top5 = 0, firstBest = 0, firstWeak = 0, R = 150;
  for (let s = 0; s < R; s++) {
    const o = generateProjectedRace(short, grid, scoresOf(), 7000 + s).race.projected.order;
    if (o.indexOf("TTT") < 5) top5++;
    if (o[0] === "AAA") firstBest++;
    if (o[0] === "TTT") firstWeak++;
  }
  ok(top5 <= R * 0.1, `the lowest-scored driver finished in the top five in ${top5} of ${R} races (rare)`);
  ok(firstBest > firstWeak, "the highest-scored driver wins more often than the lowest");
}

// ── seed helpers: the order for a seed without building the race, and the typical seed
{
  const codesB = brazil, sameAsRace = [3, 77, 4242].every((sd) => {
    const rows = brazil.map((c) => ({ code: c, name: c, team: "T", colour: "ffffff" }));
    return drawnOrder(codesB, brazilScores, sd).join() === generateProjectedRace(pack, rows, brazilScores, sd).race.projected.order.join();
  });
  ok(sameAsRace, "drawnOrder(seed) is exactly the order generateProjectedRace draws for that seed");
  const t0 = performance.now(), ts = typicalSeed(codesB, brazilScores), ms = performance.now() - t0;
  eq(ts, typicalSeed(codesB, brazilScores), "the typical seed is deterministic");
  ok(ms < 1500, `typicalSeed over 10,000 seeds took ${ms.toFixed(0)} ms`);
  // its order is closer to the median order than the other seeds where the rank-1 driver wins
  const mean = new Array(21).fill(0); for (let sd = 1; sd <= 10000; sd++) drawnOrder(codesB, brazilScores, sd).forEach((c, p) => { mean[codesB.indexOf(c)] += (p + 1) / 10000; });
  const dist = (sd) => drawnOrder(codesB, brazilScores, sd).reduce((a, c, p) => a + Math.abs(p + 1 - mean[codesB.indexOf(c)]), 0);
  const all = Array.from({ length: 400 }, (_, i) => 1 + i * 25).filter((sd) => drawnOrder(codesB, brazilScores, sd)[0] === "ANT").map(dist).sort((x, y) => x - y);
  ok(dist(ts) <= all[0] + 1e-9, `the typical seed (${ts}) is at least as close to the median order as the ANT-wins seeds among 400 sampled (${dist(ts).toFixed(1)} vs best ${all[0].toFixed(1)}, median ${all[all.length >> 1].toFixed(1)})`);
  console.log(`   (typical Brazil seed ${ts}, ${ms.toFixed(0)} ms)`);
}

// ── the typical (default) race shows the most common outcome: the model's rank-1 driver wins
{
  const vegas = ["RUS", "ANT", "VER", "LEC", "HAM", "NOR", "PIA", "HAD", "LAW", "GAS", "LIN", "HUL", "COL", "BOR", "BEA", "SAI", "ALB", "ALO", "STR", "PER", "BOT"];
  const vw = [0.3103, 0.9264, 0.7867, 0.2888, 0.4852, 0.0409, 0.0092, 0.0545, 0.0088, 0.001, 0.0022, 0.0012, 0.0004, 0.0008, 0.0004, 0.0003, 0.0003, 0.0003, 0.0004, 0.0003, 0.0003];
  const vp = [0.9018, 0.9478, 0.953, 0.775, 0.6612, 0.3723, 0.107, 0.1622, 0.0528, 0.0228, 0.0255, 0.0651, 0.0094, 0.0252, 0.0029, 0.0017, 0.0005, 0.0021, 0.0004, 0.0005, 0.0003];
  const vegasScores = Object.fromEntries(vegas.map((c, i) => [c, { win: vw[i], podium: vp[i] }]));
  for (const [name, cs, sc] of [["Brazil", brazil, brazilScores], ["Las Vegas", vegas, vegasScores]]) {
    const lead = cs[modelRanking(cs, sc)[0]], t0 = performance.now(), seed = typicalSeed(cs, sc), ms = performance.now() - t0;
    eq(lead, "ANT", `${name}: the model's rank-1 driver is ANT`);
    eq(drawnOrder(cs, sc, seed)[0], lead, `${name}: the default (typical) seed ${seed} has the model's rank-1 driver winning`);
    eq(typicalSeed(cs, sc), seed, `${name}: the typical seed is deterministic`);
    ok(ms < 1500, `${name}: typicalSeed took ${ms.toFixed(0)} ms`);
    console.log(`   (${name}: typical seed ${seed}, ${ms.toFixed(0)} ms, order ${drawnOrder(cs, sc, seed).join(" ")})`);
  }
}

// ── the site plays out the model's order: the finishing order equals the Race page "Full forecast" table order
{
  for (const [ref, rows] of Object.entries(ROWS)) {
    const { grid: g, scores: sc, order } = inputsFromRows(rows);
    const table = rankRows(rows).map((r) => driverCode(r.driver_name));        // exactly what the Race page table lists, top to bottom
    eq(order, table, `${ref}: inputsFromRows().order is the Race page table order`);
    for (const seed of [DEFAULT_SEED, 77, 4242]) {
      const j = generateProjectedRace(pack, g, sc, seed, order);
      eq(j.race.projected.order, table, `${ref}: the sim's finishing order equals the Race page order (seed ${seed})`);
      const cls = j.drivers.slice().sort((p, q) => q.laps - p.laps || j.lap_starts[p.code].at(-1) - j.lap_starts[q.code].at(-1)).map((d) => d.code);
      eq(cls, table, `${ref}: the cars actually cross the line in the Race page order (seed ${seed})`);
      eq(j.drivers.map((d) => d.code).sort((p, q) => j.board[p].at(-1)[1] - j.board[q].at(-1)[1]), table, `${ref}: the order board ends on the Race page order (seed ${seed})`);
    }
    eq(generateProjectedRace(pack, g, sc, DEFAULT_SEED, order).race.projected.order.join(), table.join(), `${ref}: deterministic`);
  }
  // Brazil and Las Vegas by name
  for (const ref of ["interlagos", "vegas"]) {
    const { grid: g, scores: sc, order } = inputsFromRows(ROWS[ref]);
    eq(generateProjectedRace(pack, g, sc, DEFAULT_SEED, order).race.projected.order, rankRows(ROWS[ref]).map((r) => driverCode(r.driver_name)), `${ref} fixture: sim order = Race page order`);
  }
  let threw = false; try { generateProjectedRace(pack, grid, scoresOf(), 1, ["VER"]); } catch { threw = true; }
  ok(threw, "an incomplete finishing order is refused");
}

// ── drivers without a model score are not simulated
{
  const withExtra = [...grid, { code: "XXX", name: "No Score", team: "Team 9", colour: "ffffff" }, { code: "YYY", name: "Bad Score", team: "Team 9", colour: "ffffff" }];
  const j = generateProjectedRace(pack, withExtra, { ...scoresOf(), YYY: { win: 0.1, podium: NaN } }, 5);
  eq(j.drivers.map((d) => d.code), CODES, "a driver with no (or NaN) score is excluded");
  ok(!("XXX" in j.pos) && !("YYY" in j.pos) && !("XXX" in j.board), "and has no positions");
}

// ── model rows (as POST /whatif returns them) -> generator inputs: scores pass through untouched, grid order follows the predicted grid
{
  const rows = [
    { driver_name: "Lando Norris", driverRef: "norris", team: "McLaren", grid: 2, win_probability: 0.21, podium_probability: 0.55 },
    { driver_name: "Max Verstappen", driverRef: "max_verstappen", team: "Red Bull", grid: 1, win_probability: 0.3, podium_probability: 0.6 },
    { driver_name: "Gabriel Bortoleto", driverRef: "bortoleto", team: "Audi", grid: 3, win_probability: 0.01, podium_probability: 0.04 },
    { driver_name: "Franco Camara", driverRef: "camara", team: "Cadillac", grid: 4 },
  ];
  const { grid: g, scores: sc } = inputsFromRows(rows);
  eq(g.map((x) => x.code), ["VER", "NOR", "BOR", "CAM"], "grid is in predicted-grid order with three-letter codes");
  eq(sc.NOR, { win: 0.21, podium: 0.55 }, "the model's raw scores are passed through unchanged");
  ok(!Number.isFinite(sc.CAM.podium), "a row without a score stays without one, so the generator leaves the driver out");
  ok(/^[0-9a-f]{6}$/i.test(g[0].colour), "team colour is a bare hex string like the replay files use");
}

// ── errors and speed
assert.throws(() => generateProjectedRace({ ...pack, pit: null }, grid, scoresOf(), 1), /pit lane/); n++;
assert.throws(() => generateProjectedRace(pack, grid, { AAA: { win: 1, podium: 1 } }, 1), /two drivers/); n++;
{
  const full = stadium(71), t0 = performance.now();
  generateProjectedRace(full, grid, scoresOf(), 99);
  const ms = performance.now() - t0;
  ok(ms < 1000, `a 71-lap, 20-car race took ${ms.toFixed(0)} ms`);
  console.log(`   (71 laps, 20 cars: ${ms.toFixed(0)} ms)`);
}
console.log(`${n} projected-race tests passed`);
