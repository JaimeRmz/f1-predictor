import { useEffect, useState } from "react";
import { decodeReplay, parseReplayBuffer } from "./replay.js";

// Where the replay files live. Production: a public Supabase Storage bucket, set through VITE_REPLAY_BASE_URL (optional: when it is
// unset the Replay tab shows "not available" and nothing else on the site changes). Development: the untracked
// frontend/public/replay-dev/ folder written by scripts/build_replay.py.
export const replayBase = () => {
  const b = import.meta.env.VITE_REPLAY_BASE_URL || (import.meta.env.DEV ? "/replay-dev/" : "");
  return b ? (b.endsWith("/") ? b : `${b}/`) : "";
};

let manifestPromise = null;
const raceCache = new Map();

const loadManifest = () => {
  if (!manifestPromise) {
    const base = replayBase();
    manifestPromise = base
      ? fetch(`${base}manifest.json`).then((r) => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}`); return r.json(); })
        .then((m) => { if (!m || !Array.isArray(m.races)) throw new Error("bad manifest"); return m; })
      : Promise.reject(new Error("no replay base URL"));
    manifestPromise.catch(() => { manifestPromise = null; });          // allow a retry on the next visit
  }
  return manifestPromise;
};

/** { status: "loading" | "ready" | "unavailable", races } -- only races that have a file. */
export const useManifest = () => {
  const [s, setS] = useState({ status: "loading", races: [], license: null });
  useEffect(() => {
    let live = true;
    loadManifest()
      .then((m) => live && setS({ status: "ready", races: m.races.filter((r) => r.file), license: m.license || null }))
      .catch(() => live && setS({ status: "unavailable", races: [], license: null }));
    return () => { live = false; };
  }, []);
  return s;
};

/** { status: "loading" | "ready" | "unavailable", rep } for one manifest entry. Decoded races are cached for the session. */
export const useReplayRace = (entry) => {
  const key = entry?.raceId ?? null;
  const [s, setS] = useState({ key: null, status: "loading", rep: null });
  useEffect(() => {
    if (key == null || raceCache.has(key)) return undefined;
    let live = true;
    fetch(`${replayBase()}${entry.file}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(parseReplayBuffer)
      .then((j) => { const rep = decodeReplay(j); raceCache.set(key, rep); if (live) setS({ key, status: "ready", rep }); })
      .catch(() => live && setS({ key, status: "unavailable", rep: null }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key == null) return { status: "unavailable", rep: null };
  if (raceCache.has(key)) return { status: "ready", rep: raceCache.get(key) };
  return s.key === key ? s : { status: "loading", rep: null };
};
