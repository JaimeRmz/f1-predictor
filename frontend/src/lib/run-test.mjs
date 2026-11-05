// node src/lib/run-test.mjs  -- runs homeModel.test.mjs through Vite so import.meta.env (constants.js) resolves.
import { createServer } from "vite";
globalThis.window = { location: { hostname: "localhost" }, matchMedia: () => ({ matches: false }) };
const s = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try { await s.ssrLoadModule("/src/lib/homeModel.test.mjs"); } finally { await s.close(); }
