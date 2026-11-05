import { createServer } from "vite";
import fs from "node:fs";
globalThis.window = { location: { hostname: "localhost" }, matchMedia: () => ({ matches: false }) };
const s = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { STANDINGS_GRID_2026 } = await s.ssrLoadModule("/src/constants.js");
  for (const ref of ["interlagos", "vegas", "losail", "yas_marina"]) {
    const r = await fetch(`http://127.0.0.1:8000/whatif?circuitRef=${ref}&auto_quali=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(STANDINGS_GRID_2026) });
    fs.writeFileSync(`../analysis/proj/rows_${ref}.json`, JSON.stringify(await r.json()));
  }
} finally { await s.close(); }
