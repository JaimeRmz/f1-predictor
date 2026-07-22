import { useState, useEffect, useRef, Fragment, lazy, Suspense } from "react";
import { MotionConfig } from "framer-motion";
import { StatCard } from "./shared.jsx";
import { prefersReducedMotion } from "./constants.js";
import { HealthProvider, useHealth } from "./health.jsx";
import { CAR_TARGET_COUNT, computeGeometry, sparseSampleTargets } from "./carSampling.js";

const PredictorPage = lazy(() => import("./pages/PredictorPage.jsx"));
const NextRacePage = lazy(() => import("./pages/NextRacePage.jsx"));
const WhatIfPage = lazy(() => import("./pages/WhatIfPage.jsx"));
const ChampionshipPage = lazy(() => import("./pages/ChampionshipPage.jsx"));
const DriversPage = lazy(() => import("./pages/DriversPage.jsx"));
const ComparePage = lazy(() => import("./pages/ComparePage.jsx"));
const Season2026Page = lazy(() => import("./pages/Season2026Page.jsx"));
const ModelPage = lazy(() => import("./pages/ModelPage.jsx"));

// Suspense fallback while a lazy page chunk downloads — styled like the
// existing loading treatments (thin sweep bar + telemetry label).
const PageLoader = () => (
  <div>
    <div className="loading-bar" />
    <p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.7rem", letterSpacing: "0.2em", fontWeight: "700", textAlign: "center", padding: "3rem 0" }}>LOADING MODULE...</p>
  </div>
);

// Live backend health readout for the header. Reads the shared health context
// (single poller in HealthProvider) so it, and every data page, agree on the
// same three states — including the cold-start WAKING state.
const HEALTH_UI = {
  online:  { color: "var(--green)", label: "ONLINE" },
  waking:  { color: "var(--amber)", label: "WAKING" },
  offline: { color: "var(--red)",   label: "OFFLINE" },
};
const HealthIndicator = () => {
  const { status } = useHealth();
  const ui = HEALTH_UI[status] || HEALTH_UI.offline;
  // Waking pulses a touch faster to read as "actively working".
  const pulse = status === "waking" ? "pulse 1.2s infinite" : "pulse 2s infinite";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: ui.color, animation: pulse }} />
      <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: ui.color, fontWeight: "700", letterSpacing: "0.1em" }}>
        {ui.label}
      </span>
    </div>
  );
};

// ── NAV ────────────────────────────────────────────────────────
const Nav = ({ page, setPage, onNavigate }) => {
  const links = ["Home", "Predictor", "Next Race 🇭🇺", "What-If 🎮", "Championship", "Drivers", "Compare", "2026 Season", "Model"];
  return (
    <nav style={{ background: "#080812", position: "sticky", top: 0, zIndex: 100 }}>
      <div className="nav-scroll" style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 2rem", display: "flex", overflowX: "auto" }}>
        {links.map(l => (
          <button key={l} onClick={() => { setPage(l); onNavigate(); }} className="nav-tab" style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0.9rem 1rem", fontSize: "0.7rem", fontWeight: "700",
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: page === l ? "var(--text)" : "var(--muted)",
            borderBottom: page === l ? "2px solid var(--red)" : "2px solid transparent",
            whiteSpace: "nowrap", fontFamily: "var(--sans)",
          }}>{l}</button>
        ))}
      </div>
    </nav>
  );
};

// ── PARTICLE ANIMATION (car silhouette → circuit) ──────────────
// Real traced Monaco circuit path, viewBox "0 0 1160 487".
const MONACO_CIRCUIT_VIEWBOX = { width: 1160, height: 487 };
const MONACO_CIRCUIT_PATH = "M812.099 169.095V218.095L792.599 254.595L745.599 259.595L664.099 " +
  "207.595L578.099 169.095L505.099 118.095L319.599 0.595495L207.599 " +
  "74.5955L143.099 144.095M25.0991 366.095L53.5991 272.095L70.7241 " +
  "246.345L87.8491 220.595L122.099 169.095L207.599 74.5955M53.5991 " +
  "272.095L18.0991 393.095L0.599052 419.095L33.5991 470.095L88.5991 " +
  "485.595L109.599 460.595L104.599 428.095L88.5991 387.595L122.099 " +
  "321.095L154.599 313.095L241.599 192.095V169.095L260.599 129.595L305.099 " +
  "102.595L334.599 96.0955L513.599 218.095L525.099 247.095L555.099 " +
  "254.595L563.599 247.095L648.599 306.595L861.099 387.595L937.099 " +
  "375.095L1054.6 313.095L1158.6 218.095C1158.6 213.295 1140.6 192.429 " +
  "1131.6 182.595L1083.6 159.595V124.595V110.095L1059.6 102.595C1048.8 " +
  "102.595 908.099 120.595 839.099 129.595L824.599 144.095L812.099 " +
  "159.595M1036.1 135.095L881.599 153.595L861.099 159.595L848.599 " +
  "169.095V182.595V218.095L833.099 254.595L812.099 279.595L782.099 " +
  "291.095L753.599 296.095L726.599 291.095L637.099 228.595L555.099 " +
  "192.095L453.099 129.595L326.099 36.0955L228.099 96.0955L143.099 " +
  "192.095L74.0991 313.095L46.0991 413.595L33.5991 428.095L74.0991 " +
  "449.095L66.0991 419.095V404.595V370.095C68.7657 363.762 74.0991 " +
  "349.495 74.0991 343.095C74.0991 336.695 81.0991 323.095 84.5991 " +
  "317.095L109.599 279.595L117.099 272.095H127.099L143.099 279.595L207.599 " +
  "182.595L203.099 161.095L212.599 135.095L247.099 102.595L285.599 " +
  "74.5955L326.099 60.0955H346.099L358.099 66.0955L402.099 102.595L446.599 " +
  "135.095L541.599 201.595L547.599 223.095L563.599 213.095H578.099L614.599 " +
  "241.095L670.599 279.595L726.599 306.595L775.599 321.095L855.599 " +
  "351.095H881.599L919.099 343.095L974.599 321.095L1045.1 279.595L1110.6 " +
  "224.595L1115.1 207.595L1092.1 192.095H1073.1H1059.6V223.095V247.095L1036.1 " +
  "259.595L1012.1 247.095V228.595L1025.6 207.595V174.595L1036.1 " +
  "153.595L1045.1 135.095";

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const lerpColor = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// Buckets a sampled car-body pixel's real RGB into one of four car-part
// tones, so assembled particles read as two-tone (red body + dark/grey
// detail) rather than uniformly one color.
const classifySourceColor = (r, g, b) => {
  if (r > 150 && g < 80 && b < 80) return [225, 6, 0]; // #E10600 red body
  if (r < 80 && g < 80 && b < 80) return [102, 102, 102]; // #666666 — brightened from near-black #1a1a1a so it's visible on the dark canvas background
  if (r > 100 && g > 100 && b > 100) return [136, 136, 136]; // #888888 grey sidepods
  return [204, 0, 0]; // #CC0000 default red
};

const clusterAround = (cx, cy, spread, count) => {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rad = Math.random() * spread;
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad * 0.7]);
  }
  return pts;
};

const alongLine = (x1, y1, x2, y2, count, jitter = 0.006) => {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    pts.push([
      x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter,
      y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter,
    ]);
  }
  return pts;
};

const withinCircle = (cx, cy, r, count) => {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * r;
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad]);
  }
  return pts;
};

