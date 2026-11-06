// node docs/polish/gap-monotone-real.mjs
// How often does the GAP column of a REAL replay decrease going down the official order? (Not changed: official positions and per-lap timing
// gaps can really disagree for a moment.) Samples every 5 s of the race, rows that are OUT / in the pit / NO DATA / DSQ and the leader are skipped;
// lapped cars ("+1 LAP") are compared by laps. A "violation" = a row whose gap is smaller than the gap of the car above it.
import fs from "node:fs";
import zlib from "node:zlib";
import { decodeReplay, boardAt } from "../../frontend/src/lib/replay.js";
const dir = "frontend/public/replay-dev";
const ids = process.argv.slice(2).map(Number); const pick = ids.length ? ids : [1145, 1147, 1157, 1165, 1172, 1175, 1178, 1181, 1186];
const man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8")).races;
const out = [];
for (const id of pick) {
  const m = man.find((r) => r.raceId === id); if (!m?.file) continue;
  const rep = decodeReplay(JSON.parse(zlib.gunzipSync(fs.readFileSync(`${dir}/${m.file}`))));
  let steps = 0, badSteps = 0, pairs = 0, badPairs = 0;
  for (let t = rep.lightsOut + 60; t <= rep.race.chequered - 30; t += 5) {
    const rows = boardAt(rep, t).filter((r) => r.pos > 1 && !r.out && !r.inPit && !r.noData && !r.dsq && r.gap != null);
    let last = -1, lastLaps = 0, bad = false;
    for (const r of rows) {
      if (typeof r.gap === "number") { pairs++; if (lastLaps > 0 || r.gap < last - 1e-9) { badPairs++; bad = true; } last = r.gap; }
      else { const n = Number((String(r.gap).match(/(\d+)/) || [0, 1])[1]); pairs++; if (n < lastLaps) { badPairs++; bad = true; } lastLaps = n; }
    }
    steps++; if (bad) badSteps++;
  }
  out.push({ raceId: id, race: `${m.name} ${m.year}`, steps, badSteps, pctSteps: +(100 * badSteps / steps).toFixed(1), pctPairs: +(100 * badPairs / pairs).toFixed(2) });
}
console.table(out);
