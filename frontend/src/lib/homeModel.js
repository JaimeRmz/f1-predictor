// Pure logic behind the Home dashboard (no React, no network) so it can be unit-tested.
import { COMPLETED_2026, UPCOMING_RACES_2026, NEXT_RACE, CONSTRUCTOR_OVERRIDES, STANDINGS_GRID_2026 } from "../constants.js";
import { canonicalTeam, TEAMS } from "../teams.js";

// Backtest numbers behind "How reliable is this?". They are a static Stage 1 result, NOT fetched: 43 out-of-sample
// races (2025-2026), winner picked from the model's PRE-QUALIFYING path (predicted grid) vs. simply picking the
// prior standings leader. Source: analysis/out/winner_hit_ci.json, keys b_predicted_quali|all_43|{model,prior_standings}.
export const BACKTEST = {
  races: 43,
  model: { hits: 9, ci: [0.11, 0.35] },
  standingsLeader: { hits: 12, ci: [0.17, 0.43] },
};

// Full winner-pick backtest for the Model page: 43 out-of-sample races (2025-2026), how often each method named the race
// winner. "predicted" = the model's pre-qualifying path (it uses its own predicted grid); "real" = the model handed the real
// grid after qualifying. Source: analysis/out/winner_hit_ci.json, keys {b_predicted_quali,a_real_grid}|all_43|*.
// ci = 95% Wilson interval. Static results, not fetched.
export const BACKTEST_FULL = {
  races: 43,
  predicted: {
    label: "Before qualifying", sub: "the model uses its own predicted grid",
    rows: [
      { key: "model", label: "Model", hits: 9, ci: [0.11, 0.35], model: true },
      { key: "standings", label: "Pick the points leader", hits: 12, ci: [0.17, 0.43] },
      { key: "constructor", label: "Pick the best team's lead driver", hits: 13, ci: [0.19, 0.45] },
      { key: "grid", label: "Pick the predicted pole sitter", hits: 8, ci: [0.10, 0.33] },
    ],
  },
  real: {
    label: "After qualifying", sub: "the model is given the real starting grid",
    rows: [
      { key: "model", label: "Model", hits: 26, ci: [0.46, 0.74], model: true },
      { key: "standings", label: "Pick the points leader", hits: 12, ci: [0.17, 0.43] },
      { key: "constructor", label: "Pick the best team's lead driver", hits: 13, ci: [0.19, 0.45] },
      { key: "grid", label: "Pick the pole sitter", hits: 29, ci: [0.53, 0.80] },
    ],
  },
};

const shortName = (n) => n.replace(/\s+(Grand Prix|GP)\b/, "");

// The calendar, in round order. Completed rounds and the upcoming ones come from constants.js (the single source the
// other pages use); nothing here needs the backend, so the selector renders even while the server is cold.
export const CALENDAR = [
  ...COMPLETED_2026.map((r) => ({ ...r, kind: "completed", short: shortName(r.name) })),
  ...UPCOMING_RACES_2026.map((r) => ({
    ...r, kind: "upcoming", short: shortName(r.name), next: r.raceId === NEXT_RACE.raceId,
    flag: r.raceId === NEXT_RACE.raceId ? NEXT_RACE.flag : undefined,
  })),
];

export const defaultRound = () => NEXT_RACE.round;
export const raceByRound = (round) => CALENDAR.find((r) => r.round === Number(round)) || null;

// "Brazilian Grand Prix" / "Hungarian GP" / "Spanish GP (Madrid)" -> the part before GP, and any trailing qualifier.
export const titleParts = (name) => {
  const m = name.match(/^(.*?)\s+(?:Grand Prix|GP)\b\s*(.*)$/);
  return m ? { base: m[1], suffix: m[2] } : { base: name, suffix: "" };
};

// Where a round sits relative to `now`. Only NEXT_RACE has session times in the app, so every other upcoming round
// is "pre" without a countdown.
export const phaseOf = (race, now = Date.now()) => {
  if (!race) return null;
  if (race.kind === "completed") return "final";
  if (race.raceId !== NEXT_RACE.raceId) return "pre";
  if (now >= new Date(NEXT_RACE.raceISO).getTime() + 3 * 3600e3) return "final-pending";
  if (now >= new Date(NEXT_RACE.qualiCutoffISO).getTime()) return "post";
  return "pre";
};

export const PHASE_LABEL = {
  pre: "PRE-QUALIFYING OUTLOOK",
  post: "QUALIFYING DONE · MODEL STILL USES PREDICTED GRID",
  final: "FINAL RESULT · MODEL REPLAY WITH THE REAL GRID",
  "final-pending": "RACE OVER · RESULTS NOT YET LOADED",
};

// Countdown target for the selected round: qualifying until it starts, then the race. null when the app has no times.
export const countdownTarget = (race, now = Date.now()) => {
  if (!race || race.raceId !== NEXT_RACE.raceId) return null;
  const q = new Date(NEXT_RACE.qualiCutoffISO).getTime();
  const r = new Date(NEXT_RACE.raceISO).getTime();
  if (now < q) return { label: "TO QUALIFYING", at: q };
  if (now < r) return { label: "TO RACE START", at: r };
  return null;
};

export const countdownParts = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
};

export const driverCode = (name) => {
  const last = (name || "").trim().split(/\s+/).pop() || "";
  return last.slice(0, 3).toUpperCase() || "—";
};

// Current team for a row: the per-driver override first (the DB keeps pre-rebrand constructors), then whatever the
// row says, then the roster. Returns a canonical team id, or null when it cannot be told.
export const teamIdOf = (row) =>
  canonicalTeam(CONSTRUCTOR_OVERRIDES[row.driverRef])
  || canonicalTeam(row.team || row.name_constructor)
  || canonicalTeam(STANDINGS_GRID_2026.find((d) => d.driverRef === row.driverRef)?.team);