// Fallback ~1500 normalized (0-1) target points across hand-placed car
// silhouette regions (nose, front wing, cockpit, engine cover, rear wing x2,
// body underside, front/rear wheels, sidepods). Used only if loading/sampling
// the real f1-car.png fails for any reason. Tagged with a uniform "red body"
// RGB so it still resolves through classifySourceColor like real PNG samples.
const buildFallbackCarTargets = () => [
  ...clusterAround(0.15, 0.45, 0.035, 113),         // nose/front
  ...alongLine(0.05, 0.52, 0.20, 0.52, 113),         // front wing
  ...clusterAround(0.42, 0.35, 0.03, 113),           // cockpit
  ...alongLine(0.35, 0.38, 0.65, 0.38, 188),         // engine cover
  ...alongLine(0.75, 0.28, 0.90, 0.28, 94),          // rear wing (upper)
  ...alongLine(0.75, 0.32, 0.90, 0.32, 94),          // rear wing (lower)
  ...alongLine(0.10, 0.50, 0.85, 0.50, 372),         // body underside
  ...withinCircle(0.22, 0.54, 0.04, 113),            // front wheel
  ...withinCircle(0.72, 0.54, 0.05, 131),            // rear wheel
  ...alongLine(0.40, 0.42, 0.68, 0.42, 169),         // sidepods
].map(([x, y]) => [x, y, 200, 20, 20, 0]);

// Car-silhouette sampling constants + the sparse sampler now live in
// ./carSampling.js (shared with carSampler.worker.js). CAR_TARGET_COUNT,
// computeGeometry and sparseSampleTargets are imported at the top.

// Memoized car targets, keyed by rounded canvas WxH — returning to the Home
// tab reuses the computed silhouette instead of re-sampling (A3).
const carTargetsCache = new Map();

// Sample in a Web Worker (OffscreenCanvas + createImageBitmap) so the 5x pixel
// read never touches the main thread (A4). A fresh worker per request is fine —
// memoization means this runs at most once per unique canvas size — and it's
// terminated on settle. A timeout guards against a worker that never responds.
const sampleViaWorker = (canvasW, canvasH) => new Promise((resolve, reject) => {
  let worker, done = false;
  const finish = (fn, arg) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { if (worker) worker.terminate(); } catch { /* already gone */ }
    fn(arg);
  };
  const timer = setTimeout(() => finish(reject, new Error("car sampler worker timed out")), 3000);
  try {
    worker = new Worker(new URL("./carSampler.worker.js", import.meta.url), { type: "module" });
  } catch (e) { finish(reject, e); return; }
  worker.onmessage = (e) => {
    if (e.data && e.data.ok) finish(resolve, e.data.pts);
    else finish(reject, new Error((e.data && e.data.error) || "car sampler worker failed"));
  };
  worker.onerror = (e) => finish(reject, new Error(e.message || "car sampler worker error"));
  worker.postMessage({ canvasW, canvasH });
});

// Main-thread fallback for browsers without Worker/OffscreenCanvas. Same sparse
// sampler; a single getImageData is the only notable cost, and it's bounded —
// no longer the old resolution-scaled scan of every pixel.
const sampleMainThread = (canvasW, canvasH) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    try {
      const geom = computeGeometry(img.naturalWidth, img.naturalHeight, canvasW, canvasH);
      const off = document.createElement("canvas");
      off.width = geom.hiW;
      off.height = geom.hiH;
      const offCtx = off.getContext("2d", { willReadFrequently: true });
      offCtx.clearRect(0, 0, geom.hiW, geom.hiH);
      offCtx.drawImage(img, geom.offsetX, geom.offsetY, geom.drawW, geom.drawH);
      const { data } = offCtx.getImageData(0, 0, geom.hiW, geom.hiH);
      resolve(sparseSampleTargets(data, geom));
    } catch (err) { reject(err); }
  };
  img.onerror = () => reject(new Error("failed to load /f1-car.png"));
  img.src = "/f1-car.png";
});

// Cached car targets for a given canvas size. Prefers the worker, falls back to
// the main thread, and memoizes the result across HomePage mounts.
const getCarTargets = (canvasW, canvasH) => {
  const key = `${canvasW}x${canvasH}`;
  const cached = carTargetsCache.get(key);
  if (cached) return Promise.resolve(cached);
  const canWorker = typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined";
  const attempt = canWorker
    ? sampleViaWorker(canvasW, canvasH).catch(() => sampleMainThread(canvasW, canvasH))
    : sampleMainThread(canvasW, canvasH);
  return attempt.then(pts => { carTargetsCache.set(key, pts); return pts; });
};

// Samples `count` evenly spaced points along an SVG path string using the
// browser's own path geometry (no external library needed). The path's
// viewBox is wide/landscape (1160x487) while the canvas is roughly square,
// so points are letterboxed (uniformly scaled + centered, aspect preserved)
// into the canvas's actual dimensions rather than being stretched to fill it.
// Returns both the sampled target points AND a reusable `fractionAtT(t)`
// function (t = 0..1 progress along the path) using the same getPointAtLength
// + letterbox transform, so the lap dot can travel the exact same shape the
// particles assembled into, expressed as canvas-agnostic 0-1 fractions.
const samplePathPoints = (d, count, viewBox, canvasW, canvasH) => {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  const length = path.getTotalLength();
  console.log("[AnimatedCanvas] circuit path getTotalLength():", length);
  if (!length) throw new Error("SVGPathElement.getTotalLength() returned 0 — path unusable");

  const scale = Math.min(canvasW / viewBox.width, canvasH / viewBox.height);
  const offsetX = (canvasW - viewBox.width * scale) / 2;
  const offsetY = (canvasH - viewBox.height * scale) / 2;

  const fractionAtT = t => {
    const p = path.getPointAtLength(t * length);
    return [(p.x * scale + offsetX) / canvasW, (p.y * scale + offsetY) / canvasH];
  };

  // Raw canvas-pixel-space (not yet normalized) point at path fraction t,
  // used only for building the 3-row track width below — fractionAtT above
  // (centerline only) stays untouched since the lap dot depends on it.
  const rawPointAt = t => {
    const clamped = Math.max(0, Math.min(1, t));
    const p = path.getPointAtLength(clamped * length);
    return [p.x * scale + offsetX, p.y * scale + offsetY];
  };

  // Sample count/3 points along the centerline, and for each one also place
  // a point offset +/-3px perpendicular to the path's direction of travel,
  // so the circuit reads as a track with visible width rather than a single
  // hairline. Row 0 = centerline, row 1 = +3px, row 2 = -3px.
  const TRACK_OFFSET_PX = 3;
  const rowOffsets = [0, TRACK_OFFSET_PX, -TRACK_OFFSET_PX];
  const centerCount = Math.round(count / rowOffsets.length);

  const pts = [];
  for (let i = 0; i < centerCount; i++) {
    const t = i / centerCount;
    const [cx, cy] = rawPointAt(t);
    const [tx1, ty1] = rawPointAt(t - 0.001);
    const [tx2, ty2] = rawPointAt(t + 0.001);
    let dx = tx2 - tx1, dy = ty2 - ty1;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= mag; dy /= mag;
    const perpX = -dy, perpY = dx; // tangent rotated 90 degrees

    for (let row = 0; row < rowOffsets.length; row++) {
      const off = rowOffsets[row];
      const px = cx + perpX * off;
      const py = cy + perpY * off;
      pts.push([px / canvasW, py / canvasH, row]);
    }
  }

  return { points: pts, fractionAtT };
};

