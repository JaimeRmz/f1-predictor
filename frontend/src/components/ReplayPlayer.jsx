import { useEffect, useRef, useState, useCallback } from "react";
import OrderBoard from "./OrderBoard.jsx";
import { useOrderMode } from "../lib/useOrderMode.js";
import { useStints } from "../lib/useStints.js";
import { tiresAt } from "../lib/stints.js";
import { carStateAt, boardAt, lapAt, lapStartTime, bandAt, outageAt, raceClock, trackBounds } from "../lib/replay.js";
import "../pages/replay.css";

const SPEEDS = [1, 4, 16, 64];
const COMPACT_SPEEDS = [1, 4, 16];
const STEP_S = 10;

// Canvas player. The animation loop (requestAnimationFrame) owns the clock in a ref and draws straight to the canvas; React state is
// touched only a few times a second (the readout, scrubbers and order board), never per frame.
// Props for the Home "Race sim" band (everything optional; the Replay page passes none of them):
//   compact     smaller layout: no scrubbers or legend, top-10 order board, SPEEDS without 64x
//   deferPlay   the picture is only a preview of the start: Play asks onPlayRequest() (to download the real replay) instead of playing; seeking is off
//   loading     the real replay is being downloaded after Play was pressed
//   preview     this is only the start grid of a completed race (before its real replay is downloaded): the board is titled "STARTING GRID"
//   autoPlay    start playing when this player mounts (used right after the visitor pressed Play and the replay arrived); ignored under reduced motion
//   (compact also fixes the track height at 300 px, titles the board by state and shows no gaps before the start)
const ReplayPlayer = ({ rep, projected = false, compact = false, deferPlay = false, onPlayRequest = null, loading = false, preview = false, autoPlay = false }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const staticRef = useRef(null);            // offscreen layer: outline, pit lane, start/finish
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const fitRef = useRef(null);
  const timeRef = useRef(rep.startT);
  const dirty = useRef(true);
  const uiDirty = useRef(true);
  // autoPlay = the visitor just pressed Play and the replay arrived. Under reduced motion it waits for another press.
  const [autoStart] = useState(() => autoPlay && !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const ctl = useRef({ playing: autoStart, speed: 4 });
  const [playing, setPlaying] = useState(autoStart);
  const [speed, setSpeed] = useState(4);
  const [orderMode, setOrderMode] = useOrderMode();
  // Track labels: dots only, except the race leader and the driver the visitor picked (tap a dot or a board row; hover on desktop).
  const [sel, setSel] = useState(null);
  const selRef = useRef(null);
  const hoverRef = useRef(null);
  const hitRef = useRef([]);                 // screen positions of the dots drawn in the last frame, for tap / hover hit-testing
  const stints = useStints(projected ? null : rep.race.raceId);        // real replays only; null (nothing shown) while loading or when the race has no file
  const [ui, setUi] = useState(() => snapshot(rep, rep.startT));

  const speeds = compact ? COMPACT_SPEEDS : SPEEDS;
  const bounds = useRef(trackBounds(rep));

  // ── drawing ──
  const buildStatic = useCallback(() => {
    const { w, h, dpr } = sizeRef.current;
    if (!w) return;
    const b = bounds.current, pad = 26;
    const scale = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxY - b.minY));
    const ox = (w - (b.maxX - b.minX) * scale) / 2, oy = (h - (b.maxY - b.minY) * scale) / 2;
    fitRef.current = { scale, X: (x) => ox + (x - b.minX) * scale, Y: (y) => oy + (b.maxY - y) * scale };
    const off = staticRef.current || (staticRef.current = document.createElement("canvas"));
    off.width = Math.round(w * dpr); off.height = Math.round(h * dpr);
    const g = off.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { X, Y } = fitRef.current;
    const path = (xs, ys, close) => { g.beginPath(); for (let i = 0; i < xs.length; i++) { const px = X(xs[i]), py = Y(ys[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); } if (close) g.closePath(); };
    g.lineJoin = "round"; g.lineCap = "round";
    path(rep.outline.x, rep.outline.y, true); g.strokeStyle = "rgba(255,255,255,0.14)"; g.lineWidth = 11; g.stroke();
    path(rep.outline.x, rep.outline.y, true); g.strokeStyle = "rgba(236,236,236,0.72)"; g.lineWidth = 1.6; g.stroke();
    if (rep.pit) {
      path(rep.pit.x, rep.pit.y, false); g.strokeStyle = "rgba(255,176,32,0.25)"; g.lineWidth = 7; g.stroke();
      path(rep.pit.x, rep.pit.y, false); g.strokeStyle = "rgba(255,176,32,0.85)"; g.lineWidth = 1.4; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
      const m = rep.pit.x.length >> 1;
      g.fillStyle = "rgba(255,176,32,0.9)"; g.font = "600 9px 'JetBrains Mono', monospace"; g.fillText("PIT", X(rep.pit.x[m]) + 7, Y(rep.pit.y[m]) - 7);
    }
    // start/finish: a short red bar across the track
    const sx = X(rep.sf.x), sy = Y(rep.sf.y), dx = rep.sf.dx, dy = -rep.sf.dy, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    g.beginPath(); g.moveTo(sx - nx * 9, sy - ny * 9); g.lineTo(sx + nx * 9, sy + ny * 9); g.strokeStyle = "#e10600"; g.lineWidth = 3; g.stroke();
    dirty.current = true;
  }, [rep]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fitRef.current) return;
    const { dpr } = sizeRef.current;
    const g = canvas.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (staticRef.current) g.drawImage(staticRef.current, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { X, Y } = fitRef.current, t = timeRef.current;
    if (outageAt(rep, t)) {
      g.font = "700 12px 'JetBrains Mono', monospace"; g.fillStyle = "rgba(255,176,32,0.95)"; g.textAlign = "center";
      g.fillText("NO POSITION DATA FOR THIS MOMENT (feed outage)", sizeRef.current.w / 2, 22); g.textAlign = "start";
    }
    const board = boardAt(rep, t);
    const top3 = new Set(board.filter((r) => r.pos <= 3 && !r.out).map((r) => r.code));
    const leader = board.find((r) => r.pos === 1 && !r.out)?.code;
    const hits = [];
    g.font = "600 9px 'JetBrains Mono', monospace";
    const pass = [[true, false], [false, false], [false, true]];                 // grey OUT cars first, then the field, then the top 3 on top
    for (const [outPass, topPass] of pass) {
      for (const car of rep.cars) {
        const st = carStateAt(rep, car, t);
        if (st.hidden || st.out !== outPass || (top3.has(car.code) || car.code === selRef.current || car.code === hoverRef.current) !== topPass) continue;
        const px = X(st.x), py = Y(st.y);
        const picked = car.code === selRef.current || car.code === hoverRef.current;
        hits.push({ code: car.code, px, py });
        g.beginPath(); g.arc(px, py, st.out ? 3.6 : picked ? 7 : 5.2, 0, 6.2832);
        g.fillStyle = st.out ? "#5a5a63" : car.colour; g.fill();
        if (topPass || picked) { g.lineWidth = picked ? 2.2 : 1.6; g.strokeStyle = "#fff"; g.stroke(); }
        if (picked || car.code === leader) {                                     // labels: the leader and the picked driver only
          g.fillStyle = st.out ? "#85858f" : "#ffffff"; g.fillText(car.code, px + (picked ? 10 : 8), py - 7);
        }
      }
    }
    hitRef.current = hits;
  }, [rep]);

  // ── clock + loop ──
  useEffect(() => {
    let raf = 0, last = performance.now(), uiLast = 0;
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      if (ctl.current.playing) {
        timeRef.current = Math.min(timeRef.current + dt * ctl.current.speed, rep.endT);
        dirty.current = true; uiDirty.current = true;
        if (timeRef.current >= rep.endT) { ctl.current.playing = false; setPlaying(false); }
      }
      if (dirty.current) { draw(); dirty.current = false; }
      if (uiDirty.current && now - uiLast > 150) { uiLast = now; uiDirty.current = false; setUi(snapshot(rep, timeRef.current)); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rep, draw]);

  // ── size ──
  useEffect(() => {
    const canvas = canvasRef.current, wrap = canvas?.parentElement;
    if (!canvas || !wrap) return undefined;
    const resize = () => {
      const w = Math.max(280, Math.round(wrap.clientWidth));
      const b = bounds.current, aspect = (b.maxY - b.minY) / (b.maxX - b.minX);
      const h = compact ? 300 : Math.round(Math.min(Math.max(w * Math.min(Math.max(aspect, 0.55), 1.05), 260), 560));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      buildStatic();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [buildStatic, compact]);

  // ── actions ──
  const seek = useCallback((t) => {
    if (deferPlay) return;
    timeRef.current = Math.min(Math.max(t, rep.startT), rep.endT);
    dirty.current = true; uiDirty.current = false; setUi(snapshot(rep, timeRef.current));
  }, [rep, deferPlay]);
  const toggle = useCallback(() => {
    if (deferPlay) { onPlayRequest?.(); return; }
    if (!ctl.current.playing && timeRef.current >= rep.endT) seek(rep.startT);
    ctl.current.playing = !ctl.current.playing; setPlaying(ctl.current.playing); uiDirty.current = true;
  }, [rep, seek, deferPlay, onPlayRequest]);
  const choose = useCallback((code) => {
    const next = selRef.current === code ? null : code;                // tap again to clear
    selRef.current = next; setSel(next); dirty.current = true;
  }, []);
  const pickAt = (e, radius) => {
    const rect = canvasRef.current.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bd = radius * radius;
    for (const h of hitRef.current) { const d = (h.px - x) ** 2 + (h.py - y) ** 2; if (d <= bd) { bd = d; best = h; } }
    return best;
  };
  const onCanvasMove = (e) => {
    if (e.pointerType === "touch") return;
    const code = pickAt(e, 14)?.code ?? null;
    if (hoverRef.current !== code) { hoverRef.current = code; dirty.current = true; canvasRef.current.style.cursor = code ? "pointer" : "default"; }
  };
  const onCanvasLeave = () => { if (hoverRef.current) { hoverRef.current = null; dirty.current = true; } };
  const onCanvasClick = (e) => { const h = pickAt(e, 22); if (h) choose(h.code); };      // 22 px: a comfortable finger target around a 10 px dot
  const chooseSpeed = useCallback((s) => { if (deferPlay) return; ctl.current.speed = s; setSpeed(s); }, [deferPlay]);
  const jumpLap = useCallback((delta) => {
    const cur = lapAt(rep, timeRef.current), next = Math.min(Math.max(cur + delta, 1), rep.lapsTotal);
    const ts = lapStartTime(rep, next);
    if (ts != null) seek(ts);
  }, [rep, seek]);

  const onKeyDown = (e) => {
    const tag = e.target.tagName;
    if (e.key === " " || e.code === "Space") {
      if (tag === "BUTTON" || tag === "INPUT") return;                         // let real controls handle their own space
      e.preventDefault(); toggle(); return;
    }
    if (tag === "INPUT") return;                                               // arrows move a focused slider natively
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) jumpLap(dir); else seek(timeRef.current + dir * STEP_S);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const i = speeds.indexOf(ctl.current.speed) + (e.key === "ArrowUp" ? 1 : -1);
      chooseSpeed(speeds[Math.min(Math.max(i, 0), speeds.length - 1)]);
    }
  };

  const span = rep.endT - rep.startT;
  const band = ui.band;
  const speedsEl = (
  <div className="rp-speeds" role="group" aria-label="Playback speed">
    {speeds.map((s) => <button key={s} type="button" className="rp-btn rp-sp" aria-pressed={speed === s} disabled={deferPlay} onClick={() => chooseSpeed(s)}>{s}x</button>)}
  </div>
  );
  const readoutEl = (
  <div className="rp-readout" aria-live="off">
    <span>LAP <b>{ui.lap || "–"}</b> OF {rep.lapsTotal}</span>
    <span className="rp-clock">{ui.clock}</span>
    {band && <span className={`rp-band ${band.kind}`}>{band.kind === "SC" ? "SAFETY CAR" : band.kind === "VSC" ? "VIRTUAL SAFETY CAR" : "RED FLAG"}</span>}
    {ui.outage && <span className="rp-band GAP" title="OpenF1 sent no usable positions for most cars at this moment">DATA GAP · NO POSITIONS</span>}
  </div>
  );

  const pct = (t) => `${(100 * (t - rep.startT)) / span}%`;
  const started = playing || ui.t > rep.startT + 0.5;
  const boardTitle = !started ? (projected && !preview ? "PREDICTED STARTING GRID" : "STARTING GRID") : projected ? "ORDER IN THIS ILLUSTRATION" : "ORDER · OFFICIAL POSITIONS";

  return (
    <div className={`rp${compact ? " rp-compact" : ""}`} ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Race replay player. Space plays or pauses, left and right arrows step ten seconds, shift with arrows steps a lap, up and down change speed.">
      <div className="rp-grid">
        <div className="rp-stage">
          <div className="rp-canvaswrap"><canvas ref={canvasRef} onPointerMove={onCanvasMove} onPointerLeave={onCanvasLeave} onClick={onCanvasClick} role="img" aria-label={projected ? `Track map of the ${rep.race.name} with the cars on the starting grid and, once played, the illustration` : `Track map of the ${rep.race.name} ${rep.race.year} with every car's recorded position`} /></div>

          <div className="rp-controls">
            <button type="button" className="rp-btn rp-play" onClick={toggle} disabled={loading} aria-busy={loading || undefined} aria-label={loading ? "Loading the replay" : playing ? "Pause replay" : "Play replay"}>{loading ? "LOADING…" : playing ? "❚❚ PAUSE" : "▶ PLAY"}</button>
            {!compact && <button type="button" className="rp-btn" onClick={() => jumpLap(-1)} aria-label="Previous lap">⏮ LAP</button>}
            <button type="button" className="rp-btn" onClick={() => seek(timeRef.current - STEP_S)} disabled={deferPlay} aria-label="Back ten seconds">−10 s</button>
            <button type="button" className="rp-btn" onClick={() => seek(timeRef.current + STEP_S)} disabled={deferPlay} aria-label="Forward ten seconds">+10 s</button>
            {!compact && <button type="button" className="rp-btn" onClick={() => jumpLap(1)} aria-label="Next lap">LAP ⏭</button>}
            {!compact && speedsEl}
          </div>

          {compact ? <div className="rp-row2">{speedsEl}{readoutEl}</div> : readoutEl}

          {!compact && <div className="rp-scrub">
            <div className="rp-marks" aria-hidden="true">
              {rep.bands.map((b, i) => <span key={i} className={`rp-mark ${b.kind}`} style={{ left: pct(Math.max(b.a, rep.startT)), width: `${(100 * (Math.min(b.b, rep.endT) - Math.max(b.a, rep.startT))) / span}%` }} title={b.kind === "SC" ? "Safety car" : b.kind === "VSC" ? "Virtual safety car" : "Red flag"} />)}
              {rep.outages.map((o, i) => <span key={`o${i}`} className="rp-mark GAP" style={{ left: pct(Math.max(o.a, rep.startT)), width: `${Math.max(0.4, (100 * (Math.min(o.b, rep.endT) - Math.max(o.a, rep.startT))) / span)}%` }} title="Data gap: no positions from the feed" />)}
              {rep.pits.map((p, i) => p.t >= rep.startT && p.t <= rep.endT && <span key={`p${i}`} className="rp-tick" style={{ left: pct(p.t) }} title={`${p.d} pit stop, lap ${p.lap}`} />)}
            </div>
            <label className="rp-range"><span>TIME</span>
              <input type="range" min={rep.startT} max={rep.endT} step={1} value={Math.round(ui.t)} onChange={(e) => seek(Number(e.target.value))} aria-label="Replay time" aria-valuetext={`Lap ${ui.lap || 0}, ${ui.clock}`} />
            </label>
            <label className="rp-range"><span>LAP</span>
              <input type="range" min={1} max={rep.lapsTotal} step={1} value={Math.max(ui.lap, 1)} onChange={(e) => { const ts = lapStartTime(rep, Number(e.target.value)); if (ts != null) seek(ts); }} aria-label="Jump to lap" aria-valuetext={`Lap ${Math.max(ui.lap, 1)} of ${rep.lapsTotal}`} />
            </label>
            <div className="rp-legend" aria-hidden="true">{!projected && <><i className="SC" /> safety car <i className="VSC" /> virtual SC <i className="RED" /> red flag <i className="GAP" /> data gap </>}<i className="tick" /> pit stop</div>
          </div>}
        </div>

        <OrderBoard rows={ui.board} mode={orderMode} onMode={setOrderMode} projected={projected} compact={compact} limit={compact ? 10 : null} note={!compact} selected={sel} onSelect={choose} grid={compact && !started} title={compact ? boardTitle : null} tires={stints ? tiresAt(rep, stints, ui.t) : null} />
      </div>
    </div>
  );
};

function snapshot(rep, t) {
  return { t, lap: lapAt(rep, t), clock: raceClock(rep, t), band: bandAt(rep, t), outage: outageAt(rep, t), board: boardAt(rep, t) };
}

export default ReplayPlayer;
