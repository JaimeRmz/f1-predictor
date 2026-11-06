import { useEffect, useState } from "react";
import { replayBase } from "./useReplayData.js";
import { decodeStints } from "./stints.js";

// Tyre stints live next to the replay files (stints-<raceId>.json, about 1 KB). They are fetched only when a real replay is open and only
// once per race; a missing file or any error just means no tyre badges. Never throws.
const cache = new Map();            // raceId -> Map | null
const inflight = new Map();         // raceId -> Promise (so a remount during the download does not fetch twice)

/** Stints for one real race, or null (not loaded yet, not available, or projected race: pass raceId = null). */
export const useStints = (raceId) => {
  const [s, setS] = useState({ id: null, stints: null });
  useEffect(() => {
    if (raceId == null || cache.has(raceId)) return undefined;
    const base = replayBase();
    if (!base) { cache.set(raceId, null); return undefined; }
    let live = true;
    if (!inflight.has(raceId)) {
      inflight.set(raceId, fetch(`${base}stints-${raceId}.json`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((j) => decodeStints(j))
        .catch(() => null)
        .then((m) => { cache.set(raceId, m); inflight.delete(raceId); return m; }));
    }
    inflight.get(raceId).then((m) => { if (live) setS({ id: raceId, stints: m }); });
    return () => { live = false; };
  }, [raceId]);
  if (raceId == null) return null;
  if (cache.has(raceId)) return cache.get(raceId);
  return s.id === raceId ? s.stints : null;
};