// Plain ellipse fallback used if SVG path sampling fails for any reason, so a
// single geometry error can never blank out the whole animation. Also exposes
// a matching fractionAtT so the lap dot works the same way in fallback mode.
// Every point is tagged row 0 (no track-width offset here, just the single
// ellipse) so it still renders with the "center row" bright color.
const buildFallbackCircuitTargets = count => {
  const fractionAtT = t => {
    const angle = t * Math.PI * 2;
    return [0.5 + Math.cos(angle) * 0.38, 0.5 + Math.sin(angle) * 0.32];
  };
  const pts = [];
  for (let i = 0; i < count; i++) {
    const [x, y] = fractionAtT(i / count);
    pts.push([x, y, 0]);
  }
  return { points: pts, fractionAtT };
};

const STAGE1_END = 1000; // scatter
const STAGE2_END = 3000; // assemble into car
const STAGE3_END = 5000; // hold + drive
const STAGE4_END = 7000; // disintegrate into circuit

// Debug-log labels for each stage boundary, keyed by the elapsed threshold
// that was just crossed — used to log each transition exactly once.
const STAGE_TRANSITION_LOGS = {
  [STAGE1_END]: "STAGE: scatter → assemble",
  [STAGE2_END]: "STAGE: assemble → hold",
  [STAGE3_END]: "STAGE: hold → disintegrate",
  [STAGE4_END]: "STAGE: disintegrate → circuit",
};

// Physically-inspired car lighting: overhead-lit top surface (brightened
// toward white), normally-lit mid body (source color as-is), shadowed
// underfloor (darkened toward black), and a rim-light kick on top edge
// particles where the body silhouette catches the light against the dark
// background. Computed once per particle at creation time since carY/isEdge/
// sourceColor never change after that.
const applyCarLighting = (carY, isEdge, sourceColor) => {
  const [sr, sg, sb] = sourceColor;
  let r, g, b, opacity;

  if (carY < 0.35) {
    r = Math.min(255, sr + 80);
    g = Math.min(255, sg + 40);
    b = Math.min(255, sb + 40);
    opacity = 1.0;
  } else if (carY <= 0.65) {
    r = sr; g = sg; b = sb;
    opacity = 0.95;
  } else {
    r = Math.floor(sr * 0.5);
    g = Math.floor(sg * 0.5);
    b = Math.floor(sb * 0.5);
    opacity = 0.8;
  }

  // Top edge particles catch a rim light; bottom edge particles stay as
  // dark as the underfloor shading above already made them (no extra pass).
  if (isEdge && carY < 0.4) {
    r += (255 - r) * 0.5;
    g += (255 - g) * 0.5;
    b += (255 - b) * 0.5;
  }

  return { color: [Math.round(r), Math.round(g), Math.round(b)], opacity };
};

// Edge particles stay small/crisp for a sharp outline; interior particles are
// a little larger for a soft filled-texture feel. Pseudo-3D depth cue on top:
// lower-on-car (wheels/ground) reads larger/closer, upper (wings/top) reads
// smaller/further away — a continuous multiplier rather than banded steps.
const particleRadius = p => {
  const base = p.isEdge ? 0.8 : 1.2;
  const depthMult = 0.8 + 0.4 * p.carY;
  return base * depthMult;
};

// Perf guards for the newer (mouse/shimmer/trail) effects layered on top of
// the core stage logic below — each is skip-gated independently so a slow
// frame or a low-power device degrades gracefully instead of compounding.
const REPULSE_DT_LIMIT_MS = 33;
const SHIMMER_MIN_WIDTH = 600;
const MOTION_BLUR_MAX_PARTICLES = 1500;

const updateParticles = (particles, elapsed, { width, height }, dt = 0, mouse = null) => {
  const n = particles.length;
  const allowMotionBlur = n <= MOTION_BLUR_MAX_PARTICLES;
  const allowShimmer = width >= SHIMMER_MIN_WIDTH;
  const allowRepulsion = mouse && mouse.active && dt <= REPULSE_DT_LIMIT_MS;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    if (elapsed < STAGE1_END) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
      p.x = Math.max(0, Math.min(width, p.x));
      p.y = Math.max(0, Math.min(height, p.y));
      p.radius = 1;
      p.color = [255, 255, 255];
      p.alpha = 0.3;
      p.trailActive = false;
    } else if (elapsed < STAGE2_END) {
      if (!p.scattered) { p.scatterX = p.x; p.scatterY = p.y; p.scattered = true; }
      const t = (elapsed - STAGE1_END) / (STAGE2_END - STAGE1_END);
      const e = easeInOutCubic(t);
      const targetX = p.carX * width, targetY = p.carY * height;
      p.x = p.scatterX + (targetX - p.scatterX) * e;
      p.y = p.scatterY + (targetY - p.scatterY) * e;
      p.radius = particleRadius(p);
      p.color = lerpColor([255, 255, 255], p.litColor, e);
      p.alpha = 0.3 + (p.litOpacity - 0.3) * e;

      // Motion-blur trail: "speed" here is distance-still-to-cover (dx/dy to
      // the target), per the requested formula — it shrinks toward 0 as the
      // particle nears its target, which is what makes the trail fade out.
      // The requested draw offset (dx*trailLength) is dimensionally a pixel
      // distance times a pixel length, which would blow up to thousands of
      // px early in the animation — so it's normalized to a unit direction
      // before scaling by trailLength, keeping the same fade behavior
      // without the runaway offset.
      if (allowMotionBlur) {
        try {
          const dx = targetX - p.x, dy = targetY - p.y;
          const speed = Math.sqrt(dx * dx + dy * dy);
          const trailLength = Math.min(speed * 3, 30);
          if (speed > 0.001 && trailLength > 0.5) {
            const dirX = dx / speed, dirY = dy / speed;
            p.trailActive = true;
            p.trailX = p.x - dirX * trailLength;
            p.trailY = p.y - dirY * trailLength;
            p.trailOpacity = 0.4 * (1 - e);
          } else {
            p.trailActive = false;
          }
        } catch {
          p.trailActive = false;
        }
      } else {
        p.trailActive = false;
      }
    } else if (elapsed < STAGE3_END) {
      const stageElapsed = elapsed - STAGE2_END;
      const shift = -8 * Math.sin(Math.PI * (stageElapsed / (STAGE3_END - STAGE2_END)));
      p.x = p.carX * width + shift;
      p.y = p.carY * height;
      p.radius = particleRadius(p);
      p.color = p.litColor;
      p.alpha = p.litOpacity;
      p.trailActive = false;
    } else if (elapsed < STAGE4_END) {
      if (!p.disintegrating) { p.holdX = p.carX * width; p.holdY = p.carY * height; p.disintegrating = true; }
      const t = (elapsed - STAGE3_END) / (STAGE4_END - STAGE3_END);
      const e = easeInOutCubic(t);
      const targetX = p.circuitX * width, targetY = p.circuitY * height;
      p.x = p.holdX + (targetX - p.holdX) * e;
      p.y = p.holdY + (targetY - p.holdY) * e;
      p.radius = 1.2;
      p.color = lerpColor(p.litColor, [190, 190, 200], e);
      p.alpha = p.litOpacity - 0.4 * e;
      p.trailActive = false;
    } else {
      p.x = p.circuitX * width;
      p.y = p.circuitY * height;
      p.radius = 1.2 + 0.3 * Math.sin(elapsed / 600 + p.phase);
      if (p.circuitRow === 0) {
        p.color = [200, 200, 200];
        p.alpha = 0.9;
      } else {
        p.color = [150, 150, 150];
        p.alpha = 0.6;
      }
      p.trailActive = false;

      // Heat shimmer: a narrow band of extra brightness that travels once
      // around the circuit every 4s, based on this particle's position (i/n)
      // along the lap versus the wave's current position.
      if (allowShimmer) {
        try {
          const fraction = i / n;
          const wavePos = ((elapsed - STAGE4_END) / 4000) % 1.0;
          let dist = Math.abs(fraction - wavePos);
          if (dist > 0.5) dist = 1 - dist;
          const shimmer = Math.max(0, 1 - dist * 8);
          p.alpha = Math.min(1, p.alpha + shimmer * 0.4);
        } catch {
          // shimmer is purely cosmetic — leave p.alpha as already set above
        }
      }
    }

    // Cursor/touch repulsion: applies in every stage, nudging particles away
    // from the pointer. The 0.003 constant in the spec assumes normalized
    // (0-1) coordinates; this codebase's particle x/y are absolute canvas
    // pixels, so the force is scaled by canvas width to stay perceptible.
    if (allowRepulsion) {
      try {
        const mdx = p.x - mouse.x, mdy = p.y - mouse.y;
        const dist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (dist > 0 && dist < 80) {
          const force = (1 - dist / 80) * 0.003 * width;
          const angle = Math.atan2(mdy, mdx);
          p.x += Math.cos(angle) * force;
          p.y += Math.sin(angle) * force;
        }
      } catch {
        // repulsion is purely cosmetic — skip this particle's nudge on error
      }
    }
  }
};

