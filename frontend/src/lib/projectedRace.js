// "Projected race": ONE illustrative race on a real circuit, built in the browser from a circuit pack, the predicted grid and the
// model's existing scores. It returns the replay file format (see backend/scripts/build_replay.py) so the same player draws it.
//
// NOTE: the site now plays out the model's own order (finishOrder = the Race page table order, see projectedInputs.js) with DEFAULT_SEED.
// The random draw below (rankAnchoredOrder, drawnOrder, typicalSeed, randomSeed, DRAW_PARAMS) is kept but UNUSED by the site, so a
// "run another race" mode can come back later. It is still covered by the unit tests.
//
// This is an illustration, not a forecast. Nothing here changes a score or a share, and nothing in the output is shown as a percentage.
// What is drawn: dots running lap by lap from the predicted grid, a finishing order drawn from the model's scores, 1-2 pit stops on the
// real pit-lane path, lapped cars at the back. What is NOT modelled: crashes, retirements, safety cars, red flags, weather, penalties.
//
// How the finishing order is drawn (rank-anchored): start from the model's own ranking for the race (the highest win score takes P1, the rest
// follow by podium score), add noise to each rank whose size comes from the model's real backtest errors for that rank (a place or two
// most of the time, now and then a big upset), and sort. So front runners usually finish near the front, big upsets are rare but possible, and the back of the
// field stays at the back. Drivers with no model score are not simulated. The scores are used for the ranking only; nothing is shown as a percentage.
// (An earlier draw weighted every driver by its scores plus a floor and was too flat below the top six: see analysis/25_projected_draw_compare.mjs.)
//
// How the race is shaped: finishing times are fixed first (the drawn order plus random gaps, some cars lapped). Each driver's race pace is
// then solved so an unobstructed car ends exactly on its time, with fuel burn, tyre wear, lap noise and 1-2 pit stops on the real pit
// lane path. Traffic is applied on top: a car cannot follow closer than 0.3 s, the time it is held up melts away again, and a held-up
// car that is quicker than the one in front passes it in an overtaking zone (the longest straights). Every car is back on schedule
// by the flag, so the finishing order is the drawn order by construction. All randomness comes from one seeded generator: a seed is a race.

const LIGHTS_OUT = 30;            // s before lights out in the window (the player starts 30 s before)
const SLOT_M = 8;                 // grid slot spacing, metres
const LAUNCH_ACC = 8;             // m/s^2 off the line
const GMIN = 0.3;                 // closest a car follows another unless passing, s
const PASS_BOOST = 0.1;           // speed advantage while passing
const FUEL = 0.035;               // s/lap quicker per lap as fuel burns
const DEG = 0.045;                // s/lap slower per lap of tyre age
const PIT_MPS = 21;               // pit lane speed limit, m/s (about 75 km/h)
const AFTER = 0.8;                // fraction of a lap a car cruises after its flag, then parks

/** Shown with every projected race. */
export const PROJECTED_LABEL = "The model's ranking played out as a race. It shows the order the model expects, not a forecast of the exact finishing order or of events such as pit stops, safety cars or incidents.";

/** The projected race always uses this seed (it only varies gaps, stops and pace noise, never the finishing order). */
export const DEFAULT_SEED = 1;

// ── seeded randomness
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const randomSeed = () => 100000 + Math.floor(Math.random() * 900000);
const normal = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const expo = (rnd, mean) => -mean * Math.log(1 - rnd());

const cum = (d) => { const o = new Float64Array(d.length); let a = 0; for (let i = 0; i < d.length; i++) { a += d[i]; o[i] = a; } return o; };
const enc = (a) => { const o = new Array(a.length); let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.round(a[i]); o[i] = v - p; p = v; } return o; };

/** The model's own ranking for the race, best first (indices into `codes`): the highest win score takes P1, everyone else follows by podium score (ties: win score). */
export const modelRanking = (codes, scores) => {
  const win = (i) => scores[codes[i]].win ?? 0, pod = (i) => scores[codes[i]].podium;
  const idx = codes.map((_, i) => i);
  const lead = idx.reduce((best, i) => (win(i) > win(best) || (win(i) === win(best) && pod(i) > pod(best)) ? i : best), 0);
  return [lead, ...idx.filter((i) => i !== lead).sort((x, y) => pod(y) - pod(x) || win(y) - win(x) || x - y)];
};

