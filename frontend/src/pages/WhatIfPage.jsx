import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { BackendPanel, SkeletonList } from "../shared.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import ScoreFigure from "../components/ScoreFigure.jsx";
import Panel from "../components/DashPanel.jsx";
import { rowsWithShares, pctLabel, teamIdOf, teamColor, driverCode } from "../lib/homeModel.js";
import "./home.css";
import { GlassPanel, HudBrackets } from "../components/GlassPanel.jsx";
import { API, glassStyle, STANDINGS_GRID_2026, NEXT_RACE } from "../constants.js";

// ── WHAT IF SIMULATOR (next race comes from NEXT_RACE in constants.js) ──
const NEXT_RACE_CIRCUIT = NEXT_RACE.circuitRef;
const NEXT_RACE_NAME = NEXT_RACE.name.replace("Grand Prix", "GP");

// Fallback grid only — shown briefly on mount and used only if the
// qualifying-order preload request fails. The top seven of the standings
// roster (STANDINGS_GRID_2026), so it can't drift from it.
const WHATIF_FALLBACK_DRIVERS = STANDINGS_GRID_2026.slice(0, 7);

const WhatIfPage = () => {
  // The "default" to revert to on RESET - starts as the hardcoded fallback,
  // replaced once the real predicted qualifying order loads.
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
        console.error("Failed to preload qualifying order, using fallback grid:", e);
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

  // `background` and `box-shadow` are the two properties glassStyle() writes
  // inline to build the glass surface, so the drag visuals must NOT go through
  // el.style for those — setting them destroys the panel's fill and rim light,
  // and clearing them here would leave the row blank until React's next render.
  // They ride on classes instead (.wf-drag-active / .wf-drop-target, index.css),
  // which layer over the inline glass and lift off cleanly. transform /
  // transition / z-index / pointer-events / cursor / touch-action are not part
  // of the glass, so those stay direct style writes.
  const clearRowVisuals = () => {
    Object.values(rowRefs.current).forEach(el => {
      if (!el) return;
      el.classList.remove("wf-drag-active", "wf-drop-target");
      el.style.transform = "";
      el.style.transition = "";
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
      el.classList.toggle("wf-drop-target", i === targetIndex);
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
      // Lifted-glass fill + shadow come from the class (see clearRowVisuals).
      el.classList.add("wf-drag-active");
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

  const shown = rowsWithShares(results); // the API order (best podium score first), with shares of the field
  const maxShare = shown.length > 0 ? Math.max(...shown.map((r) => r.podiumShare ?? 0), 0.0001) : 1;
  const tidOfDriver = (d) => teamIdOf({ driverRef: d.driverRef, team: d.team });

  return (
    <div className="hm">
      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">INTERACTIVE · LIVE MODEL CALLS · {NEXT_RACE.circuit.toUpperCase()}</div>
          <h1 className="wordfit">What-if grid <em>simulator</em></h1>
        </div>
        <button type="button" onClick={reset} className="hm-reset">↺ RESET GRID</button>
      </header>

      <Panel title={`${NEXT_RACE_NAME} · ${NEXT_RACE.circuit}`} caption="Move drivers up or down the starting grid and watch the model's podium shares change.">
        <p className="hm-note">
          The grid starts as the predicted qualifying order for {NEXT_RACE.circuit}. Drag a driver (press and hold on touch screens) to simulate an alternative qualifying result.
          Each change triggers a live XGBoost prediction. Shares are relative strength inside this race's field, not a calibrated chance; tap or hover a figure for the raw model score.
        </p>
      </Panel>

      <div className="wf-grid">
        {/* LEFT: the draggable grid */}
        <GlassPanel className="hm-panel" tilt={false}>
          <div className="hm-panel-h"><h2>Starting grid</h2><p>Drag to reorder. Row 1 is pole position.</p></div>
          <div className="wf-list">
            {drivers.map((d, i) => {
              const tid = tidOfDriver(d);
              const col = teamColor(tid);
              return (
                <GlassPanel key={d.driverRef} className="data-row wf-row"
                  tint={tid ? col : null}
                  tilt={false}
                  data-index={i}
                  ref={el => { rowRefs.current[i] = el; }}
                  onPointerDown={e => handlePointerDown(e, i)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.55rem 0.9rem", cursor: "default", userSelect: "none", "--team": col }}>
                  <b className="wf-pos" style={{ color: i === 0 ? "#ff6b61" : undefined }}>P{i + 1}</b>
                  <i className="hm-bar" style={{ height: "1.3rem", alignSelf: "auto" }} />
                  <TeamMark team={tid} size={20} />
                  <span className="wf-drv"><b>{driverCode(d.driver_name)}</b> <span>{d.driver_name}</span></span>
                  <span className="wf-grip" aria-hidden="true">{[0, 1, 2].map(n => <span key={n}><i /><i /></span>)}</span>
                </GlassPanel>
              );
            })}
          </div>
        </GlassPanel>

        {/* RIGHT: live results */}
        <div className="hm-side">
          <GlassPanel className="hm-panel" tilt={false}>
            <div className="hm-panel-h">
              <h2>Live podium shares {loading && <span className="wf-computing">● COMPUTING</span>}</h2>
              <p>Each driver's share of the podium places for this grid. Podium shares add up to 300%.</p>
            </div>
            <div className="wf-list">
              {offline && <BackendPanel detail="The live model call failed." onRetry={reset} />}
              {!offline && results.length === 0 && <SkeletonList rows={6} metrics={1} />}
              {shown.map((r, i) => {
                const tid = teamIdOf({ driverRef: r.driverRef, team: drivers.find(d => d.driverRef === r.driverRef)?.team });
                const tc = i === 0 ? "#e10600" : teamColor(tid);
                return (
                  <motion.div key={r.driverRef} layout
                    animate={{ opacity: loading ? 0.6 : 1 }}
                    transition={{ opacity: { duration: 0.15 }, layout: { type: "spring", stiffness: 350, damping: 32 } }}
                    className="data-row glass-panel wf-row" style={{ ...glassStyle(tc), padding: "0.55rem 0.9rem" }}>
                    <HudBrackets tint={tc} />
                    <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                      <b className="wf-pos" style={{ color: i === 0 ? "#ff6b61" : undefined }}>P{i + 1}</b>
                      <TeamMark team={tid} size={20} />
                      <span className="wf-drv"><b>{r.code}</b> <span>{r.driver_name}</span><small>GRID P{r.grid}</small></span>
                      <span className="teal wf-share"><ScoreFigure raw={r.podium}>{pctLabel(r.podiumPct, r.podiumShare)}</ScoreFigure></span>
                    </div>
                    <div className="hm-meter" aria-hidden="true" style={{ marginTop: 6 }}><i style={{ width: `${(100 * (r.podiumShare ?? 0)) / maxShare}%`, background: i === 0 ? "var(--red)" : undefined, transition: "width 0.35s cubic-bezier(0.25,0.46,0.45,0.94)" }} /></div>
                  </motion.div>
                );
              })}
            </div>
          </GlassPanel>

          {hasRun && shown.length > 0 && !loading && (
            <Panel title="Model insight" caption="A one-line reading of the current result.">
              <p className="hm-note">
                <span className="pr-ink">{shown[0].driver_name}</span> leads with a podium share of <span className="pr-red">{pctLabel(shown[0].podiumPct, shown[0].podiumShare)}</span> from P{shown[0].grid}.
                {shown[0].grid > 3 ? " Circuit history is overriding grid position." : " Front row start is the dominant factor."}
              </p>
            </Panel>
          )}

          <Panel title="How this works" caption="What changes between runs, and what does not.">
            <p className="hm-note">
              Each reorder triggers a live POST to the XGBoost model. Only grid position changes: championship points, recent form and circuit history stay fixed.
              This isolates the pure qualifying effect on the race outcome model scores.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
};


export default WhatIfPage;
