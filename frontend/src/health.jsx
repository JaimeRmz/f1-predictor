import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { API } from "./constants.js";

// ── Backend health, cold-start aware ─────────────────────────────
// The backend (Render free tier) spins down after ~15 min idle and takes
// ~30-50s to wake. We hit the fast health check ("GET /") which returns
// { models_ready } the instant the process is up — long before the models
// finish loading — so we can tell three states apart:
//
//   waking  – pinging / no response yet, OR reachable but models_ready:false
//   online  – 200 + models_ready:true
//   offline – health check kept failing past OFFLINE_AFTER_MS (truly dead)
//
// A failed fetch during a cold start is EXPECTED (the container isn't up yet),
// so failures read as WAKING until the budget elapses — we only declare OFFLINE
// once it's been unreachable long enough that "spinning up" no longer explains
// it.

const OFFLINE_AFTER_MS = 75000;  // unreachable this long → give up, show OFFLINE
const POLL_WAKING_MS = 3000;     // poll briskly while we wait for it to wake
const POLL_ONLINE_MS = 30000;    // relaxed heartbeat once healthy
const REQ_TIMEOUT_MS = 8000;     // per-ping ceiling

const HealthContext = createContext({ status: "waking", wakeEpoch: 0, retry: () => {} });
// eslint-disable-next-line react-refresh/only-export-components -- context hook co-located with its provider
export const useHealth = () => useContext(HealthContext);

export const HealthProvider = ({ children }) => {
  const [status, setStatus] = useState("waking");
  // Bumps each time the backend transitions INTO online — data pages watch it
  // to auto-refetch the moment the models finish loading.
  const [wakeEpoch, setWakeEpoch] = useState(0);

  const firstFailRef = useRef(null);   // when the current failure streak began
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; });

  const ping = useCallback(async () => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/`, { signal: ctrl.signal });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!mountedRef.current) return;
      firstFailRef.current = null; // it responded → not "dead"
      if (data && data.models_ready) {
        setStatus(prev => {
          if (prev !== "online") setWakeEpoch(e => e + 1);
          return "online";
        });
      } else {
        setStatus("waking"); // reachable but still warming up (or non-200)
      }
    } catch {
      if (!mountedRef.current) return;
      if (firstFailRef.current == null) firstFailRef.current = Date.now();
      const downFor = Date.now() - firstFailRef.current;
      setStatus(downFor >= OFFLINE_AFTER_MS ? "offline" : "waking");
    } finally {
      clearTimeout(to);
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    const delay = statusRef.current === "online" ? POLL_ONLINE_MS : POLL_WAKING_MS;
    timerRef.current = setTimeout(async () => {
      await ping();
      // eslint-disable-next-line react-hooks/immutability -- intentional self-scheduling poll loop
      if (mountedRef.current) schedule();
    }, delay);
  }, [ping]);

  const retry = useCallback(() => {
    firstFailRef.current = null;
    setStatus("waking");
    ping().then(() => { if (mountedRef.current) schedule(); });
  }, [ping, schedule]);

  useEffect(() => {
    mountedRef.current = true;
    // Fire the very first ping immediately on app mount (before any page data
    // request) so a spun-down instance starts waking while the user is still on
    // the Home screen — by the time they click into a data page it may be warm.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the async poll; setState happens later in ping()
    ping().then(() => { if (mountedRef.current) schedule(); });
    return () => { mountedRef.current = false; clearTimeout(timerRef.current); };
  }, [ping, schedule]);

  return (
    <HealthContext.Provider value={{ status, wakeEpoch, retry }}>
      {children}
    </HealthContext.Provider>
  );
};
