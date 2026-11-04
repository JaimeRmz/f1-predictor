import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, STANDINGS_GRID_2026 } from "../constants.js";

// Per-race model rows for Home and Race. Completed rounds come from /predict/{raceId} (real grid); upcoming rounds from
// /whatif (predicted grid). Cached per race; a failed round stays an error until Retry.
const TIMEOUT_MS = 70000, SLOW_MS = 6000;

export const fetchRows = (race) => (race.kind === "completed"
  ? axios.get(`${API}/predict/${race.raceId}`, { timeout: TIMEOUT_MS })
  : axios.post(`${API}/whatif?circuitRef=${race.circuitRef}&auto_quali=true`, STANDINGS_GRID_2026, { timeout: TIMEOUT_MS })
).then((r) => r.data);

// One cache of per-race rows, filled lazily for the selected round and the "last race" round. Switching back to a
// round already loaded is instant. A failed round is cached as an error until Retry (or the backend panel's auto-retry).
export const useRaceRows = (races) => {
  const [res, setRes] = useState({});
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const started = useRef(new Set());
  const key = races.filter(Boolean).map((r) => r.raceId).join(",");

  useEffect(() => {
    const todo = races.filter((r) => r && !started.current.has(r.raceId));
    if (!todo.length) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    todo.forEach((race) => {
      started.current.add(race.raceId);
      fetchRows(race)
        .then((rows) => setRes((p) => ({ ...p, [race.raceId]: { status: "ready", rows } })))
        .catch((e) => setRes((p) => ({ ...p, [race.raceId]: { status: "error", http: e.response ? (e.response.data?.detail || `HTTP ${e.response.status}`) : null } })))
        .finally(() => setSlow(false));
    });
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => {
    setRes((p) => {
      const next = { ...p };
      Object.keys(next).forEach((id) => { if (next[id].status === "error") { delete next[id]; started.current.delete(Number(id)); } });
      return next;
    });
    setAttempt((a) => a + 1);
  }, []);
  return { res, slow, retry };
};