// Noise added to each predicted rank before sorting, fitted so the scatter matches the model's REAL backtest errors
// (analysis/23_projected_draw_profile.py: 43 races, predicted-grid condition, retirements removed), then tuned on this code with the Brazil scores
// (analysis/26_projected_draw_tune.mjs): the model's top driver wins ~28% of draws, a bottom-half driver reaches the top five ~2.5% of the time.
// Two parts: an everyday wobble of a place or two, and now and then a big one-sided upset: anyone ranked 1-15 has a bad day and drops back,
// an also-ran (16th or lower) has a good one and climbs. The fit reproduces, per rank group, the real median miss, the share 9+ places out and the
// win / podium / top-5 rates, and no driver can finish higher than the best the real backtest ever saw for its rank group (7th-10th: 2nd,
// 11th-15th: 3rd, 16th or lower: 4th); in 43 real races a driver the model ranked 7th or lower never won.
/** Fitted draw parameters (analysis/26_projected_draw_tune.mjs). wobble: by predicted rank 1, 2-3, 4-6, 7-10, 11-15, 16+; upsetProb: by rank group 1-6, 7-10, 11-15, 16+. */
export const DRAW_PARAMS = { wobble: [0.2, 4.4, 6.167, 2.97, 3.053, 2.331], upsetProb: [0.732, 0.652, 0.264, 0.141], upsetSize: 3.789 };
const UPSET_DIR = [1, 1, 1, -1];                                  // +1 falls back, -1 climbs
const BEST_FINISH = [1, 2, 3, 4];                                // best place seen in 43 real races for rank groups 1-6, 7-10, 11-15, 16+

/**
 * Rank-anchored draw of a finishing order (indices into `codes`): start from the model's ranking, add noise of the size the model's real
 * backtest errors have for that rank, sort. Front runners usually finish near the front, big upsets are rare but possible, the back stays
 * at the back. Entries without a finite podium score must already be removed.
 */
export const rankAnchoredOrder = (codes, scores, rnd, params = DRAW_PARAMS) => {
  const keys = modelRanking(codes, scores).map((idx, r0) => {
    const r = r0 + 1, b = r === 1 ? 0 : r <= 3 ? 1 : r <= 6 ? 2 : r <= 10 ? 3 : r <= 15 ? 4 : 5, g = r <= 6 ? 0 : r <= 10 ? 1 : r <= 15 ? 2 : 3;
    const z1 = normal(rnd), z2 = Math.abs(normal(rnd)), u = rnd();
    const dir = UPSET_DIR[g] || Math.sign(z1) || 1;
    return { idx, r, key: Math.max(BEST_FINISH[g] + 0.01 * r, r + params.wobble[b] * z1 + (u < params.upsetProb[g] ? dir * params.upsetSize * z2 : 0)) };
  });
  return keys.sort((x, y) => x.key - y.key || x.r - y.r).map((k) => k.idx);
};

/** The finishing order (driver codes) the generator draws for this seed, without building the race. Same random stream as generateProjectedRace. */
export const drawnOrder = (codes, scores, seed) => {
  const rnd = mulberry32(seed);
  normal(rnd);                                                         // the race-pace jitter, drawn first in generateProjectedRace
  return rankAnchoredOrder(codes, scores, rnd).map((i) => codes[i]);
};

/**
 * A "typical" seed: of `tries` seeds, keep only those where the model's rank-1 driver (modelRanking()[0]) wins, then take the one whose
 * finishing order is closest to the median order (every driver's mean finishing place over ALL the seeds, ranked), measured as the sum
 * over drivers of |finishing place - mean place|. So the default race shows the most common outcome. Ties go to the lowest seed.
 * If no seed has the rank-1 driver winning (cannot happen with real scores), every seed is a candidate.
 */
