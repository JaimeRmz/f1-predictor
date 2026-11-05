import { useEffect, useRef, useState, useCallback } from "react";
import { TeamMark } from "./TeamMark.jsx";
import { carStateAt, boardAt, lapAt, lapStartTime, bandAt, outageAt, raceClock, trackBounds, gapLabel } from "../lib/replay.js";
import "../pages/replay.css";

const SPEEDS = [1, 4, 16, 64];
const STEP_S = 10;

// Canvas player. The animation loop (requestAnimationFrame) owns the clock in a ref and draws straight to the canvas; React state is
// touched only a few times a second (the readout, scrubbers and order board), never per frame.
const ReplayPlayer = ({ rep }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const staticRef = useRef(null);            // offscreen layer: outline, pit lane, start/finish
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const fitRef = useRef(null);
  const timeRef = useRef(rep.startT);
  const dirty = useRef(true);
  const uiDirty = useRef(true);
  const ctl = useRef({ playing: false, speed: 4 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [ui, setUi] = useState(() => snapshot(rep, rep.startT));

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
    const top3 = new Set(boardAt(rep, t).filter((r) => r.pos <= 3 && !r.out).map((r) => r.code));
    g.font = "600 9px 'JetBrains Mono', monospace";
    const pass = [[true, false], [false, false], [false, true]];                 // grey OUT cars first, then the field, then the top 3 on top
    for (const [outPass, topPass] of pass) {
      for (const car of rep.cars) {
        const st = carStateAt(rep, car, t);
        if (st.hidden || st.out !== outPass || top3.has(car.code) !== topPass) continue;
        const px = X(st.x), py = Y(st.y);
        g.beginPath(); g.arc(px, py, st.out ? 3.6 : 5.2, 0, 6.2832);
        g.fillStyle = st.out ? "#5a5a63" : car.colour; g.fill();
        if (topPass) { g.lineWidth = 1.6; g.strokeStyle = "#fff"; g.stroke(); }
        g.fillStyle = st.out ? "#85858f" : "#ececec"; g.fillText(car.code, px + 7, py - 6);
      }
    }
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
      const h = Math.round(Math.min(Math.max(w * Math.min(Math.max(aspect, 0.55), 1.05), 260), 560));
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
  }, [buildStatic]);

  // ── actions ──
  const seek = useCallback((t) => {
    timeRef.current = Math.min(Math.max(t, rep.startT), rep.endT);
    dirty.current = true; uiDirty.current = false; setUi(snapshot(rep, timeRef.current));
  }, [rep]);
  const toggle = useCallback(() => {
    if (!ctl.current.playing && timeRef.current >= rep.endT) seek(rep.startT);
    ctl.current.playing = !ctl.current.playing; setPlaying(ctl.current.playing); uiDirty.current = true;
  }, [rep, seek]);
  const chooseSpeed = useCallback((s) => { ctl.current.speed = s; setSpeed(s); }, []);
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
      const i = SPEEDS.indexOf(ctl.current.speed) + (e.key === "ArrowUp" ? 1 : -1);
      chooseSpeed(SPEEDS[Math.min(Math.max(i, 0), SPEEDS.length - 1)]);
    }
  };

  const span = rep.endT - rep.startT;
  const pct = (t) => `${(100 * (t - rep.startT)) / span}%`;
  const band = ui.band;

  return (
    <div className="rp" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Race replay player. Space plays or pauses, left and right arrows step ten seconds, shift with arrows steps a lap, up and down change speed.">
      <div className="rp-grid">
        <div className="rp-stage">
          <div className="rp-canvaswrap"><canvas ref={canvasRef} role="img" aria-label={`Track map of the ${rep.race.name} ${rep.race.year} with every car's recorded position`} /></div>

          <div className="rp-controls">
            <button type="button" className="rp-btn rp-play" onClick={toggle} aria-label={playing ? "Pause replay" : "Play replay"}>{playing ? "❚❚ PAUSE" : "▶ PLAY"}</button>
            <button type="button" className="rp-btn" onClick={() => jumpLap(-1)} aria-label="Previous lap">⏮ LAP</button>
            <button type="button" className="rp-btn" onClick={() => seek(timeRef.current - STEP_S)} aria-label="Back ten seconds">−10 s</button>
            <button type="button" className="rp-btn" onClick={() => seek(timeRef.current + STEP_S)} aria-label="Forward ten seconds">+10 s</button>
            <button type="button" className="rp-btn" onClick={() => jumpLap(1)} aria-label="Next lap">LAP ⏭</button>
            <div className="rp-speeds" role="group" aria-label="Playback speed">
              {SPEEDS.map((s) => <button key={s} type="button" className="rp-btn rp-sp" aria-pressed={speed === s} onClick={() => chooseSpeed(s)}>{s}x</button>)}
            </div>
          </div>

          <div className="rp-readout" aria-live="off">
            <span>LAP <b>{ui.lap || "–"}</b> OF {rep.lapsTotal}</span>
            <span className="rp-clock">{ui.clock}</span>
            {band && <span className={`rp-band ${band.kind}`}>{band.kind === "SC" ? "SAFETY CAR" : band.kind === "VSC" ? "VIRTUAL SAFETY CAR" : "RED FLAG"}</span>}
            {ui.outage && <span className="rp-band GAP" title="OpenF1 sent no usable positions for most cars at this moment">DATA GAP · NO POSITIONS</span>}
          </div>

          <div className="rp-scrub">
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
            <div className="rp-legend" aria-hidden="true"><i className="SC" /> safety car <i className="VSC" /> virtual SC <i className="RED" /> red flag <i className="GAP" /> data gap <i className="tick" /> pit stop</div>
          </div>
        </div>

        <aside className="rp-board" aria-label="Order board">
          <h2>Order <small>official positions</small></h2>
          <ol>
            {ui.board.map((r) => (
              <li key={r.code} className={`${r.out ? "out" : ""}${r.inPit ? " pit" : ""}${r.noData ? " nodata" : ""}`} style={{ "--team": r.colour }}>
                <b>{r.out ? "–" : r.pos}</b><i className="rp-bar" /><TeamMark team={r.team} size={18} /><span className="rp-code">{r.code}</span>
                <em title="Gap to the leader, as of the start of the current lap">{gapLabel(r)}</em>
              </li>
            ))}
          </ol>
          <p className="rp-note">Gaps update once a lap. Positions are the official feed; they can lag the dots by a moment. NO DATA means OpenF1 sent no position for that car just now.</p>
        </aside>
      </div>
    </div>
  );
};

function snapshot(rep, t) {
  return { t, lap: lapAt(rep, t), clock: raceClock(rep, t), band: bandAt(rep, t), outage: outageAt(rep, t), board: boardAt(rep, t) };
}

export default ReplayPlayer;
