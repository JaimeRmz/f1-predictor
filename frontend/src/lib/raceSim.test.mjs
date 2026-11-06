// run through run-test.mjs (Vite resolves import.meta.env)
import assert from "node:assert/strict";
import { simMode, replayTargetFor, circuitRefOf, PROJECTED_NOTICE } from "./raceSim.js";
import { CALENDAR } from "./homeModel.js";

let n = 0;
const eq = (got, want, msg) => { assert.deepEqual(got, want, msg); n++; };
const byId = (id) => CALENDAR.find((r) => r.raceId === id);

// the manifest as useManifest() returns it: only races with a file (Monaco 2026, 1174, has none)
const ids = CALENDAR.filter((r) => r.kind === "completed" && r.raceId !== 1174).map((r) => r.raceId);
const ready = { status: "ready", races: ids.map((raceId) => ({ raceId, file: `${raceId}.json.gz` })) };

eq(simMode(byId(1188), ready).mode, "projected", "an upcoming race (Brazil) shows the projected race");
eq(simMode(byId(1189), { status: "loading", races: [] }).mode, "projected", "an upcoming race never waits for the replay manifest");
eq(simMode(byId(1189), { status: "unavailable", races: [] }).mode, "projected", "an upcoming race never depends on the replay manifest");
eq(simMode(byId(1172), ready), { mode: "replay", entry: { raceId: 1172, file: "1172.json.gz" } }, "a completed race with a file shows its real replay");
eq(simMode(byId(1174), ready), { mode: "no-replay", entry: null }, "Monaco 2026 has no replay file: a note, no player");
eq(byId(1174).name, "Monaco GP", "1174 really is Monaco");
eq(simMode(byId(1172), { status: "loading", races: [] }).mode, "loading", "completed race while the manifest loads");
eq(simMode(byId(1172), { status: "unavailable", races: [] }).mode, "unavailable", "completed race when the replay files cannot be reached");
eq(simMode(null, ready).mode, "none", "no race");
eq(CALENDAR.filter((r) => r.kind === "completed").map((r) => simMode(r, ready).mode).filter((m) => m !== "replay"), ["no-replay"], "of all completed 2026 races only Monaco lacks a replay");
eq([replayTargetFor(byId(1188)), replayTargetFor(byId(1172))], ["p1188", 1172], "OPEN FULL VIEW targets: p<raceId> for upcoming, the raceId for completed");
eq(CALENDAR.filter((r) => !circuitRefOf(r)).map((r) => r.round), [], "every round has a circuit for its pack (completed ones through COMPLETED_CIRCUIT)");
eq([circuitRefOf(byId(1172)), circuitRefOf(byId(1188)), circuitRefOf(byId(1174))], ["miami", "interlagos", "monaco"], "circuitRef lookups");
for (const w of ["probab", "chance"]) assert.ok(!PROJECTED_NOTICE.toLowerCase().includes(w), `notice avoids "${w}"`), n++;
eq(PROJECTED_NOTICE, "The model's ranking played out as a race. It shows the order the model expects, not a forecast of the exact finishing order or of events such as pit stops, safety cars or incidents.", "the notice copy");
console.log(`${n} race-sim tests passed`);