export const typicalSeed = (codes, scores, tries = 10000) => {
  const n = codes.length, idx = new Map(codes.map((c, i) => [c, i])), lead = codes[modelRanking(codes, scores)[0]];
  const orders = new Array(tries), sum = new Array(n).fill(0);
  for (let s = 1; s <= tries; s++) {
    const o = drawnOrder(codes, scores, s).map((c) => idx.get(c));
    orders[s - 1] = o;
    for (let p = 0; p < n; p++) sum[o[p]] += p + 1;
  }
  const mean = sum.map((v) => v / tries), leadI = idx.get(lead);
  const pool = orders.some((o) => o[0] === leadI);
  let best = 1, bestD = Infinity;
  for (let s = 1; s <= tries; s++) {
    const o = orders[s - 1];
    if (pool && o[0] !== leadI) continue;
    let d = 0;
    for (let p = 0; p < n; p++) d += Math.abs(p + 1 - mean[o[p]]);
    if (d < bestD - 1e-9) { bestD = d; best = s; }
  }
  return best;
};

// ── circuit geometry from a pack
const buildTrack = (pack) => {
  const ox = cum(pack.outline.x), oy = cum(pack.outline.y), V = ox.length;
  const len = new Float64Array(V), arc = new Float64Array(V + 1), ang = new Float64Array(V);
  for (let j = 0; j < V; j++) {
    const k = (j + 1) % V, dx = ox[k] - ox[j], dy = oy[k] - oy[j];
    len[j] = Math.hypot(dx, dy) / 10; arc[j + 1] = arc[j] + len[j]; ang[j] = Math.atan2(dy, dx);
  }
  const turn = new Float64Array(V);
  for (let j = 0; j < V; j++) { let d = ang[j] - ang[(j - 1 + V) % V]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn[j] = Math.abs(d); }
  // speed profile: slower where the line turns hard. w[j] = share of a lap's time spent on segment j (sums to 1).
  const vrel = new Float64Array(V), w = new Float64Array(V);
  let tot = 0;
  for (let j = 0; j < V; j++) {
    let th = 0, ln = 0;
    for (let d = -4; d <= 4; d++) { const i = (j + d + V) % V; th += turn[i]; ln += len[i]; }
    vrel[j] = Math.max(0.28, 1 / (1 + 120 * (th / ln)));
    w[j] = len[j] / vrel[j]; tot += w[j];
  }
  for (let j = 0; j < V; j++) w[j] /= tot;
  // flatten the profile just enough that no straight is faster than a real car (about 82 m/s) at this circuit's typical lap time
  const lapT = pack.lap_s || 90, vmax = (ww) => { let mx = 0; for (let j = 0; j < V; j++) if (len[j] > 0.5) mx = Math.max(mx, len[j] / (ww[j] * lapT)); return mx; };
  const uni = new Float64Array(V), tl = arc[V];
  for (let j = 0; j < V; j++) uni[j] = len[j] / tl;
  const raw = Float64Array.from(w);
  for (let lam = 0; lam <= 1.0001 && vmax(w) > 82; lam += 0.05) for (let j = 0; j < V; j++) w[j] = (1 - lam) * raw[j] + lam * uni[j];
  // overtaking zones: the longest fast stretches
  const runs = [];
  let s = -1, share = 0;
  for (let j = 0; j <= V; j++) {
    if (j < V && vrel[j] > 0.8) { if (s < 0) { s = j; share = 0; } share += w[j]; }
    else if (s >= 0) { runs.push({ z0: s, share }); s = -1; }
  }
  runs.sort((a, b) => b.share - a.share);
  const zones = (runs.length ? runs.slice(0, 2) : [{ z0: 0, share: 0.1 }]).map((r) => {
    let acc = 0, n = 0;
    while (acc < 0.12 && n < V / 4) { acc += w[(r.z0 + n) % V]; n++; }
    return { z0: r.z0, len: Math.max(n, 6) };
  });
  const L = arc[V];
  let pit = null;
  if (pack.pit) {
    const px = cum(pack.pit.x), py = cum(pack.pit.y), pa = new Float64Array(px.length);
    for (let i = 1; i < px.length; i++) pa[i] = pa[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]) / 10;
    pit = { px, py, pa, len: pa[pa.length - 1], enter: pack.pit.enter, exit: pack.pit.exit };
  }
  return { ox, oy, V, len, arc, L, w, zones, pit };
};

