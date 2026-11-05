// Pure logic for the race replay (no React, no network): decoding the compact file, cubic interpolation, the order board.
// File format: see backend/scripts/build_replay.py. Positions are decimetres, delta-encoded at 1 Hz. The order board is the
// official OpenF1 /position feed, not an order recomputed from x/y.

/** Cumulative sum of a delta-encoded integer array -> Float32Array. */
export const decodeDelta = (deltas) => {
  const out = new Float32Array(deltas.length);
  let acc = 0;
  for (let i = 0; i < deltas.length; i++) { acc += deltas[i]; out[i] = acc; }
  return out;
};

/** Catmull-Rom (cubic) interpolation of a 1 Hz series at fractional index t, clamped at both ends. */
export const cubicAt = (arr, t) => {
  const n = arr.length;
  if (n === 0) return NaN;
  if (t <= 0) return arr[0];
  if (t >= n - 1) return arr[n - 1];
  const k = Math.floor(t), u = t - k;
  const p0 = arr[Math.max(k - 1, 0)], p1 = arr[k], p2 = arr[k + 1], p3 = arr[Math.min(k + 2, n - 1)];
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
};

const inAny = (ranges, t) => {
  if (!ranges) return false;
  for (let i = 0; i < ranges.length; i++) if (t >= ranges[i][0] && t <= ranges[i][1]) return true;
  return false;
};

/** Runs of seconds (4 s or longer) where at least half of the cars still racing have no position data: the whole feed dropped out. */
export const findOutages = (cars, n, minLen = 4) => {
  const out = [];
  let start = -1;
  for (let s = 0; s <= n; s++) {
    let racing = 0, hidden = 0;
    if (s < n) {
      for (const c of cars) {
        if ((c.status === "dnf" || c.status === "dns") && c.outT != null && s >= c.outT) continue;
        racing++;
        if (inAny(c.holes, s)) hidden++;
      }
    }
    const gap = s < n && racing > 0 && hidden / racing >= 0.5;
    if (gap && start < 0) start = s;
    if (!gap && start >= 0) { if (s - start >= minLen) out.push({ a: start, b: s - 1 }); start = -1; }
  }
  return out;
};

/** Turn the parsed JSON into typed arrays and lookups the player can use every frame. */
export const decodeReplay = (j) => {
  const cars = j.drivers.map((d, idx) => ({
    idx, code: d.code, n: d.n, name: d.name, team: d.team, colour: d.colour ? `#${d.colour}` : "#8a8a95",
    status: d.status, outT: d.out_t, laps: d.laps,
    x: decodeDelta(j.pos[d.code].x), y: decodeDelta(j.pos[d.code].y),
    holes: j.gaps?.[d.code] || null, pitRuns: j.in_pit?.[d.code] || null,
    boardT: Float32Array.from((j.board[d.code] || []).map((e) => e[0])),
    boardP: Uint8Array.from((j.board[d.code] || []).map((e) => e[1])),
  }));
  const ox = decodeDelta(j.track.outline.x), oy = decodeDelta(j.track.outline.y);
  const pit = j.track.pit ? { x: decodeDelta(j.track.pit.x), y: decodeDelta(j.track.pit.y) } : null;
  const outages = findOutages(cars, j.race.n);
  return {
    race: j.race, license: j.license, cars, outages, byCode: Object.fromEntries(cars.map((c) => [c.code, c])),
    outline: { x: ox, y: oy }, pit, sf: j.track.sf, trackLengthM: j.track.length_m,
    laps: j.laps, lapStartsLeader: j.laps.map((l) => l.t), flags: j.flags, bands: j.bands, pits: j.pits,
    endT: j.race.chequered + 30, startT: Math.max(0, j.race.lights_out - 30), lightsOut: j.race.lights_out, lapsTotal: j.race.laps,
  };
};