// Team of a current-grid driver by display name (championship rows carry a name, not a driverRef). null if not on the grid.
export const teamIdByDriverName = (name) => canonicalTeam(STANDINGS_GRID_2026.find((d) => d.driver_name === name)?.team);

export const teamColor = (id) => TEAMS[id]?.color || "#8a8a95";

// Raw scores are independent per-driver outputs (win scores sum to ~3 per race, podium scores to ~5), so on their own they
// read like probabilities and are not. Shares rescale them INSIDE one race's field: values / sum(values) * total. Win
// shares use total 1 (100%), podium shares total 3 (300%: three drivers finish on the podium). Entries that are missing or
// negative get null, not 0; a field that sums to 0 gives all null. Display only: the ranking never uses shares.
export const normalizeShares = (values, total) => {
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const sum = values.reduce((a, v) => a + (ok(v) ? v : 0), 0);
  return values.map((v) => (sum > 0 && ok(v) ? (v / sum) * total : null));
};

// Whole-percent display that adds up. Plain Math.round leaves win shares at 98-102%. Largest-remainder rounding gives each
// entry its floor, then hands the leftover points to the entries with the biggest fractional parts, so the integers total
// exactly total*100 (100 for win shares, 300 for podium shares). Entries under 0.5% are shown as "<1%" and counted as 0;
// the remaining entries are scaled up by the (tiny) share they leave out, so the shown numbers still total exactly.
// null in -> null out. Ties go to the earlier entry (rank order), so the result is deterministic.
export const roundShares = (shares, total) => {
  const target = Math.round(total * 100);
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const big = shares.map((v) => ok(v) && v >= 0.005);
  const sum = shares.reduce((a, v, i) => a + (big[i] ? v * 100 : 0), 0);
  if (sum <= 0) return shares.map((v) => (ok(v) ? 0 : null));
  const scaled = shares.map((v, i) => (big[i] ? (v * 100 * target) / sum : 0));
  const out = scaled.map(Math.floor);
  let left = target - out.reduce((a, b) => a + b, 0);
  scaled.map((v, i) => [v - Math.floor(v), i]).filter(([, i]) => big[i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, Math.max(0, left)).forEach(([, i]) => { out[i] += 1; left -= 1; });
  return shares.map((v, i) => (ok(v) ? out[i] : null));
};

// Label for one rounded percent: "34%", "<1%" (under 1 or counted as zero), "—" (missing).
export const pctLabel = (pct, share) => (pct == null || share == null ? "—" : pct < 1 || share < 0.005 ? "<1%" : `${pct}%`);

// "34%"; under half a percent "<1%" (so a tiny score never reads as exactly 0); null "—".
export const shareLabel = (x) => (x == null || !Number.isFinite(x) ? "—" : x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

// Ranked by podium score, ties broken by win score (the model's own order, unchanged by shares). `win`/`podium` keep the
// raw scores for tooltips; winShare/podiumShare are what Home displays.
// Adds win/podium shares (and whole percents that total exactly 100 / 300) to rows IN THE ORDER GIVEN. Rows need `win` and
// `podium` raw scores. Used by rankRows and by pages that keep the API's own order (Predictor, What-If).
export const withShares = (rows) => {
  const w = normalizeShares(rows.map((r) => r.win), 1);
  const p = normalizeShares(rows.map((r) => r.podium), 3);
  const wp = roundShares(w, 1);
  const pp = roundShares(p, 3);
  return rows.map((r, i) => ({ ...r, winShare: w[i], podiumShare: p[i], winPct: wp[i], podiumPct: pp[i] }));
};

export const rankRows = (rows) => withShares(
  [...rows]
    .filter((r) => Number.isFinite(r.podium_probability))
    .sort((a, b) => b.podium_probability - a.podium_probability || (b.win_probability ?? 0) - (a.win_probability ?? 0))
    .map((r, i) => ({
      ...r, pos: i + 1, code: driverCode(r.driver_name), teamId: teamIdOf(r),
      win: r.win_probability ?? null, podium: r.podium_probability,
    })),
);

// Same, but keeps the order the rows arrive in (positions follow that order).
export const rowsWithShares = (rows) => withShares(
  rows.filter((r) => Number.isFinite(r.podium_probability)).map((r, i) => ({
    ...r, pos: i + 1, code: driverCode(r.driver_name), teamId: teamIdOf(r),
    win: r.win_probability ?? null, podium: r.podium_probability,
  })),
);

export const score = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

// "Last race" panel. A snapshot is genuine foresight only if frozen BEFORE that round's qualifying (same rule as the
// 2026 Season page); anything else -- no row, or a post-qualifying backfill -- is never shown as a prediction.
export const classifySnapshot = (race, snap, snapshotsLoaded) => {
  if (!snapshotsLoaded) return "unavailable";
  if (!snap || !snap.predicted_p1) return "none";
  return race.qualiISO && new Date(snap.snapshotted_at) < new Date(race.qualiISO) ? "genuine" : "after-cutoff";
};

export const actualTop3 = (rows) =>
  rows.filter((r) => r.positionOrder >= 1 && r.positionOrder <= 3).sort((a, b) => a.positionOrder - b.positionOrder);

// The race whose result the "last race" panel shows: the selected round if it is completed, else the latest
// completed round before it (null when there is none).
export const lastRaceFor = (race) => {
  if (!race) return null;
  if (race.kind === "completed") return race;
  const before = CALENDAR.filter((r) => r.kind === "completed" && r.round < race.round);
  return before[before.length - 1] || null;
};
