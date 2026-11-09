// run through run-test.mjs (Vite resolves import.meta.env)
import assert from "node:assert/strict";
import { simMode, replayTargetFor, circuitRefOf, PROJECTED_NOTICE, RACE_OVER_NOTE, NO_REPLAY_NOTE } from "./raceSim.js";
import { CALENDAR } from "./homeModel.js";

let n = 0;
const eq = (got, want, msg) => { assert.deepEqual(got, want, msg); n++; };
const byId = (id) => CALENDAR.find((r) => r.raceId === id);

// the manifest as useManifest() returns it: only races with a file (Monaco 2026, 1174, has none)
const ids = CALENDAR.filter((r) => r.kind === "completed" && r.raceId !== 1174 && r.raceId !== 1188).map((r) => r.raceId);       // Monaco 2026 and (not uploaded yet) Brazil have no file
const ready = { status: "ready", races: ids.map((raceId) => ({ raceId, file: `${raceId}.json.gz` })) };

eq(simMode(byId(1189), ready).mode, "projected", "an upcoming race (Las Vegas) shows the projected race");
eq(simMode(byId(1190), { status: "loading", races: [] }).mode, "projected", "an upcoming race never waits for the replay manifest");
eq(simMode(byId(1190), { status: "unavailable", races: [] }).mode, "projected", "an upcoming race never depends on the replay manifest");
eq(simMode(byId(1172), ready), { mode: "replay", entry: { raceId: 1172, file: "1172.json.gz" } }, "a completed race with a file shows its real replay");
eq(simMode(byId(1174), ready), { mode: "no-replay", entry: null }, "Monaco 2026 has no replay file: a note, no player");
eq(byId(1174).name, "Monaco GP", "1174 really is Monaco");
eq(simMode(byId(1172), { status: "loading", races: [] }).mode, "loading", "completed race while the manifest loads");
eq(simMode(byId(1172), { status: "unavailable", races: [] }).mode, "unavailable", "completed race when the replay files cannot be reached");
eq(simMode(null, ready).mode, "none", "no race");
eq(CALENDAR.filter((r) => r.kind === "completed").map((r) => simMode(r, ready).mode).filter((m) => m !== "replay"), ["no-replay", "no-replay"], "of all completed 2026 races only Monaco and Brazil (file not uploaded yet) lack a replay");
eq([replayTargetFor(byId(1189)), replayTargetFor(byId(1172))], ["p1189", 1172], "OPEN FULL VIEW targets: p<raceId> for upcoming, the raceId for completed");
eq(CALENDAR.filter((r) => !circuitRefOf(r)).map((r) => r.round), [], "every round has a circuit for its pack (completed ones through COMPLETED_CIRCUIT)");
eq([circuitRefOf(byId(1172)), circuitRefOf(byId(1188)), circuitRefOf(byId(1174)), circuitRefOf(byId(1189))], ["miami", "interlagos", "monaco", "vegas"], "circuitRef lookups (Brazil is completed now; Las Vegas comes from constants)");
for (const w of ["probab", "chance"]) assert.ok(!PROJECTED_NOTICE.toLowerCase().includes(w), `notice avoids "${w}"`), n++;
eq(PROJECTED_NOTICE, "The model's ranking played out as a race. It shows the order the model expects, not a forecast of the exact finishing order or of events such as pit stops, safety cars or incidents.", "the notice copy");

// ── race over, results not loaded: no projection, no grid, no Play; and the completed-with-no-replay states
eq(simMode(byId(1189), ready, true), { mode: "race-over", entry: null }, "upcoming race whose start + 3 h has passed: race-over (no projected race)");
eq(simMode(byId(1189), ready, false).mode, "projected", "same race before it is over: still the projected race");
eq(simMode(byId(1190), { status: "loading", races: [] }, true).mode, "race-over", "race-over does not wait for the replay manifest");
eq(simMode(byId(1172), ready, true).mode, "replay", "raceOver only applies to upcoming rounds; a completed race keeps its replay");
eq(RACE_OVER_NOTE, "Race finished. Results are loading.", "race-over copy");
eq(simMode(byId(1188), ready), { mode: "no-replay", entry: null }, "results loaded (Brazil is completed) but no replay file in the manifest: no-replay");
eq(simMode(byId(1172), { status: "ready", races: [{ raceId: 1172 }] }).mode, "no-replay", "a manifest entry without a file counts as no replay");
eq(simMode(byId(1174), ready).mode, "no-replay", "Monaco 2026: no-replay");
eq(NO_REPLAY_NOTE, "No replay available for this race.", "no-replay copy");
for (const w of ["probab", "chance"]) { assert.ok(!RACE_OVER_NOTE.toLowerCase().includes(w) && !NO_REPLAY_NOTE.toLowerCase().includes(w)); n++; }
console.log(`${n} race-sim tests passed`);
