import { useEffect, useMemo, useState } from "react";
import { decodeReplay } from "./replay.js";
import { replayBase } from "./useReplayData.js";
import { generateProjectedRace } from "./projectedRace.js";
import { inputsFromRows } from "./projectedInputs.js";

// Circuit packs (scripts/build_circuit_packs.py) live next to the replay files: packs.json is the index, pack-<circuitRef>.json one circuit.
// Without them the Projected race says so and nothing else changes.
let indexPromise = null;
const packCache = new Map();

const loadIndex = () => {
  if (!indexPromise) {
    const base = replayBase();
    indexPromise = base
      ? fetch(`${base}packs.json`).then((r) => { if (!r.ok) throw new Error(`packs HTTP ${r.status}`); return r.json(); })
        .then((m) => { if (!m || typeof m.circuits !== "object") throw new Error("bad pack index"); return m.circuits; })
      : Promise.reject(new Error("no replay base URL"));
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
};

/** { status: "loading" | "ready" | "unavailable", circuits } -- circuits maps circuitRef -> index entry. */
export const usePackIndex = () => {
  const [s, setS] = useState({ status: "loading", circuits: {} });
  useEffect(() => {
    let live = true;
    loadIndex().then((c) => live && setS({ status: "ready", circuits: c })).catch(() => live && setS({ status: "unavailable", circuits: {} }));
    return () => { live = false; };
  }, []);
  return s;
};

/** { status: "idle" | "loading" | "ready" | "unavailable", pack } for one index entry (cached for the session). */
export const usePack = (entry) => {
  const file = entry?.file ?? null;
  const [s, setS] = useState({ file: null, status: "loading", pack: null });
  useEffect(() => {
    if (!file || packCache.has(file)) return undefined;
    let live = true;
    fetch(`${replayBase()}${file}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((pack) => { packCache.set(file, pack); if (live) setS({ file, status: "ready", pack }); })
      .catch(() => live && setS({ file, status: "unavailable", pack: null }));
    return () => { live = false; };
  }, [file]);
  if (!file) return { status: "idle", pack: null };
  if (packCache.has(file)) return { status: "ready", pack: packCache.get(file) };
  return s.file === file ? s : { status: "loading", pack: null };
};

/** One projected race for (pack, model rows, seed), decoded for the existing player. Same inputs always give the same race. */
export const useProjectedRace = (pack, rows, seed) => useMemo(() => {
  if (!pack || !rows) return { rep: null, error: null };
  try {
    const { grid, scores } = inputsFromRows(rows);
    const j = generateProjectedRace(pack, grid, scores, seed);
    return { rep: decodeReplay(j), error: null };
  } catch (e) {
    return { rep: null, error: e.message || "Could not build the illustration" };
  }
}, [pack, rows, seed]);