const pointAtVertex = (tr, m) => {                 // fractional unwrapped vertex index -> decimetres
  const V = tr.V, mm = ((m % V) + V) % V, j = Math.floor(mm), f = mm - j, k = (j + 1) % V;
  return [tr.ox[j] + (tr.ox[k] - tr.ox[j]) * f, tr.oy[j] + (tr.oy[k] - tr.oy[j]) * f];
};
const pointAtArc = (tr, a) => {                    // metres along the lap (may be negative: behind the line)
  const aa = ((a % tr.L) + tr.L) % tr.L;
  let lo = 0, hi = tr.V;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr.arc[mid] <= aa) lo = mid; else hi = mid; }
  return pointAtVertex(tr, lo + (aa - tr.arc[lo]) / (tr.len[lo] || 1));
};
const pointOnPit = (tr, p) => {                    // p in 0..1 along the pit lane path
  const pit = tr.pit, target = p * pit.len;
  let lo = 0, hi = pit.pa.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pit.pa[mid] <= target) lo = mid; else hi = mid; }
  const seg = pit.pa[hi] - pit.pa[lo] || 1, f = Math.min(1, Math.max(0, (target - pit.pa[lo]) / seg));
  return [pit.px[lo] + (pit.px[hi] - pit.px[lo]) * f, pit.py[lo] + (pit.py[hi] - pit.py[lo]) * f];
};

const quantileSample = (q, u) => {                 // inverse CDF through (0.1, q0) (0.5, q1) (0.9, q2)
  if (!q) return null;
  if (u < 0.1) return q[0] - (q[1] - q[0]) * 0.25 * (0.1 - u) / 0.1;
  if (u < 0.5) return q[0] + (q[1] - q[0]) * (u - 0.1) / 0.4;
  if (u < 0.9) return q[1] + (q[2] - q[1]) * (u - 0.5) / 0.4;
  return q[2] + (q[2] - q[1]) * 0.25 * (u - 0.9) / 0.1;
};

/**
 * Generate one projected race.
 * @param pack   circuit pack (scripts/build_circuit_packs.py)
 * @param grid   [{ code, name, team, colour, number? }] in predicted grid order (pole first)
 * @param scores { [code]: { win, podium } } the model's existing scores; drivers without a finite podium score are not simulated
 * @param seed   integer; the same seed gives the same race
 * @param finishOrder optional driver codes in finishing order (the Race page table order). When given, the race ends in exactly this order;
 *                    when omitted the order is drawn (rankAnchoredOrder, currently unused by the site)
 * @returns the replay file object (format v1) plus `race.projected` = { seed, order, ... }
 */