// HOLD stages: car hold+drive (STAGE2_END-STAGE3_END) and the indefinite
// circuit hold (STAGE4_END+). Trails are suppressed and glow is a fixed
// subtle value during these — everywhere else particles are in motion, so
// trails trace their movement and glow scales with how fast they're moving.
const isHoldStage = elapsed => (elapsed >= STAGE2_END && elapsed < STAGE3_END) || elapsed >= STAGE4_END;

const BACKGROUND_GRID_SPACING = 40;
const BACKGROUND_GRID_MIN_WIDTH = 600; // perf guard: skip the grid entirely below this canvas width

// Static ambient background points, built once at setup — a subset (~1-in-4,
// randomized here rather than every literal 4th index) gets a slow pulsing
// brightness so the background doesn't read as completely static.
//
// The ~75% that never change (constant alpha 0.06) are baked ONCE into an
// offscreen canvas at device resolution; each frame we blit that in a single
// drawImage instead of re-stroking ~300 identical arcs. Only the ~25% pulsing
// dots are redrawn live. Dots never overlap (40px spacing, 0.8px radius), so
// splitting static-vs-live and compositing them in either order is pixel-for-
// pixel identical to drawing them all inline.
const buildBackgroundGrid = (width, height, dpr) => {
  const staticCanvas = document.createElement("canvas");
  staticCanvas.width = Math.max(1, Math.round(width * dpr));
  staticCanvas.height = Math.max(1, Math.round(height * dpr));
  const sctx = staticCanvas.getContext("2d");
  sctx.scale(dpr, dpr);
  sctx.fillStyle = "rgba(255,255,255,0.06)";
  const brightPoints = [];
  let i = -1; // preserves each point's original row-major index for its pulse phase
  for (let y = 0; y <= height; y += BACKGROUND_GRID_SPACING) {
    for (let x = 0; x <= width; x += BACKGROUND_GRID_SPACING) {
      i++;
      if (Math.random() < 0.25) {
        brightPoints.push({ x, y, i });
      } else {
        sctx.beginPath();
        sctx.arc(x, y, 0.8, 0, Math.PI * 2);
        sctx.fill();
      }
    }
  }
  return { staticCanvas, brightPoints };
};

const drawBackgroundGrid = (ctx, grid, elapsed, { width, height }) => {
  if (width < BACKGROUND_GRID_MIN_WIDTH) return;
  // One blit for every static dot (baked at device resolution → 1:1, no resample).
  ctx.drawImage(grid.staticCanvas, 0, 0, width, height);
  // Only the pulsing subset is stroked live.
  for (const pt of grid.brightPoints) {
    const wave = 0.5 + 0.5 * Math.sin(elapsed / 2000 + pt.i);
    const alpha = 0.04 + wave * (0.10 - 0.04);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
};

// Replaces a flat clearRect with a subtle environmental atmosphere: a
// top-to-bottom gradient (doubles as the frame clear, since it covers every
// pixel), a warm ground-glow suggestion beneath the car during its HOLD
// stage (fading out as it disintegrates), and a faint overhead track-light
// radial highlight.
const drawAtmosphere = (ctx, elapsed, { width, height }) => {
  // Flat fill, no gradient — matches the page background (#080812) exactly
  // so there's no seam between the canvas and the surrounding page chrome.
  ctx.fillStyle = "#080812";
  ctx.fillRect(0, 0, width, height);

  let groundAlpha = 0;
  if (elapsed >= STAGE2_END && elapsed < STAGE3_END) {
    groundAlpha = 1;
  } else if (elapsed >= STAGE3_END && elapsed < STAGE4_END) {
    groundAlpha = Math.max(0, 1 - (elapsed - STAGE3_END) / (STAGE4_END - STAGE3_END));
  }
  if (groundAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = groundAlpha;
    const ground = ctx.createLinearGradient(0, height * 0.6, 0, height * 0.75);
    ground.addColorStop(0, "rgba(30, 8, 4, 0.15)");
    ground.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = ground;
    ctx.fillRect(0, height * 0.6, width, height * 0.15);
    ctx.restore();
  }

  const overhead = ctx.createRadialGradient(
    width * 0.55, height * 0.1, 0,
    width * 0.55, height * 0.1, width * 0.4,
  );
  overhead.addColorStop(0, "rgba(255, 240, 220, 0.04)");
  overhead.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = overhead;
  ctx.fillRect(0, 0, width, height);
};

const drawParticles = (ctx, particles, elapsed, dims, gridPoints) => {
  drawAtmosphere(ctx, elapsed, dims); // replaces the flat clearRect — also serves as the frame clear
  drawBackgroundGrid(ctx, gridPoints, elapsed, dims); // drawn first so it sits behind everything else
  const holding = isHoldStage(elapsed);

  // Idle "breathing" during the car HOLD stage: a couple of px of vertical
  // drift applied only at draw time, never written back to p.y, so it never
  // affects the underlying assemble/disintegrate math.
  let idleOffset = 0;
  if (elapsed >= STAGE2_END && elapsed < STAGE3_END) {
    try {
      idleOffset = Math.sin(elapsed / 800) * 2;
    } catch {
      idleOffset = 0;
    }
  }

  for (const p of particles) {
    const vx = p.x - p.prevX;
    const vy = p.y - p.prevY;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const drawY = p.y + idleOffset;

    if (!holding) {
      ctx.beginPath();
      ctx.moveTo(p.prevX, p.prevY);
      ctx.lineTo(p.x, drawY);
      ctx.strokeStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},0.15)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Motion-blur trail during Stage 2 (ASSEMBLE): a short streak from the
    // particle's recent position to its current one, white fading to its
    // own source color, capped and skipped above for large particle counts.
    if (p.trailActive) {
      try {
        const grad = ctx.createLinearGradient(p.trailX, p.trailY, p.x, drawY);
        grad.addColorStop(0, `rgba(255,255,255,${p.trailOpacity})`);
        grad.addColorStop(1, `rgba(${p.sourceColor[0]},${p.sourceColor[1]},${p.sourceColor[2]},${p.trailOpacity})`);
        ctx.beginPath();
        ctx.moveTo(p.trailX, p.trailY);
        ctx.lineTo(p.x, drawY);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
      } catch {
        // trail is purely cosmetic — skip it for this particle on error
      }
    }

    // Skip the (comparatively expensive) shadow draw entirely for particles
    // that are effectively stationary, rather than just setting blur to ~0.
    if (holding) {
      ctx.shadowBlur = 2;
      ctx.shadowColor = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha})`;
    } else if (speed > 0.001) {
      ctx.shadowBlur = Math.min(speed * 800, 12);
      ctx.shadowColor = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha})`;
    }

    ctx.beginPath();
    ctx.arc(p.x, drawY, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha})`;
    ctx.fill();

    ctx.shadowBlur = 0; // reset so it can't bleed onto the next particle

    p.prevX = p.x;
    p.prevY = p.y;
  }
};

const REFLECTION_MIRROR_SCALE = 0.4; // compressed reflection: 40% of actual distance below the mirror line
const REFLECTION_MAX_FRAC = 0.95; // never draw a reflection dot past 95% of canvas height
const REFLECTION_FADE_DIST = 0.15; // reflection fades to 0 opacity over this many canvas-heights below the mirror line
const REFLECTION_FADE_OUT_MS = 1000; // fades out over the first second of DISINTEGRATE

// Mirrored ground reflection beneath the car, visible during HOLD (stage 3)
// and fading out over the first second of DISINTEGRATE (stage 4). Batches
// the whole layer under one globalAlpha (the stage-level fade) rather than
// reassigning it per particle — the per-particle distance fade is instead
// baked into each dot's own fillStyle alpha.
const drawGroundReflection = (ctx, particles, elapsed, { height }) => {
  let fadeMultiplier;
  if (elapsed >= STAGE2_END && elapsed < STAGE3_END) {
    fadeMultiplier = 1;
  } else if (elapsed >= STAGE3_END && elapsed < STAGE3_END + REFLECTION_FADE_OUT_MS) {
    fadeMultiplier = 1 - (elapsed - STAGE3_END) / REFLECTION_FADE_OUT_MS;
  } else {
    return;
  }

  let maxCarY = -Infinity;
  for (const p of particles) if (p.carY > maxCarY) maxCarY = p.carY;
  if (!isFinite(maxCarY)) return;

  ctx.save();
  ctx.globalAlpha = fadeMultiplier;
  for (const p of particles) {
    const reflectYFrac = maxCarY + (maxCarY - p.carY) * REFLECTION_MIRROR_SCALE;
    if (reflectYFrac >= REFLECTION_MAX_FRAC) continue;
    const dist = reflectYFrac - maxCarY;
    const fade = Math.max(0, 1 - dist / REFLECTION_FADE_DIST);
    const opacity = 0.15 * fade;
    if (opacity <= 0) continue;
    ctx.beginPath();
    ctx.arc(p.x, reflectYFrac * height, 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${opacity})`;
    ctx.fill();
  }
  ctx.restore();
};

