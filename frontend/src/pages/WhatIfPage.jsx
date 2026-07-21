import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { SectionHeader, CountUp, BackendPanel, SkeletonList } from "../shared.jsx";
import { API, card, cardRed, CONSTRUCTOR_OVERRIDES, STANDINGS_GRID_2026, TEAM_COLORS } from "../constants.js";

// ── WHAT IF SIMULATOR (next race: Hungarian GP · Hungaroring) ────────────
const NEXT_RACE_CIRCUIT = "hungaroring";
const NEXT_RACE_NAME = "Hungarian GP";

// Fallback grid only — shown briefly on mount and used only if the
// Hungaroring qualifying-order preload request fails. Ordered by
// post-Belgium (round 10) championship standings.
const WHATIF_FALLBACK_DRIVERS = [
  { driverRef: "antonelli", driver_name: "Kimi Antonelli", team: "Mercedes", grid: 1 },
  { driverRef: "hamilton", driver_name: "Lewis Hamilton", team: "Ferrari", grid: 2 },
  { driverRef: "russell", driver_name: "George Russell", team: "Mercedes", grid: 3 },
  { driverRef: "leclerc", driver_name: "Charles Leclerc", team: "Ferrari", grid: 4 },
  { driverRef: "norris", driver_name: "Lando Norris", team: "McLaren", grid: 5 },
  { driverRef: "piastri", driver_name: "Oscar Piastri", team: "McLaren", grid: 6 },
  { driverRef: "verstappen", driver_name: "Max Verstappen", team: "Red Bull", grid: 7 },
];

