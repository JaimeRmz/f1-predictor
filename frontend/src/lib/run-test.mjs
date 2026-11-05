// node src/lib/run-test.mjs  -- runs the unit tests through Vite so import.meta.env (constants.js) resolves.
import { createServer } from "vite";
globalThis.window = { location: { hostname: "localhost" }, matchMedia: () => ({ matches: false }) };
const s = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  for (const f of ["homeModel.test.mjs", "replay.test.mjs", "projectedRace.test.mjs"]) await s.ssrLoadModule(`/src/lib/${f}`);
} finally { await s.close(); }
