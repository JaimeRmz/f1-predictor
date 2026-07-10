// Web Worker: samples the F1 car silhouette off the main thread so the hero
// canvas never blocks the UI. Fetches the PNG, decodes it via createImageBitmap,
// renders it to an OffscreenCanvas at 5x, reads the pixels, and runs the shared
// sparse sampler. Posts back the ~1500 target points.
import { computeGeometry, sparseSampleTargets } from "./carSampling.js";

self.onmessage = async (e) => {
  const { canvasW, canvasH } = e.data || {};
  try {
    const res = await fetch("/f1-car.png");
    if (!res.ok) throw new Error("fetch /f1-car.png -> " + res.status);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const geom = computeGeometry(bitmap.width, bitmap.height, canvasW, canvasH);
    const off = new OffscreenCanvas(geom.hiW, geom.hiH);
    const ctx = off.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, geom.hiW, geom.hiH);
    ctx.drawImage(bitmap, geom.offsetX, geom.offsetY, geom.drawW, geom.drawH);
    if (bitmap.close) bitmap.close();

    const { data } = ctx.getImageData(0, 0, geom.hiW, geom.hiH);
    const pts = sparseSampleTargets(data, geom);

    self.postMessage({ ok: true, pts });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