export const generateProjectedRace = (pack, grid, scores, seed, finishOrder = null) => {
  if (!pack?.pit) throw new Error("This circuit pack has no pit lane path");
  const rnd = mulberry32(seed);
  const tr = buildTrack(pack), V = tr.V, K = pack.laps, L = tr.L, Z = tr.zones.length;
  const racers = grid.filter((g) => scores[g.code] && Number.isFinite(scores[g.code].podium));
  const N = racers.length;
  if (N < 2) throw new Error("Need at least two drivers with a model score");
  const lapRef = pack.lap_s * (1 + 0.008 * normal(rnd));
  const loss0 = Math.min(30, Math.max(12, pack.pit_loss_s ?? 21));

  // 1. finishing order: the model's table order when given, otherwise drawn from the model's scores
  const codes = racers.map((r) => r.code);
  const drawn = rankAnchoredOrder(codes, scores, rnd);                 // always drawn, so the rest of the random stream is the same either way
  let order = drawn;                                                   // order[p] = racer index finishing in place p+1
  if (finishOrder) {
    order = finishOrder.filter((c) => codes.includes(c)).map((c) => codes.indexOf(c));
    if (order.length !== N || new Set(order).size !== N) throw new Error("The finishing order must list every simulated driver once");
  }
  const place = new Array(N); order.forEach((c, p) => { place[c] = p; });

  // 2. finishing gaps: who is lapped, and the target time of each car's last crossing
  const G = new Array(N).fill(0);
  for (let p = 1; p < N; p++) G[p] = G[p - 1] + 0.8 + expo(rnd, p <= 8 ? 3 : 4.5);
  const lapped = new Array(N), rem = new Array(N);
  for (let p = 0; p < N; p++) {
    let m = Math.floor(G[p] / lapRef), r = G[p] - m * lapRef;
    if (r < 0.6) { r = 0.6; G[p] = m * lapRef + r; }
    lapped[order[p]] = m; rem[order[p]] = r;
  }

  // 3. cars: strategy, noise, grid slot
  const counts = pack.stops?.counts || {}, w1 = counts["1"] ?? 0.7, w2 = counts["2"] ?? 0.3;
  const cars = racers.map((r, i) => {
    const n = K - lapped[i];
    const two = n >= 24 && rnd() < w2 / (w1 + w2 || 1);
    let s1 = Math.round(quantileSample(pack.stops?.first, rnd()) * K) || Math.round(K * 0.35);
    s1 = Math.min(Math.max(s1, 4), n - 6);
    const kps = [s1 - 1];
    if (two) {
      let s2 = Math.round(quantileSample(pack.stops?.second, rnd()) * K) || Math.round(K * 0.68);
      s2 = Math.min(Math.max(s2, s1 + 9), n - 5);
      if (s2 >= s1 + 9) kps.push(s2 - 1);
    }
    const stops = kps.map((kp) => {
      const slow = rnd() < 0.06;
      return { kp, pen: 0, loss: loss0 + normal(rnd) * 1.0, stopT: Math.min(6, 2 + expo(rnd, 0.55)) + (slow ? 3 + 3 * rnd() : 0), box: 0.25 + 0.5 * rnd(), mE: kp * V + tr.pit.enter, mX: 0, TE: 0, Tlane: 0 };
    });
    const fwd = (tr.pit.exit - tr.pit.enter + V) % V || 1;
    stops.forEach((s) => { s.mX = s.mE + fwd; s.stopT = Math.min(s.stopT, 8); s.laneBase = (pack.pit.lane_s ?? 24) + normal(rnd) * 0.8 + (s.stopT - (pack.pit.stop_s ?? 2.5)); });
    const g = SLOT_M * (i + 1);
    const noise = new Float64Array(K + 2); for (let k = 0; k < noise.length; k++) noise[k] = Math.max(-0.7, Math.min(0.7, 0.22 * normal(rnd)));
    const passU = new Float64Array((K + 2) * Z); for (let k = 0; k < passU.length; k++) passU[k] = rnd();
    const react = 0.18 + 0.06 * normal(rnd);
    return { ...r, i, n, g, stops, noise, passU, b: lapRef, T0: LIGHTS_OUT + Math.max(0.08, react) + Math.sqrt((2 * g) / LAUNCH_ACC), M: n * V + Math.floor(AFTER * V), T: null };
  });
  // grid times must be increasing with a small gap
  for (let i = 1; i < N; i++) cars[i].T0 = Math.max(cars[i].T0, cars[i - 1].T0 + 0.12);

  const startExtra = 2.7;
  const F1 = LIGHTS_OUT + 4 + K * lapRef + startExtra + 1.6 * loss0;
  cars.forEach((c) => { c.target = F1 + rem[c.i]; });

  const ltOf = (c, k) => {
    let age = k, pen = 0;
    for (const s of c.stops) { if (k > s.kp) age = k - s.kp; if (k === s.kp + 1) pen = s.pen; }
    return c.b - FUEL * (k - K / 2) + DEG * age + c.noise[k] + pen;
  };
  const startFactor = (j) => (j < 30 ? 1 + 1.5 * (1 - j / 30) ** 2 : 1);

  // 4a. each car's IDEAL arrival time at every track vertex for its pace b, with its stops. Nothing here depends on other cars.
  const buildIdeal = (c) => {
    const I = c.I || (c.I = new Float64Array(c.M + 1));
    I[0] = c.T0;
    let m = 1;
    while (m <= c.M) {
      const st = c.stops.find((s) => s.mE === m - 1);
      if (st) {                                           // pit entry: the lane stretch takes about the real lane time
        let tseg = 0;
        st.pen = 0;
        for (let i = m; i <= st.mX && i <= c.M; i++) tseg += ltOf(c, Math.floor((i - 1) / V)) * tr.w[(i - 1) % V];
        st.Tlane = Math.max(st.laneBase, st.stopT + tr.pit.len / PIT_MPS + 0.5, 0.8 * (tseg + st.loss));
        st.pen = Math.max(0, st.loss - (st.Tlane - tseg));        // what the lane does not explain is a slower out-lap
        st.TE = I[m - 1];
        const span = st.mX - st.mE;
        for (let i = 1; i <= span && st.mE + i <= c.M; i++) I[st.mE + i] = st.TE + st.Tlane * (i / span);
        m = st.mX + 1;
        continue;
      }
      const j = (m - 1) % V, k = Math.floor((m - 1) / V);
      const dt = m > c.n * V ? ltOf(c, c.n - 1) * 1.5 * tr.w[j] : ltOf(c, k) * tr.w[j] * (k === 0 ? startFactor(j) : 1);
      I[m] = I[m - 1] + dt;
      m++;
    }
  };
  // solve each pace so the ideal curve ends exactly on the car's target time (the end time is almost linear in b)
  for (const c of cars) {
    let extra = 0;
    for (let k = 0; k < c.n; k++) extra += -FUEL * (k - K / 2) + c.noise[k];
    c.b = (c.target - c.T0 - startExtra - c.stops.length * loss0 - extra) / c.n;
    for (let r = 0; r < 5; r++) {
      buildIdeal(c);
      const err = c.target - c.I[c.n * V];
      if (Math.abs(err) < 0.002) break;
      c.b += err / (c.n + 0.13 * c.stops.length);
    }
  }

  // 4b. traffic: one pass over the race, vertex by vertex. A car cannot get closer than GMIN to the car ahead; the time it is held up
  // is its "lag", which melts away again (and is zero at the flag), so each car still finishes exactly when planned.
  // A held-up car that would be ahead of the car in front without traffic tries to pass in an overtaking zone.
  const zoneStart = new Map(tr.zones.map((z, i) => [z.z0, i]));
  const simulate = () => {
    const ord = cars.map((_, i) => i).sort((a, b) => cars[a].T0 - cars[b].T0);
    let maxM = 0;
    for (const c of cars) { c.T = new Float64Array(c.M + 1); c.T[0] = c.T0; c.lag = 0; c.pass = -1; c.passEnd = -1; c.beingPassed = -1; maxM = Math.max(maxM, c.M); }
    for (let m = 1; m <= maxM; m++) {
      const j = (m - 1) % V, k = Math.floor((m - 1) / V);
      let pred = -1;
      for (let r = 0; r < N; r++) {
        const ci = ord[r], c = cars[ci];
        if (m > c.M) continue;
        if (c.stops.some((s) => m > s.mE && m < s.mX)) { c.T[m] = c.I[m] + c.lag; continue; }          // in the pit lane: not blocked, blocks nobody
        const dtI = c.I[m] - c.I[m - 1];
        const lastLap = m > (c.n - 1) * V;
        if (lastLap) c.lag = m >= c.n * V ? 0 : c.lag * (1 - 1 / (c.n * V - m + 1));
        else c.lag = Math.max(0, c.lag - 0.05 * dtI);
        if (c.pass >= 0 && m > c.passEnd) { cars[c.pass].beingPassed = -1; c.pass = -1; }
        let Tn = c.I[m] + c.lag;
        if (pred >= 0 && !lastLap) {
          const a = cars[pred];
          if (c.pass < 0 && Tn - a.T[m] < GMIN && zoneStart.has(j) && c.I[m] < a.I[m]) {
            const z = zoneStart.get(j);
            if (c.passU[k * Z + z] < Math.min(0.97, 0.45 + 0.3 * c.lag)) { c.pass = pred; c.passEnd = m - 1 + tr.zones[z].len; a.beingPassed = ci; }
          }
          if (c.pass === pred) {
            c.lag = Math.max(0, c.lag - Math.min(0.2, PASS_BOOST + 0.04 * c.lag) * dtI);
            Tn = c.I[m] + c.lag;
            if (a.T[m] - Tn >= 0.9 * GMIN) { a.beingPassed = -1; c.pass = -1; }
          } else if (c.beingPassed !== pred && Tn - a.T[m] < GMIN) {
            c.lag += a.T[m] + GMIN - Tn; Tn = a.T[m] + GMIN;
          }
        }
        c.T[m] = Tn;
        pred = ci;
      }
      for (let a = 1; a < N; a++) {                       // re-sort by arrival at this vertex (nearly sorted already)
        const x = ord[a], tx = m <= cars[x].M ? cars[x].T[m] : Infinity;
        let b = a - 1;
        while (b >= 0 && (m <= cars[ord[b]].M ? cars[ord[b]].T[m] : Infinity) > tx) { ord[b + 1] = ord[b]; b--; }
        ord[b + 1] = x;
      }
    }
    for (const c of cars) for (const s of c.stops) { s.TE = c.T[s.mE]; s.Tlane = c.T[s.mX] - c.T[s.mE]; }
  };
  simulate();
  const finishTime = (c) => c.T[c.n * V];

  // 5. read the race back out: positions every second, order board, lap rows, pit stops
  const winnerT = Math.min(...cars.map((c) => (c.n === K ? finishTime(c) : Infinity)));
  const lastT = Math.max(...cars.map(finishTime));
  const nSec = Math.ceil(lastT + 31) + 1;
  const mAt = (c, t) => {                                // fractional unwrapped vertex index, or lane state
    if (t >= c.T[c.M]) return { m: c.M };
    let lo = 0, hi = c.M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c.T[mid] <= t) lo = mid; else hi = mid; }
    return { m: lo + (t - c.T[lo]) / (c.T[hi] - c.T[lo] || 1) };
  };
  const stateAt = (c, t) => {
    if (t < c.T[0]) {                                     // on the grid, then launching
      const tl = c.T0 - Math.sqrt((2 * c.g) / LAUNCH_ACC);
      const s = t <= tl ? 0 : 0.5 * LAUNCH_ACC * (t - tl) ** 2;
      const p = pointAtArc(tr, -c.g + Math.min(s, c.g));
      return { x: p[0], y: p[1], mrank: (-c.g + Math.min(s, c.g)) / L * V, lane: false };
    }
    for (const s of c.stops) {
      if (t >= s.TE && t < s.TE + s.Tlane && s.Tlane > 0) {
        const e = t - s.TE, mov = s.Tlane - s.stopT, t1 = mov * s.box;
        const q = e < t1 ? s.box * (e / t1) : e < t1 + s.stopT ? s.box : s.box + (1 - s.box) * ((e - t1 - s.stopT) / (mov - t1));
        const pt = pointOnPit(tr, Math.min(1, q));
        return { x: pt[0], y: pt[1], mrank: s.mE + (s.mX - s.mE) * (e / s.Tlane), lane: true, stopping: e >= t1 && e < t1 + s.stopT };
      }
    }
    const { m } = mAt(c, t), p = pointAtVertex(tr, m);
    return { x: p[0], y: p[1], mrank: Math.min(m, c.n * V), lane: false };
  };
  const xs = cars.map(() => new Array(nSec)), ys = cars.map(() => new Array(nSec));
  const rankKey = (c, mr) => mr * 1e3 - (finishTime(c) - LIGHTS_OUT) * 1e-4;
  const board = {}, boardLast = {}, gapS = {};
  cars.forEach((c) => { board[c.code] = []; boardLast[c.code] = -1; gapS[c.code] = new Array(nSec).fill(null); });
  // Gap to the leader, every second, from the SAME sorted list as the order board (rows below). "Time since the leader was at this car's
  // spot": t - (the leader's time at the car's current position). The further back a car is, the earlier the leader passed its spot, so the gap
  // can only grow down the order. A car a full lap or more behind the leader's position shows laps down (stored as a negative whole number);
  // once both have taken the flag the gap is the difference of their finishing times (or laps down). null before the start.
  const Tat = (c, m) => { if (m <= 0) return c.T[0]; if (m >= c.M) return c.T[c.M]; const k = Math.floor(m); return c.T[k] + (m - k) * (c.T[k + 1] - c.T[k]); };
  const gapAt = (lead, c, t, mL, mC) => {
    if (t >= finishTime(c) && t >= finishTime(lead)) { const dn = lead.n - c.n; return dn > 0 ? -dn : Math.round((finishTime(c) - finishTime(lead)) * 10) / 10; }
    const down = Math.floor((mL - mC) / V + 1e-9);
    if (down >= 1) return -down;
    return Math.round(Math.max(0, t - Tat(lead, mC)) * 10) / 10;
  };
  const orderAt = (t) => cars.map((c) => ({ c, st: stateAt(c, t) })).sort((a, b) => rankKey(b.c, b.st.mrank) - rankKey(a.c, a.st.mrank));
  for (let t = 0; t < nSec; t++) {
    const rows = orderAt(t);
    rows.forEach((r, p) => {
      xs[r.c.i][t] = r.st.x; ys[r.c.i][t] = r.st.y;
      if (boardLast[r.c.code] !== p + 1) { board[r.c.code].push([t, p + 1]); boardLast[r.c.code] = p + 1; }
      if (p > 0 && t >= LIGHTS_OUT + 1 && r.st.mrank > 0) gapS[r.c.code][t] = gapAt(rows[0].c, r.c, t, rows[0].st.mrank, r.st.mrank);
    });
  }
  const laps = [];
  const leaderCross = (k) => Math.min(...cars.filter((c) => c.n >= k).map((c) => c.T[(k - 1) * V]));
  for (let k = 1; k <= K; k++) {
    const t = k === 1 ? LIGHTS_OUT : leaderCross(k);
    // order and gaps from the time each car reaches the leader's line crossing, so gaps never decrease down the order
    const m = (k - 1) * V, arrive = (c) => (k === 1 ? c.T0 : m <= c.M ? c.T[m] : Infinity);
    const rows = cars.slice().sort((a, b) => arrive(a) - arrive(b) || a.i - b.i);
    const leadLap = k > 1 ? rows[0].T[m] - rows[0].T[m - V] : lapRef;
    const gap = {};
    rows.forEach((c, p) => {
      if (p === 0) { gap[c.code] = 0; return; }
      if (k === 1) return;
      const g = arrive(c) - t, behind = Number.isFinite(g) ? Math.floor(g / leadLap + 1e-9) : Math.max(1, k - c.n);
      gap[c.code] = behind >= 1 ? `+${behind} ${behind === 1 ? "LAP" : "LAPS"}` : Math.round(g * 10) / 10;
    });
    laps.push({ lap: k, t: Math.round(t * 10) / 10, order: rows.map((c) => c.code), gap });
  }
  const lapStarts = {};
  cars.forEach((c) => {
    const a = [LIGHTS_OUT];
    for (let k = 1; k <= c.n; k++) a.push(Math.round(c.T[k * V] * 10) / 10);
    lapStarts[c.code] = a;
  });
  const pits = [], inPit = {};
  cars.forEach((c) => {
    c.stops.forEach((s) => {
      pits.push({ d: c.code, lap: s.kp + 1, t: Math.round((s.TE + s.Tlane) * 10) / 10, lane_s: Math.round(s.Tlane * 1000) / 1000, stop_s: Math.round(s.stopT * 10) / 10 });
      (inPit[c.code] ||= []).push([Math.round(s.TE * 10) / 10, Math.round((s.TE + s.Tlane) * 10) / 10]);
    });
  });
  pits.sort((a, b) => a.t - b.t);

  return {
    v: 1,
    license: "Illustrative race generated in the browser from the model's scores. Circuit shape and typical times: " + pack.license,
    race: {
      raceId: `projected-${pack.circuitRef}`, year: pack.source.year, round: 0, name: pack.source.name, session_key: null, t0: 0, n: nSec,
      lights_out: LIGHTS_OUT, chequered: Math.round(lastT * 10) / 10, laps: K, unit: "decimetre, delta-encoded",
      projected: { seed, circuitRef: pack.circuitRef, order: order.map((i) => codes[i]), winnerTime: Math.round(winnerT * 10) / 10, basedOn: `${pack.source.name} ${pack.source.year}` },
    },
    drivers: cars.map((c, idx) => ({ n: c.number ?? idx + 1, code: c.code, name: c.name, team: c.team, colour: c.colour, status: null, out_t: null, laps: c.n })),
    track: { outline: pack.outline, sf: pack.sf, pit: { x: pack.pit.x, y: pack.pit.y }, length_m: pack.length_m, closure_m: 0, reference: "circuit pack" },
    pos: Object.fromEntries(cars.map((c) => [c.code, { x: enc(xs[c.i]), y: enc(ys[c.i]) }])),
    gaps: {}, in_pit: inPit, lap_starts: lapStarts, laps, board, gap_s: gapS, pits,
    flags: [{ t: Math.round(winnerT * 10) / 10, lap: K, kind: "CHEQUERED", msg: "CHEQUERED FLAG" }],
    bands: [],
  };
};