const GROUND_SHADOW_FADE_IN_MS = 500; // fades in over the first 500ms of HOLD
const GROUND_SHADOW_CENTER_X = 0.52, GROUND_SHADOW_CENTER_Y = 0.68; // fraction of canvas
const GROUND_SHADOW_RADIUS_X = 0.28, GROUND_SHADOW_RADIUS_Y = 0.02; // fraction of canvas

// Soft elliptical contact shadow directly beneath the car during HOLD,
// separate from the mirrored drawGroundReflection above — this one is a
// grounding cue (a shadow), not a reflection. Canvas 2D has no native
// elliptical radial gradient, so it's faked by scaling the y-axis around a
// circular gradient via translate+scale.
const drawGroundShadow = (ctx, elapsed, { width, height }) => {
  let alpha;
  if (elapsed >= STAGE2_END && elapsed < STAGE3_END) {
    alpha = Math.min(1, (elapsed - STAGE2_END) / GROUND_SHADOW_FADE_IN_MS);
  } else if (elapsed >= STAGE3_END && elapsed < STAGE4_END) {
    alpha = Math.max(0, 1 - (elapsed - STAGE3_END) / (STAGE4_END - STAGE3_END));
  } else {
    return;
  }
  if (alpha <= 0) return;

  const cx = GROUND_SHADOW_CENTER_X * width;
  const cy = GROUND_SHADOW_CENTER_Y * height;
  const rx = GROUND_SHADOW_RADIUS_X * width;
  const ry = GROUND_SHADOW_RADIUS_Y * height;
  if (rx <= 0 || ry <= 0) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0, `rgba(0,0,0,${0.4 * alpha})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// Particle mesh networking: thin connecting lines between nearby particles so
// the car/circuit read as continuous surfaces rather than disconnected dots.
// NOTE: particle x/y are already absolute canvas-pixel coordinates in this
// codebase (not 0-1 fractions), so distances are computed directly on them
// without an extra *canvasW/*canvasH multiplication.

const CAR_MESH_MIN_WIDTH = 600; // perf guard: skip entirely on narrow/mobile canvases
const CAR_MESH_CELL_SIZE = 20;
const CAR_MESH_MAX_DIST = 18;
const CAR_MESH_FADE_MS = 500;

// Fades in over the last 500ms of ASSEMBLE, full through HOLD, fades out
// over the first 500ms of DISINTEGRATE, zero everywhere else.
const carMeshFade = elapsed => {
  if (elapsed < STAGE2_END - CAR_MESH_FADE_MS) return 0;
  if (elapsed < STAGE2_END) return (elapsed - (STAGE2_END - CAR_MESH_FADE_MS)) / CAR_MESH_FADE_MS;
  if (elapsed < STAGE3_END) return 1;
  if (elapsed < STAGE3_END + CAR_MESH_FADE_MS) return Math.max(0, 1 - (elapsed - STAGE3_END) / CAR_MESH_FADE_MS);
  return 0;
};

// Spatial-grid proximity pass (cell = CAR_MESH_CELL_SIZE) so checking ~1500
// particles costs roughly particles × (9 cells worth of neighbors) instead
// of particles². Segments are batched into a handful of Path2Ds bucketed by
// (quantized) opacity, so there are only a few stroke() calls per frame
// rather than one per connected pair.
const drawCarMesh = (ctx, particles, elapsed, dt, { width }) => {
  if (width < CAR_MESH_MIN_WIDTH) return;
  if (dt > 33) return; // frame rate guard: skip this frame if we're already below ~30fps

  const fade = carMeshFade(elapsed);
  if (fade <= 0) return;

  const grid = new Map();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const key = `${Math.floor(p.x / CAR_MESH_CELL_SIZE)},${Math.floor(p.y / CAR_MESH_CELL_SIZE)}`;
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(i);
  }

  const maxDistSq = CAR_MESH_MAX_DIST * CAR_MESH_MAX_DIST;
  const buckets = new Map(); // quantized opacity -> Path2D

  for (let i = 0; i < particles.length; i++) {
    const pi = particles[i];
    const cx = Math.floor(pi.x / CAR_MESH_CELL_SIZE);
    const cy = Math.floor(pi.y / CAR_MESH_CELL_SIZE);
    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddy = -1; ddy <= 1; ddy++) {
        const cell = grid.get(`${cx + ddx},${cy + ddy}`);
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue; // only j > i, avoid checking/drawing each pair twice
          const pj = particles[j];
          const dx = pi.x - pj.x, dy = pi.y - pj.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= maxDistSq) continue;
          const dist = Math.sqrt(distSq);
          const opacity = (1 - dist / CAR_MESH_MAX_DIST) * 0.25 * fade;
          if (opacity <= 0.005) continue;
          const bucketKey = Math.round(opacity * 50); // quantize to steps of 0.02
          let path = buckets.get(bucketKey);
          if (!path) { path = new Path2D(); buckets.set(bucketKey, path); }
          path.moveTo(pi.x, pi.y);
          path.lineTo(pj.x, pj.y);
        }
      }
    }
  }

  ctx.save();
  ctx.lineWidth = 0.4;
  for (const [bucketKey, path] of buckets) {
    ctx.strokeStyle = `rgba(255,255,255,${bucketKey / 50})`;
    ctx.stroke(path);
  }
  ctx.restore();
};

const CIRCUIT_MESH_DIST_1 = 25; // connect same-row, next-point particles under this distance
const CIRCUIT_MESH_DIST_2 = 40; // connect same-row, point-after-next particles under this distance
// samplePathPoints pushes 3 consecutive entries per path point (row 0, 1, 2 —
// see rowOffsets there) before advancing to the next point, so flat indices
// i/i+1/i+2 are the SAME point's 3 across-track rows, not along-path
// neighbors. Stepping by ROWS_PER_POINT (=3) instead moves to the next
// point in the same row, which is what "adjacent along the path" means here.
const ROWS_PER_POINT = 3;

// Circuit particles are already path-ordered (see samplePathPoints), so
// instead of a spatial grid this just checks same-row index-adjacent
// particles — O(n), no grid needed. Segments are batched by (color, opacity,
// lineWidth) so there are only a handful of stroke() calls regardless of
// particle count.
const drawCircuitMesh = (ctx, particles, elapsed, dt) => {
  if (elapsed < STAGE4_END) return; // only during the settled circuit hold
  if (dt > 33) return; // frame rate guard

  const n = particles.length;
  const buckets = new Map();
  const addSegment = (pi, pj, opacity, lineWidth) => {
    const [r, g, b] = pi.color;
    const key = `${r},${g},${b}|${opacity}|${lineWidth}`;
    let entry = buckets.get(key);
    if (!entry) { entry = { path: new Path2D(), color: [r, g, b], opacity, lineWidth }; buckets.set(key, entry); }
    entry.path.moveTo(pi.x, pi.y);
    entry.path.lineTo(pj.x, pj.y);
  };

  for (let i = 0; i < n; i++) {
    const pi = particles[i];
    const j1 = i + ROWS_PER_POINT;
    if (j1 < n) {
      const pj = particles[j1];
      if (Math.hypot(pi.x - pj.x, pi.y - pj.y) < CIRCUIT_MESH_DIST_1) addSegment(pi, pj, 0.3, 0.6);
    }
    const j2 = i + ROWS_PER_POINT * 2;
    if (j2 < n) {
      const pj2 = particles[j2];
      if (Math.hypot(pi.x - pj2.x, pi.y - pj2.y) < CIRCUIT_MESH_DIST_2) addSegment(pi, pj2, 0.12, 0.3);
    }
  }

  ctx.save();
  for (const { path, color, opacity, lineWidth } of buckets.values()) {
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${opacity})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke(path);
  }
  ctx.restore();
};

const LAP_DURATION_MS = 8000; // one full lap of the circuit

// Single bright dot simulating a car lapping the circuit, once the circuit has
// fully formed (after STAGE4_END). Loops continuously via the modulo below.
const LAP_DOT_GHOST_COUNT = 8;
const LAP_DOT_GHOST_STEP = 0.006; // lap-fraction spacing between ghost dots

const drawLapDot = (ctx, fractionAtT, elapsed, { width, height }) => {
  if (!fractionAtT || elapsed < STAGE4_END) return;
  const t = ((elapsed - STAGE4_END) % LAP_DURATION_MS) / LAP_DURATION_MS;

  try {
    for (let i = LAP_DOT_GHOST_COUNT; i >= 1; i--) {
      let ghostT = t - i * LAP_DOT_GHOST_STEP;
      if (ghostT < 0) ghostT += 1;
      const [gx, gy] = fractionAtT(ghostT);
      ctx.beginPath();
      ctx.arc(gx * width, gy * height, Math.max(0.5, 4 - i * 0.3), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(225,6,0,${(1 - i / LAP_DOT_GHOST_COUNT) * 0.4})`;
      ctx.fill();
    }
  } catch {
    // ghost trail is purely cosmetic — main dot below still draws
  }

  const [fx, fy] = fractionAtT(t);
  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#E10600";
  ctx.beginPath();
  ctx.arc(fx * width, fy * height, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#E10600";
  ctx.fill();
  ctx.restore();
};

