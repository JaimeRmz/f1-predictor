// node src/lib/run-test.mjs   (run from frontend/)
import assert from "node:assert/strict";
import { generateProjectedRace, plackettLuce, scoreWeights, mulberry32 } from "./projectedRace.js";
import { decodeReplay, decodeDelta, boardAt, lapAt } from "./replay.js";

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

// ── the draw
const w = scoreWeights(["A", "B", "C"], { A: { win: 0.6, podium: 0.8 }, B: { win: 0.3, podium: 0.5 }, C: { win: 0, podium: 0.02 } });
ok(w[0] > w[1] && w[1] > w[2] && w[2] > 0, "weights follow the scores and stay above zero for a weak driver");
eq(plackettLuce([1, 1, 1, 1], mulberry32(1)).slice().sort(), [0, 1, 2, 3], "a draw is a permutation");
{
  const rnd = mulberry32(7), wins = [0, 0, 0], top2 = [0, 0, 0], R = 20000;
  for (let i = 0; i < R; i++) { const o = plackettLuce(w, rnd); wins[o[0]]++; o.slice(0, 2).forEach((d) => top2[d]++); }
  ok(wins[0] > wins[1] && wins[1] > wins[2], "the highest-scored driver wins most often");
  ok(wins[2] > R * 0.005, "a weak-score driver still wins sometimes (not impossible)");
  ok(Math.abs(wins[0] / R - w[0] / (w[0] + w[1] + w[2])) < 0.02, "P1 frequency follows the weight share");
}

// ── determinism
const a = generateProjectedRace(pack, grid, scoresOf(), 4242), b = generateProjectedRace(pack, grid, scoresOf(), 4242), c2 = generateProjectedRace(pack, grid, scoresOf(), 4243);
ok(JSON.stringify(a) === JSON.stringify(b), "same seed gives the same race");
ok(JSON.stringify(a) !== JSON.stringify(c2) && a.race.projected.order.join() !== c2.race.projected.order.join(), "a different seed gives a different race");
ok(a.race.projected.seed === 4242, "the seed is reported");

// ── across many seeds: laps, order, speed, overlap, pits, lapped cars
let lappedSeen = 0, strongOnTop = 0, weakFinishedTop5 = 0, runs = 0, nearSecs = 0, carSecs = 0;
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
  // the output is a valid replay file for the existing player code
  const rep = decodeReplay(j);
  eq([rep.cars.length, rep.lapsTotal, lapAt(rep, j.race.chequered), rep.outages.length, rep.bands.length], [20, 30, 30, 0, 0], "decodes like a recorded replay");
  eq(boardAt(rep, rep.startT).map((r) => r.code), grid.map((g) => g.code), "the board starts in predicted grid order");
  ok(j.flags.every((f) => f.kind === "CHEQUERED") && j.bands.length === 0 && Object.keys(j.gaps).length === 0, "no safety cars, red flags, retirements or data holes");
  ok(j.drivers.every((d) => d.status === null && d.out_t === null), "nobody retires");
  runs++;
  if (j.race.projected.order.slice(0, 3).includes("AAA") || j.race.projected.order.slice(0, 3).includes("BBB")) strongOnTop++;
  if (j.race.projected.order.indexOf("TTT") < 5) weakFinishedTop5++;
}
ok(nearSecs / carSecs < 0.03, `cars within 3 m of another car for ${((100 * nearSecs) / carSecs).toFixed(2)}% of the time`);
ok(lappedSeen >= 1, "lapped cars occurred in the sample");
ok(strongOnTop > runs * 0.3, "the top-scored drivers are on the podium in many races");

// ── the weakest-scored driver sometimes finishes high (loose bound, many short races)
{
  const short = stadium(8);
  let top5 = 0, firstBest = 0, firstWeak = 0, R = 150;
  for (let s = 0; s < R; s++) {
    const o = generateProjectedRace(short, grid, scoresOf(), 7000 + s).race.projected.order;
    if (o.indexOf("TTT") < 5) top5++;
    if (o[0] === "AAA") firstBest++;
    if (o[0] === "TTT") firstWeak++;
  }
  ok(top5 >= 1, `the lowest-scored driver finished in the top five in ${top5} of ${R} races`);
  ok(firstBest > firstWeak, "the highest-scored driver wins more often than the lowest");
}

// ── drivers without a model score are not simulated
{
  const withExtra = [...grid, { code: "XXX", name: "No Score", team: "Team 9", colour: "ffffff" }, { code: "YYY", name: "Bad Score", team: "Team 9", colour: "ffffff" }];
  const j = generateProjectedRace(pack, withExtra, { ...scoresOf(), YYY: { win: 0.1, podium: NaN } }, 5);
  eq(j.drivers.map((d) => d.code), CODES, "a driver with no (or NaN) score is excluded");
  ok(!("XXX" in j.pos) && !("YYY" in j.pos) && !("XXX" in j.board), "and has no positions");
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