/** Where a car is at time t (seconds since the start of the window): position, and whether to draw it normally, greyed (OUT) or not at all. */
export const carStateAt = (rep, car, t) => {
  const out = (car.status === "dnf" || car.status === "dns") && car.outT != null && t >= car.outT;
  const hidden = !out && inAny(car.holes, t);
  return { x: cubicAt(car.x, t), y: cubicAt(car.y, t), out, hidden, inPit: inAny(car.pitRuns, t), dsq: car.status === "dsq" && t >= rep.race.chequered };
};

/** The official position of a car at time t: the last /position change at or before t (the first value before the first change). */
export const officialPosition = (car, t) => {
  const n = car.boardT.length;
  if (n === 0) return null;
  let lo = 0, hi = n - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (car.boardT[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return car.boardP[ans < 0 ? 0 : ans];
};

/** Lap number at time t: how many leader line crossings have happened (0 before lights out, capped at the race distance). */
export const lapAt = (rep, t) => {
  let lo = 0, hi = rep.lapStartsLeader.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rep.lapStartsLeader[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans < 0 ? 0 : Math.min(rep.laps[ans].lap, rep.lapsTotal);
};

export const lapStartTime = (rep, lap) => {
  const row = rep.laps.find((l) => l.lap === lap);
  return row ? row.t : null;
};

/** The order board at time t: rows sorted by official position; ties (rare, at the instant of a change) broken by driver code. */
export const boardAt = (rep, t) => {
  const lapIdx = lapRowIndex(rep, t);
  const gaps = lapIdx >= 0 ? rep.laps[lapIdx].gap : {};
  const rows = rep.cars.map((car) => {
    const st = carStateAt(rep, car, t);
    return { code: car.code, team: car.team, colour: car.colour, pos: officialPosition(car, t) ?? 99, out: st.out, inPit: st.inPit, dsq: st.dsq, noData: st.hidden, gap: gaps?.[car.code] ?? null, status: car.status };
  });
  rows.sort((a, b) => a.pos - b.pos || (a.code < b.code ? -1 : 1));
  return rows;
};

const lapRowIndex = (rep, t) => {
  let lo = 0, hi = rep.lapStartsLeader.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rep.lapStartsLeader[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
};

/** Text for the gap column: LEADER, "+12.3", a lapped marker as given by OpenF1, or an em dash when unknown. */
export const gapLabel = (row) => {
  if (row.out) return "OUT";
  if (row.dsq) return "DSQ";
  if (row.noData) return "NO DATA";
  if (row.inPit) return "PIT";
  if (row.pos === 1) return "LEADER";
  if (row.gap == null) return "—";
  return typeof row.gap === "number" ? `+${row.gap.toFixed(1)}` : String(row.gap);
};

/** The whole-feed data outage covering time t, or null. */
export const outageAt = (rep, t) => rep.outages.find((o) => t >= o.a && t <= o.b) || null;

/** Active race-control band (SC / VSC / RED) at time t, or null. */
export const bandAt = (rep, t) => rep.bands.find((b) => t >= b.a && t <= b.b) || null;

/** "m:ss" clock relative to lights out (negative before the start). */
export const raceClock = (rep, t) => {
  const s = Math.round(t - rep.lightsOut);
  const a = Math.abs(s);
  return `${s < 0 ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};

/** Bounding box of the outline and pit lane, in decimetres. */
export const trackBounds = (rep) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (xs, ys) => { for (let i = 0; i < xs.length; i++) { if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i]; if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i]; } };
  add(rep.outline.x, rep.outline.y);
  if (rep.pit) add(rep.pit.x, rep.pit.y);
  return { minX, maxX, minY, maxY };
};

/** Parse a replay file buffer: gzip (magic 1f 8b) is inflated with DecompressionStream, plain JSON is accepted too. */
export const parseReplayBuffer = async (buf) => {
  const u8 = new Uint8Array(buf);
  let text;
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack the replay file");
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(u8);
  }
  return JSON.parse(text);
};