const WhatIfPage = () => {
  const teamColors = TEAM_COLORS;

  // The "default" to revert to on RESET - starts as the hardcoded fallback,
  // replaced once the real Hungaroring predicted qualifying order loads.
  const [defaultDrivers, setDefaultDrivers] = useState(WHATIF_FALLBACK_DRIVERS);
  const [drivers, setDrivers] = useState(WHATIF_FALLBACK_DRIVERS);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [offline, setOffline] = useState(false);
  const rowRefs = useRef({});
  // All drag state lives in one ref, not React state - a drag gesture spans
  // many pointermove events per second, and none of them should re-render
  // this component. Visuals are applied by mutating rowRefs DOM nodes
  // directly instead, and only the final drop calls setDrivers/setResults.
  const dragRef = useRef({
    active: false, sourceIndex: null, targetIndex: null,
    startY: 0, pointerId: null, captureEl: null, longPressTimer: null,
  });

  const runPrediction = async (updatedDrivers) => {
    setLoading(true);
    setOffline(false);
    try {
      const res = await axios.post(`${API}/whatif?circuitRef=${NEXT_RACE_CIRCUIT}`, updatedDrivers);
      setResults(res.data);
      setHasRun(true);
    } catch (e) {
      console.error(e);
      setOffline(true);
    }
    setLoading(false);
  };

  const reset = () => { setDrivers(defaultDrivers); runPrediction(defaultDrivers); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const driverRefs = STANDINGS_GRID_2026.map(d => d.driverRef);
        const res = await axios.post(`${API}/whatif/qualifying?circuitRef=${NEXT_RACE_CIRCUIT}`, driverRefs);
        if (cancelled || !res.data?.length) return;
        const preloaded = res.data.map(r => ({
          driverRef: r.driverRef, driver_name: r.driver_name, team: r.team, grid: r.predicted_quali_position,
        }));
        setDefaultDrivers(preloaded);
        setDrivers(preloaded);
        runPrediction(preloaded);
      } catch (e) {
        console.error("Failed to preload Hungaroring qualifying order, using fallback grid:", e);
        runPrediction(WHATIF_FALLBACK_DRIVERS);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reorder = (fromIndex, toIndex) => {
    const reordered = [...drivers];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const withGrids = reordered.map((d, i) => ({ ...d, grid: i + 1 }));
    setDrivers(withGrids);
    runPrediction(withGrids);
  };

  // ── Unified pointer-based drag (mouse + touch, one code path) ──
  const LONG_PRESS_MS = 300;
  const MOVE_CANCEL_PX = 8;
  const ROW_NUDGE_PX = 4;

  const clearRowVisuals = () => {
    Object.values(rowRefs.current).forEach(el => {
      if (!el) return;
      el.style.transform = "";
      el.style.transition = "";
      el.style.boxShadow = "";
      el.style.background = "";
      el.style.zIndex = "";
      el.style.pointerEvents = "";
      el.style.cursor = "";
      el.style.touchAction = "";
    });
  };

  // Nudges every other row up/down to preview the gap the dragged row would
  // land in, and puts the red highlight border on the current drop target.
  const updateRowPreview = () => {
    const { sourceIndex, targetIndex } = dragRef.current;
    drivers.forEach((_, i) => {
      if (i === sourceIndex) return;
      const el = rowRefs.current[i];
      if (!el) return;
      el.style.transition = "transform 120ms ease";
      el.style.boxShadow = i === targetIndex ? "inset 3px 0 0 0 rgba(225,6,0,0.8)" : "";
      if (i < targetIndex) el.style.transform = `translateY(-${ROW_NUDGE_PX}px)`;
      else if (i > targetIndex) el.style.transform = `translateY(${ROW_NUDGE_PX}px)`;
      else el.style.transform = "";
    });
  };

  const handleEscapeKey = e => {
    if (e.key === "Escape" && dragRef.current.active) endDrag(false);
  };

  const activateDrag = i => {
    dragRef.current.active = true;
    dragRef.current.sourceIndex = i;
    dragRef.current.targetIndex = i;

    if (navigator.vibrate) navigator.vibrate(50);
    document.body.classList.add("wf-dragging");
    document.addEventListener("keydown", handleEscapeKey);

    const el = rowRefs.current[i];
    if (el) {
      el.style.transition = "none";
      el.style.transform = "scale(1.03)";
      el.style.boxShadow = "0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(225,6,0,0.3)";
      el.style.background = "rgba(255,255,255,0.08)";
      el.style.zIndex = "100";
      el.style.cursor = "grabbing";
      // Let elementFromPoint see the row underneath instead of this one.
      el.style.pointerEvents = "none";
      // Only block native scroll once we're actually dragging - before this,
      // a normal scroll gesture must still work uninterrupted.
      el.style.touchAction = "none";
    }
  };

  const endDrag = commit => {
    const { active, sourceIndex, targetIndex, pointerId, captureEl, longPressTimer } = dragRef.current;
    if (longPressTimer) clearTimeout(longPressTimer);
    document.body.classList.remove("wf-dragging");
    document.removeEventListener("keydown", handleEscapeKey);

    if (active) {
      const el = rowRefs.current[sourceIndex];
      if (el) el.style.transition = "transform 150ms ease-out"; // snap back before the reorder re-render lands
      if (commit && targetIndex !== null && targetIndex !== sourceIndex) reorder(sourceIndex, targetIndex);
    }

    if (captureEl && pointerId !== null) {
      try { captureEl.releasePointerCapture(pointerId); } catch { /* already released */ }
    }

    window.setTimeout(clearRowVisuals, active ? 160 : 0);
    dragRef.current = { active: false, sourceIndex: null, targetIndex: null, startY: 0, pointerId: null, captureEl: null, longPressTimer: null };
  };

  const handlePointerDown = (e, i) => {
    if (!e.isPrimary) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragRef.current.startY = e.clientY;
    dragRef.current.pointerId = e.pointerId;
    dragRef.current.captureEl = el;
    dragRef.current.longPressTimer = window.setTimeout(() => activateDrag(i), LONG_PRESS_MS);
  };

  const handlePointerMove = e => {
    const state = dragRef.current;
    if (state.pointerId !== e.pointerId) return;

    if (!state.active) {
      if (Math.abs(e.clientY - state.startY) > MOVE_CANCEL_PX && state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
      return;
    }

    e.preventDefault();
    const deltaY = e.clientY - state.startY;
    const el = rowRefs.current[state.sourceIndex];
    if (el) el.style.transform = `translateY(${deltaY}px) scale(1.03)`;

    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = hit?.closest("[data-index]");
    const newTarget = rowEl ? Number(rowEl.dataset.index) : state.targetIndex;
    if (newTarget !== state.targetIndex) {
      state.targetIndex = newTarget;
      updateRowPreview();
    }
  };

  const handlePointerUp = e => {
    if (dragRef.current.pointerId !== e.pointerId) return;
    endDrag(true);
  };
  const handlePointerCancel = e => {
    if (dragRef.current.pointerId !== e.pointerId) return;
    endDrag(false);
  };

  const maxProb = results.length > 0 ? Math.max(...results.map(r => r.podium_probability)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SectionHeader
        eyebrow="Interactive ML · Live Model Calls · Hungaroring"
        title={`What-If Grid Simulator — ${NEXT_RACE_NAME} · Hungaroring`}
        right={
          <button onClick={reset} className="btn-ghost" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", padding: "0.45rem 1rem", fontSize: "0.68rem", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--mono)" }}>
            ↺ RESET
          </button>
        }
      />

      <div style={{ ...card, padding: "14px 20px", display: "flex", gap: "0.6rem", alignItems: "center", borderLeft: "3px solid var(--gold)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--gold)", fontWeight: "700", flexShrink: 0 }}>NOTE</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", lineHeight: 1.6 }}>
          Grid pre-loaded with predicted qualifying order for Hungaroring · Drag to simulate alternative scenarios
        </span>
      </div>

      <p style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.7 }}>
        Drag drivers to reorder the starting grid. Each change triggers a live XGBoost prediction — watch probabilities update in real time.
      </p>

      <div className="whatif-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        {/* LEFT */}
        <div>
          <div className="section-label" style={{ marginBottom: "0.6rem" }}>Starting Grid — <span style={{ color: "var(--red)" }}>drag to reorder</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {drivers.map((d, i) => {
              const team = CONSTRUCTOR_OVERRIDES[d.driverRef] || d.team;
              return (
              <div key={d.driverRef} className="data-row"
                data-index={i}
                ref={el => { rowRefs.current[i] = el; }}
                onPointerDown={e => handlePointerDown(e, i)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                style={{
                  ...card,
                  display: "flex", alignItems: "center", gap: "0.85rem", padding: "16px",
                  borderLeft: `4px solid ${teamColors[team] || "#2a2a38"}`,
                  cursor: "default", userSelect: "none",
                }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "20px", flexShrink: 0 }}>P{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: "700", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.driver_name}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: teamColors[team] || "var(--muted)", opacity: 0.5, marginTop: "1px" }}>{team}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", opacity: 0.25, flexShrink: 0 }}>
                  {[0,1,2].map(n => <div key={n} style={{ display: "flex", gap: "2px" }}><div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text)" }} /><div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text)" }} /></div>)}
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div>
          <div className="section-label" style={{ marginBottom: "0.6rem" }}>
            Live Podium Probabilities
            {loading && <span style={{ fontFamily: "var(--mono)", color: "var(--red)", marginLeft: "0.75rem", fontSize: "0.58rem", animation: "pulse 0.8s infinite" }}>● COMPUTING</span>}
          </div>
          {offline && <BackendPanel detail="The live model call failed." onRetry={reset} />}
          {!offline && results.length === 0 && <SkeletonList rows={6} metrics={1} />}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {results.map((r, i) => {
              const rTeam = CONSTRUCTOR_OVERRIDES[r.driverRef] || drivers.find(d => d.driverRef === r.driverRef)?.team;
              const tc = teamColors[rTeam] || "#2a2a38";
              return (
                <motion.div key={r.driverRef} layout
                  animate={{ opacity: loading ? 0.6 : 1 }}
                  transition={{ opacity: { duration: 0.15 }, layout: { type: "spring", stiffness: 350, damping: 32 } }}
                  className="data-row" style={{
                  ...card,
                  padding: "16px",
                  background: i === 0 ? "rgba(225,6,0,0.08)" : card.background,
                  border: i === 0 ? "1px solid var(--border-red)" : card.border,
                  borderLeft: `4px solid ${i === 0 ? "#e10600" : i < 3 ? "rgba(225,6,0,0.3)" : "#2a2a38"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.75rem", fontWeight: "700", color: i === 0 ? "var(--red)" : "var(--muted)", width: "20px", flexShrink: 0 }}>P{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: "700", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.driver_name}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: tc, marginTop: "1px" }}>Grid P{r.grid}</div>
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "1rem", fontWeight: "700", color: i === 0 ? "var(--red)" : i < 3 ? "#ff4422" : "var(--muted)" }}>
                      <CountUp value={r.podium_probability * 100} suffix="%" />
                    </div>
                  </div>
                  <div style={{ height: "2px", background: "var(--dimmed)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(r.podium_probability / maxProb) * 100}%`, background: i === 0 ? "var(--red)" : i < 3 ? "#ff4422" : tc, transition: "width 0.35s cubic-bezier(0.25,0.46,0.45,0.94)" }} />
                  </div>
                </motion.div>
              );
            })}
          </div>

          {hasRun && results.length > 0 && !loading && (
            <div style={{ ...cardRed, padding: "0.85rem 1rem", marginTop: "0.75rem" }}>
              <div className="section-label" style={{ color: "var(--red)", marginBottom: "0.35rem" }}>Model Insight</div>
              <p style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", margin: 0, lineHeight: 1.7 }}>
                <span style={{ color: "var(--text)" }}>{results[0].driver_name}</span> leads at <span style={{ color: "var(--red)" }}>{(results[0].podium_probability * 100).toFixed(1)}%</span> from P{results[0].grid}.
                {results[0].grid > 3 ? " Circuit history is overriding grid position." : " Front row start is the dominant factor."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...card, padding: "20px", display: "flex", gap: "0.75rem" }}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.65rem", fontWeight: "700", flexShrink: 0 }}>INFO</span>
        <p style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
          Each reorder triggers a live POST to the XGBoost model. Only grid position changes — championship points, recent form, and circuit history stay fixed. This isolates the pure qualifying effect on race outcome probability.
        </p>
      </div>
    </div>
  );
};


export default WhatIfPage;