const FRAME_INTERVAL = 1000 / 60;

const AnimatedCanvas = () => {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const dimsRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef(null);
  const circuitFractionRef = useRef(null);
  const gridPointsRef = useRef([]);
  const mouseRef = useRef({ x: -1, y: -1, active: false });
  // Set in reduced-motion mode: redraws the static circuit frame (a resize
  // clears the canvas, so the ResizeObserver must be able to re-render it).
  const staticRedrawRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { console.error("[AnimatedCanvas] canvasRef.current is null on mount"); return; }
    const container = canvas.parentElement;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      const rect = container.getBoundingClientRect();
      // Round to whole pixels: comparing raw sub-pixel floats from
      // getBoundingClientRect against a stored value can flip-flop by
      // fractions of a pixel indefinitely (font metrics, layout rounding),
      // which would otherwise keep re-triggering canvas writes forever.
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === dimsRef.current.width && height === dimsRef.current.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap render resolution on high-DPI screens
      dimsRef.current = { width, height };
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticRedrawRef.current?.();
    };
    resize();
    console.log("[AnimatedCanvas] container:", container.offsetWidth, "x", container.offsetHeight);
    // Fallback in case the ResizeObserver's first callback fires before the
    // container has real layout dimensions (e.g. 0x0 on mount).
    const fallbackTimeout = setTimeout(() => {
      console.log("[AnimatedCanvas] fallback resize, container now:", container.offsetWidth, "x", container.offsetHeight);
      resize();
    }, 150);
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let cancelled = false;

    // Simple, non-particle loading indicator (pulsing red dot) drawn directly
    // with ctx while we wait for real data — runs on its own rAF loop,
    // completely independent of the particle system below.
    let loadingRafId = null;
    const drawLoadingState = now => {
      const { width, height } = dimsRef.current;
      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 300));
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(225,6,0,${pulse})`;
        ctx.fill();
      }
      loadingRafId = requestAnimationFrame(drawLoadingState);
    };
    loadingRafId = requestAnimationFrame(drawLoadingState);

    // Don't attempt anything until the canvas has real, non-zero dimensions
    // (resize() already runs synchronously above and forces layout via
    // getBoundingClientRect, so this should normally resolve on attempt 0 —
    // but polls up to 1s just in case something delays that measurement).
    const waitForValidDimensions = async () => {
      let attempts = 0;
      while ((dimsRef.current.width === 0 || dimsRef.current.height === 0) && attempts < 20) {
        await new Promise(r => setTimeout(r, 50));
        attempts++;
      }
      console.log("[AnimatedCanvas] dimensions ready after", attempts, "retries:", dimsRef.current);
    };

    // Start the scatter animation immediately with particles at random
    // positions, then swap in the real car targets the moment the (worker)
    // sampler resolves. The circuit only needs the point COUNT, not the car
    // pixels, so it's sampled up front on the main thread (cheap). The main
    // thread never blocks on the silhouette read; reduced motion skips the
    // car sampler entirely.
    (async () => {
      await waitForValidDimensions();
      if (cancelled) return;

      const W = dimsRef.current.width;
      const H = dimsRef.current.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      let circuitTargets;
      try {
        const result = samplePathPoints(
          MONACO_CIRCUIT_PATH, CAR_TARGET_COUNT, MONACO_CIRCUIT_VIEWBOX, W, H,
        );
        circuitTargets = result.points;
        circuitFractionRef.current = result.fractionAtT;
      } catch (err) {
        console.error("[AnimatedCanvas] samplePathPoints failed, using fallback ellipse:", err);
        const fallback = buildFallbackCircuitTargets(CAR_TARGET_COUNT);
        circuitTargets = fallback.points;
        circuitFractionRef.current = fallback.fractionAtT;
      }
      if (cancelled) return;

      gridPointsRef.current = buildBackgroundGrid(W, H, dpr);

      // Assigns the car-target fields (position + baked lighting) onto existing
      // particles — the exact per-particle car math the original ran at
      // creation time, just deferred until the sampler resolves.
      const assignCarTargets = (carTargets) => {
        const parts = particlesRef.current;
        const n = Math.min(parts.length, carTargets.length);
        for (let i = 0; i < n; i++) {
          const [carX, carY, r, g, b, isEdge] = carTargets[i];
          const isEdgeBool = isEdge === 1;
          const sourceColor = classifySourceColor(r ?? 200, g ?? 20, b ?? 20);
          const lit = applyCarLighting(carY, isEdgeBool, sourceColor);
          const p = parts[i];
          p.carX = carX; p.carY = carY;
          p.isEdge = isEdgeBool;
          p.sourceColor = sourceColor;
          p.litColor = lit.color; p.litOpacity = lit.opacity;
        }
      };

      // Reduced motion: render the settled circuit as a single static frame.
      // The car never appears, so the silhouette sampler is never run.
      if (prefersReducedMotion()) {
        particlesRef.current = circuitTargets.map(([circuitX, circuitY, circuitRow]) => {
          const x = circuitX * W, y = circuitY * H;
          return {
            x, y, prevX: x, prevY: y,
            vx: 0, vy: 0,
            carX: 0, carY: 0, isEdge: false,
            circuitX, circuitY, circuitRow: circuitRow ?? 0,
            sourceColor: [204, 0, 0], litColor: [255, 255, 255], litOpacity: 0.3,
            scatterX: 0, scatterY: 0, scattered: false,
            holdX: 0, holdY: 0, disintegrating: false,
            radius: 1.2, color: [200, 200, 200], alpha: 0.9,
            phase: Math.random() * Math.PI * 2,
            trailActive: false, trailX: 0, trailY: 0, trailOpacity: 0,
          };
        });
        cancelAnimationFrame(loadingRafId);
        const drawStaticFrame = () => {
          const staticElapsed = STAGE4_END + 1;
          updateParticles(particlesRef.current, staticElapsed, dimsRef.current, 0, null);
          drawParticles(ctx, particlesRef.current, staticElapsed, dimsRef.current, gridPointsRef.current);
          drawCircuitMesh(ctx, particlesRef.current, staticElapsed, 0);
          drawLapDot(ctx, circuitFractionRef.current, staticElapsed, dimsRef.current);
        };
        staticRedrawRef.current = drawStaticFrame;
        drawStaticFrame();
        return;
      }

      // Full animation: create scatter particles now (car fields filled in when
      // the sampler resolves), so the first frame paints immediately.
      particlesRef.current = circuitTargets.map(([circuitX, circuitY, circuitRow]) => {
        const startX = Math.random() * W;
        const startY = Math.random() * H;
        return {
          x: startX, y: startY,
          prevX: startX, prevY: startY,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6,
          carX: 0, carY: 0, isEdge: false,
          circuitX, circuitY, circuitRow: circuitRow ?? 0,
          sourceColor: [204, 0, 0], litColor: [255, 255, 255], litOpacity: 0.3,
          scatterX: 0, scatterY: 0, scattered: false,
          holdX: 0, holdY: 0, disintegrating: false,
          radius: 1, color: [255, 255, 255], alpha: 0.3,
          phase: Math.random() * Math.PI * 2,
          trailActive: false, trailX: 0, trailY: 0, trailOpacity: 0,
        };
      });
      cancelAnimationFrame(loadingRafId); // particles paint from here on

      let carReady = false;
      getCarTargets(W, H).then(carTargets => {
        if (cancelled) return;
        assignCarTargets(carTargets);
        carReady = true;
      }).catch(err => {
        if (cancelled) return;
        console.error("[AnimatedCanvas] car sampling failed, using procedural fallback:", err);
        assignCarTargets(buildFallbackCarTargets());
        carReady = true;
      });

      let lastTime = performance.now();
      let elapsed = 0;
      let accumulator = 0;
      const loggedStages = new Set();

      const loop = now => {
        const dt = now - lastTime;
        lastTime = now;
        accumulator += dt;
        if (!document.hidden && accumulator >= FRAME_INTERVAL) {
          elapsed += accumulator;
          accumulator = 0;
          // Hold at the end of the scatter stage until car targets land, so no
          // particle assembles toward an unset target. With the worker this
          // resolves well within the 1s scatter window, so on capable hardware
          // no hold ever occurs and the timing is identical to before.
          if (!carReady && elapsed > STAGE1_END - 1) elapsed = STAGE1_END - 1;
          for (const threshold of [STAGE1_END, STAGE2_END, STAGE3_END, STAGE4_END]) {
            if (elapsed >= threshold && !loggedStages.has(threshold)) {
              loggedStages.add(threshold);
              console.log("[AnimatedCanvas]", STAGE_TRANSITION_LOGS[threshold], "elapsed=", elapsed);
            }
          }
          updateParticles(particlesRef.current, elapsed, dimsRef.current, dt, mouseRef.current);
          drawParticles(ctx, particlesRef.current, elapsed, dimsRef.current, gridPointsRef.current);
          drawCarMesh(ctx, particlesRef.current, elapsed, dt, dimsRef.current);
          drawCircuitMesh(ctx, particlesRef.current, elapsed, dt);
          drawGroundReflection(ctx, particlesRef.current, elapsed, dimsRef.current);
          try { drawGroundShadow(ctx, elapsed, dimsRef.current); } catch (err) { console.error("[AnimatedCanvas] drawGroundShadow failed:", err); }
          drawLapDot(ctx, circuitFractionRef.current, elapsed, dimsRef.current);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(loadingRafId);
      cancelAnimationFrame(rafRef.current);
      clearTimeout(fallbackTimeout);
      ro.disconnect();
    };
  }, []);

  // Cursor/touch position for the repulsion effect in updateParticles, kept
  // in a ref (not state) since it's read once per animation frame and
  // shouldn't trigger React re-renders on every pointer move.
  const handleMouseMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
  };
  const handleMouseLeave = () => { mouseRef.current.active = false; };
  const handleTouchMove = e => {
    if (e.touches.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    mouseRef.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top, active: true };
  };
  const handleTouchEnd = () => { mouseRef.current.active = false; };

  // position:absolute takes the canvas out of normal flow so its own size can
  // never feed back into the container's layout size — without this, the
  // ResizeObserver below and the container it observes form a feedback loop
  // (canvas grows -> container grows to fit it -> observer fires -> canvas
  // grows again -> ...), which is what was causing the box to expand forever.
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "block" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
};

// ── HOME PAGE (hero entry screen) ──────────────────────────────
const HomePage = () => (
  <div style={{
    // Single flat color shared by every layer of the page — html, body,
    // #root, main, nav/header, and the canvas's own drawAtmosphere fill —
    // so there is no seam anywhere regardless of element boundaries.
    width: "100%", background: "#080812", color: "var(--text)",
    display: "flex", flexDirection: "column", position: "relative",
  }}>
    {/* TOP — full-width animation canvas, edge to edge, no card container.
        <main> caps content at maxWidth:1100px and centers it, so a plain
        width:100% here only spans that inner box, not the real viewport —
        leaving a visible seam wherever main's centering margin + padding
        falls. The width:100vw + negative-margin pair is the standard
        "full-bleed" technique to break out of a centered max-width
        ancestor regardless of how wide that ancestor's own margin is. */}
    <div className="home-canvas-section" style={{
      position: "relative", width: "100vw", left: "50%", right: "50%",
      marginLeft: "-50vw", marginRight: "-50vw", height: "50vh", overflow: "hidden",
      background: "#080812",
    }}>
      {/* Subtle red glow behind the canvas */}
      <div style={{
        position: "absolute", top: "50%", left: "50%", width: "600px", height: "600px",
        background: "radial-gradient(circle, rgba(225,6,0,0.06), transparent 70%)",
        transform: "translate(-50%, -50%)", pointerEvents: "none",
      }} />
      <AnimatedCanvas />
    </div>

    {/* BOTTOM — centered text content */}
    <div className="home-text-section" style={{
      maxWidth: "800px", width: "100%", margin: "0 auto", padding: "32px 24px",
      textAlign: "center", position: "relative", zIndex: 1, background: "#080812",
    }}>
      <div style={{ fontFamily: "var(--mono)", color: "var(--red)", fontSize: "0.7rem", fontWeight: "700", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "1.5rem" }}>
        3-Model Pipeline · XGBoost · 2010–2026
      </div>
      <h1 className="landing-headline" style={{ fontFamily: "var(--sans)", fontSize: "3.2rem", fontWeight: "900", lineHeight: 1.05, margin: "0 0 1.25rem", color: "#fff" }}>
        Race outcomes, predicted.
      </h1>
      <p style={{ fontFamily: "var(--sans)", fontSize: "1.05rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.6, margin: "0 auto 2.5rem", maxWidth: "600px" }}>
        Three ML models predict qualifying, race winners, and podium finishers for every Grand Prix.
      </p>
      <div className="stat-cards-row home-stats" style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        <StatCard label="Models" value="3" sub="prediction pipeline" accent="var(--red)" />
        <StatCard label="ROC-AUC" value="0.972" accent="var(--red)" sub="winner model" />
        <StatCard label="Training" value="6,436" sub="race entries" />
        <StatCard label="Season" value="2026" sub="live" />
      </div>
      <div className="home-scroll-indicator" aria-hidden="true">&#8744;</div>
    </div>

    {/* HOW IT WORKS — minimal 3-step pipeline summary, plain text only
        (no cards/borders) so it reads as part of the hero, not a new
        section competing with it. */}
    <div style={{
      maxWidth: "900px", width: "100%", margin: "48px auto 0", padding: "0 24px",
      position: "relative", zIndex: 1, background: "#080812",
    }}>
      <div className="how-it-works-steps" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "32px" }}>
        {[
          { num: "01", title: "QUALIFYING PREDICTED", desc: "An XGBoost regressor forecasts the starting grid from current form and circuit history." },
          { num: "02", title: "RACE SIMULATED", desc: "Two classifiers estimate each driver's win and podium probability from the predicted grid." },
          { num: "03", title: "VALIDATED LIVE", desc: "Every 2026 race tests the models on data they've never seen. Probabilities reflect historical outcome rates, not guesses." },
        ].map((s, i, arr) => (
          <Fragment key={s.num}>
            <div style={{ flex: "1 1 0", minWidth: 0, textAlign: "center" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: "0.15em", color: "var(--red)", opacity: 0.8, marginBottom: "6px" }}>{s.num}</div>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff", marginBottom: "4px" }}>{s.title}</div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{s.desc}</div>
            </div>
            {i < arr.length - 1 && (
              <div className="how-it-works-connector hide-mobile" style={{ width: "24px", height: "1px", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
            )}
          </Fragment>
        ))}
      </div>
    </div>

    <div style={{ textAlign: "center", padding: "1.5rem", fontFamily: "var(--mono)", fontSize: "11px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.2em", position: "relative", zIndex: 1, background: "#080812" }}>
      Live predictions. Every race.
    </div>
  </div>
);

// ── ROOT ───────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("Home");
  const [pageKey, setPageKey] = useState(0);
  const [showSweep, setShowSweep] = useState(false);

  const handleNavigate = () => {
    setPageKey(k => k + 1);
    setShowSweep(true);
    setTimeout(() => setShowSweep(false), 500);
  };

  const pages = {
    "Home": <HomePage />,
    "Predictor": <PredictorPage />,
    "Next Race 🇭🇺": <NextRacePage />,
    "What-If 🎮": <WhatIfPage />,
    "Championship": <ChampionshipPage />,
    "Drivers": <DriversPage />,
    "Compare": <ComparePage />,
    "2026 Season": <Season2026Page />,
    "Model": <ModelPage />,
  };

  return (
    <HealthProvider>
    <MotionConfig reducedMotion="user">
    <div style={{ background: "#080812", minHeight: "100vh", color: "var(--text)", fontFamily: "var(--sans)" }}>
      <div style={{ height: "3px", background: "rgba(225,6,0,0.35)" }} />

      <header style={{ background: "#080812", borderBottom: "1px solid var(--border)" }} className="scanline-overlay">
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0.85rem 2rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <img src="/f1-logo.png" alt="F1" style={{ height: "30px", width: "auto" }} />
            <div>
              <div style={{ fontSize: "1rem", fontWeight: "900", fontStyle: "italic", letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1, marginRight: "124px" }}>Race Predictor</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.55rem", color: "var(--muted)", fontWeight: "500", letterSpacing: "0.08em", marginTop: "3px" }}>3-MODEL PIPELINE · XGBOOST · jaimecodes</div>
            </div>
          </div>
          <div className="header-right" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", letterSpacing: "0.1em" }}>SYS STATUS</div>
            <HealthIndicator />
          </div>
        </div>
      </header>

      <Nav page={page} setPage={setPage} onNavigate={handleNavigate} />

      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "1.5rem 2rem 4rem", background: "#080812" }}>
        {showSweep && <div className="sweep-line" />}
        <div key={pageKey} className="page-enter">
          <Suspense fallback={<PageLoader />}>
            {pages[page]}
          </Suspense>
        </div>
      </main>
    </div>
    </MotionConfig>
    </HealthProvider>
  );
}
