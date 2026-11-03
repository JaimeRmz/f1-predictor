// Shared data, formatters and hooks for the three Stage 2 design previews (components live in parts.jsx).
// NOTHING here calls an API: every dataset is a committed JSON fixture generated locally
// (see fixtures/make_fixtures.py). The previews extend the existing glass system and semantic colours:
//   red = actions / P1      teal = model predictions      gold = win score      green = actual outcomes
import { useEffect, useMemo, useState } from "react";
import nextRace from "./fixtures/next_race.json";
import championship from "./fixtures/championship.json";
import scorecard from "./fixtures/scorecard.json";
import reliability from "./fixtures/reliability.json";
import race from "./fixtures/race_1178.json";
import live from "./fixtures/live_mock.json";
import meta from "./fixtures/meta.json";
import { liveBadge } from "./liveState.js";

export const D = { nextRace, championship, scorecard, reliability, race, live, meta };

export const SCREENS = [
  ["home", "Home"], ["race", "Race"], ["champ", "Championship"], ["live", "Live"], ["model", "Model"],
];

const qs = () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
export const useScreen = () => qs().get("screen") || "home";
export const initialMode = () => qs().get("state") || "live"; // ?state=live|delayed|stale|final (screenshots)
export const hrefFor = (design, screen) => `design-${design}.html?screen=${screen}` + (qs().get("now") ? `&now=${qs().get("now")}` : "");

// A frozen clock for repeatable screenshots: ?now=2026-11-03T21:00:00Z
export function useNow() {
  const fixed = qs().get("now");
  const [t, setT] = useState(() => (fixed ? Date.parse(fixed) : Date.now()));
  useEffect(() => {
    if (fixed) return undefined;
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fixed]);
  return t;
}

export function countdownParts(targetIso, now) {
  const diff = Math.max(0, Date.parse(targetIso) - now);
  const p = (n) => String(n).padStart(2, "0");
  return { d: p(Math.floor(diff / 864e5)), h: p(Math.floor((diff % 864e5) / 36e5)), m: p(Math.floor((diff % 36e5) / 6e4)), s: p(Math.floor((diff % 6e4) / 1e3)) };
}

export const when = (iso, opts) => new Date(iso).toLocaleString(undefined, opts || { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
export const sc = (x, d = 3) => (x == null ? "-" : x.toFixed(d));
export const raceDay = D.nextRace.sessions[D.nextRace.sessions.length - 1].utc;

// ── live mock ───────────────────────────────────────────────────────────
// mode: live | delayed | stale | final. Frames advance every 2.2 s in live/delayed; ?frame=n pins one (screenshots).
export function useMockLive(mode) {
  const frames = D.live.frames;
  const pinned = qs().get("frame");
  const [i, setI] = useState(pinned != null ? Number(pinned) : 0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pinned != null || mode === "stale" || mode === "final") return undefined;
    const id = setInterval(() => setI((x) => Math.min(frames.length - 1, x + 1)), 2200);
    return () => clearInterval(id);
  }, [mode, pinned, frames.length]);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const idx = mode === "final" ? frames.length - 1 : Math.min(i, frames.length - 1);
  const ageS = mode === "live" ? 2 + (tick % 3) : mode === "delayed" ? 45 : mode === "stale" ? 120 + tick : 0;
  const badge = liveBadge({ inProgress: mode !== "final", ended: mode === "final", resultsIngested: mode === "final", ageS, delayedFeed: mode === "delayed" });
  const frame = frames[idx];
  const prev = frames[Math.max(0, idx - 1)];
  const move = {};
  frame.order.forEach((c, p) => { move[c] = prev.order.indexOf(c) - p; });
  return { frame, move, badge, ageS, idx, total: frames.length };
}


export const BADGE_COLOR = { LIVE: "var(--red)", DELAYED: "var(--amber)", NO_LIVE_DATA: "var(--muted)", FINAL: "var(--green)", PROVISIONAL: "var(--amber)", PRE: "var(--muted)" };
export const CODE_TEAM = D.live.drivers;
export const TYRE_LEGEND = [["S", "Soft", "#f06a6a"], ["M", "Medium", "#cfc36a"], ["H", "Hard", "#dcdcdc"]];
export const rankBy = (arr, key) => [...arr].sort((a, b) => b[key] - a[key]);
export const useMemoRank = (arr, key) => useMemo(() => rankBy(arr, key), [arr, key]);
