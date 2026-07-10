// Shared car-silhouette sampling. Imported by BOTH the main thread
// (fallback path in App.jsx) and the Web Worker (carSampler.worker.js), so the
// sparse-sampling logic lives in exactly one place and can't drift.
//
// The old sampler scanned every one of the ~15M hi-res pixels and processed
// ~5M candidates (Set build + edge detect + weighted-sample sort) — cost scaled
// with resolution and blocked the main thread for tens of seconds. This one
// instead draws a bounded number of random pixel samples and classifies each
// against the raw buffer, so cost is independent of canvas resolution and the
// PNG can stay rendered at 5x for a dense, accurate outline.

export const CAR_TARGET_COUNT = 1500;
export const CAR_SAMPLE_SCALE = 5;   // offscreen render scale (unchanged)
export const CAR_FILL_PADDING = 0.75;

const EDGE_TARGET = Math.round(CAR_TARGET_COUNT * 0.3); // 30% edge / 70% interior
// Candidate pools we gather before selecting. Oversampled so the final
// shuffle/weighted-pick still has variety; small enough to stay ~instant.
const EDGE_POOL = EDGE_TARGET * 2;                       // ~900
const INTERIOR_POOL = (CAR_TARGET_COUNT - EDGE_TARGET) * 4; // ~4200
// Hard cap on random draws (each is a couple of cheap buffer reads). Edge
// pixels are a thin fraction of the silhouette, so filling the edge pool is
// what consumes most draws; this ceiling keeps a degenerate image bounded.
const MAX_DRAWS = 2_000_000;

export function computeGeometry(pngW, pngH, canvasW, canvasH) {
  const hiW = Math.max(1, Math.round(canvasW * CAR_SAMPLE_SCALE));
  const hiH = Math.max(1, Math.round(canvasH * CAR_SAMPLE_SCALE));
  const scale = Math.min(hiW / pngW, hiH / pngH) * CAR_FILL_PADDING;
  const drawW = pngW * scale;
  const drawH = pngH * scale;
  const offsetX = (hiW - drawW) / 2;
  // Upper-third placement (matches the original), leaving room for the circuit.
  const offsetY = (hiH - drawH) * 0.40;
  return { hiW, hiH, drawW, drawH, offsetX, offsetY, centerXFrac: (offsetX + drawW / 2) / hiW };
}

const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Weighted random sampling without replacement (Efraimidis-Spirakis) — same as
// the original: each item's key = random() ** (1/weight); top-k keys win.
const weightedSample = (items, weightFn, k) => {
  if (items.length <= k) return items.slice();
  const keyed = items.map(item => {
    const w = Math.max(weightFn(item), 0.02);
    return { item, key: Math.pow(Math.random(), 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map(entry => entry.item);
};

// data: Uint8ClampedArray RGBA of the hiW×hiH offscreen render.
// Returns exactly CAR_TARGET_COUNT points: [xFrac, yFrac, r, g, b, isEdge(0|1)].
export function sparseSampleTargets(data, geom) {
  const { hiW, hiH, centerXFrac } = geom;
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= hiW || y >= hiH) ? 0 : data[(y * hiW + x) * 4 + 3];

  const edgePixels = [];
  const interiorPixels = [];
  const seen = new Set(); // no pixel picked twice, mirroring the exhaustive pass
  let draws = 0;
  while ((edgePixels.length < EDGE_POOL || interiorPixels.length < INTERIOR_POOL) && draws < MAX_DRAWS) {
    draws++;
    const x = (Math.random() * hiW) | 0;
    const y = (Math.random() * hiH) | 0;
    const flat = y * hiW + x;
    if (seen.has(flat)) continue;
    const idx = flat * 4;
    if (data[idx + 3] <= 30) continue; // transparent background
    seen.add(flat);
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    // Edge = borders transparency — identical definition to the exhaustive
    // version, read directly from the buffer so it's exact, not approximate.
    const isEdge = x === 0 || y === 0 || x === hiW - 1 || y === hiH - 1 ||
      alphaAt(x - 1, y) <= 30 || alphaAt(x + 1, y) <= 30 ||
      alphaAt(x, y - 1) <= 30 || alphaAt(x, y + 1) <= 30;
    if (isEdge) { if (edgePixels.length < EDGE_POOL) edgePixels.push([x, y, r, g, b]); }
    else if (interiorPixels.length < INTERIOR_POOL) interiorPixels.push([x, y, r, g, b]);
  }

  shuffle(edgePixels);
  const chosenEdge = edgePixels.slice(0, EDGE_TARGET);
  const interiorTarget = CAR_TARGET_COUNT - chosenEdge.length;
  // Brighter interior pixels (red panels/highlights) are weighted higher, so
  // particle density traces the car's lighting — same as the original.
  const chosenInterior = weightedSample(interiorPixels, ([, , r, g, b]) => (r + g + b) / 3 / 255, interiorTarget);

  const combined = [
    ...chosenEdge.map(c => [...c, 1]),     // 1 = edge
    ...chosenInterior.map(c => [...c, 0]), // 0 = interior
  ];
  // Degenerate fallback: pad from whatever pool we have if we came up short.
  const pool = interiorPixels.length ? interiorPixels : edgePixels;
  while (combined.length < CAR_TARGET_COUNT && pool.length) {
    combined.push([...pool[(Math.random() * pool.length) | 0], 0]);
  }

  shuffle(combined);

  // Stretch 25% wider around the car's own horizontal center (unchanged).
  const pts = combined.map(([x, y, r, g, b, isEdge]) => {
    const xFrac = x / hiW;
    const stretchedX = Math.max(0, Math.min(1, centerXFrac + (xFrac - centerXFrac) * 1.25));
    return [stretchedX, y / hiH, r, g, b, isEdge];
  });
  // Scanline order so particles assemble top-to-bottom (unchanged).
  pts.sort((p1, p2) => (Math.floor(p1[1] * 20) * 1000 + p1[0]) - (Math.floor(p2[1] * 20) * 1000 + p2[0]));
  return pts;
}
