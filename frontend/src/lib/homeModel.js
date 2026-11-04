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

export const teamColor = (id) => TEAMS[id]?.color || "#8a8a95";

// Ranked by podium score, ties broken by win score. Scores are the API's raw values (win scores sum to ~3, podium
// scores to ~5): never rescaled, never shown as percentages.
export const rankRows = (rows) =>
  [...rows]
    .filter((r) => Number.isFinite(r.podium_probability))
    .sort((a, b) => b.podium_probability - a.podium_probability || (b.win_probability ?? 0) - (a.win_probability ?? 0))
    .map((r, i) => ({
      ...r, pos: i + 1, code: driverCode(r.driver_name), teamId: teamIdOf(r),
      win: r.win_probability ?? null, podium: r.podium_probability,
    }));

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
