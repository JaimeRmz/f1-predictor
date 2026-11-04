// node src/lib/run-test.mjs   (run from frontend/; needs Vite for import.meta.env)
import assert from "node:assert/strict";
import { canonicalTeam } from "../teams.js";
import { titleParts, driverCode, rankRows, classifySnapshot, countdownParts, phaseOf, raceByRound, lastRaceFor } from "./homeModel.js";

let n = 0;
const t = (name, got, want) => { assert.deepEqual(got, want, name); n++; };

for (const [raw, id] of [["RB F1 Team", "racing-bulls"], ["Racing Bulls", "racing-bulls"], ["Visa Cash App RB", "racing-bulls"], ["Red Bull", "red-bull"],
  ["Red Bull Racing", "red-bull"], ["Kick Sauber", "audi"], ["Sauber", "audi"], ["Audi", "audi"], ["Alpine F1 Team", "alpine"], ["Alpine", "alpine"],
  ["Aston Martin", "aston-martin"], ["Mercedes", "mercedes"], ["Haas F1 Team", "haas"], ["Cadillac", "cadillac"], ["McLaren", "mclaren"], ["Nonsense", null], [null, null]]) {
  t(`team ${raw}`, canonicalTeam(raw), id);
}
t("title", titleParts("Brazilian Grand Prix"), { base: "Brazilian", suffix: "" });
t("title GP", titleParts("Spanish GP (Madrid)"), { base: "Spanish", suffix: "(Madrid)" });
t("code", driverCode("Max Verstappen"), "VER");
const rows = rankRows([
  { driver_name: "A B", driverRef: "x", podium_probability: 0.2, win_probability: 0.1 },
  { driver_name: "C D", driverRef: "y", podium_probability: 0.9, win_probability: 0.5 },
  { driver_name: "E F", driverRef: "z", podium_probability: null },
]);
t("rank order", rows.map((r) => r.pos + r.code), ["1D", "2B"]);
const race = { qualiISO: "2026-09-12T14:00:00Z" };
t("snap unavailable", classifySnapshot(race, null, false), "unavailable");
t("snap none", classifySnapshot(race, null, true), "none");
t("snap after", classifySnapshot(race, { predicted_p1: "a", snapshotted_at: "2026-09-12T23:42:00Z" }, true), "after-cutoff");
t("snap genuine", classifySnapshot(race, { predicted_p1: "a", snapshotted_at: "2026-09-12T10:00:00Z" }, true), "genuine");
t("countdown", countdownParts(((4 * 24 + 20) * 3600 + 61) * 1000), { d: 4, h: 20, m: 1, s: 1 });
t("phase upcoming pre", phaseOf(raceByRound(20), Date.parse("2026-11-03T00:00:00Z")), "pre");
t("phase post", phaseOf(raceByRound(20), Date.parse("2026-11-07T19:00:00Z")), "post");
t("phase completed", phaseOf(raceByRound(19)), "final");
t("last race of R20 is R19", lastRaceFor(raceByRound(20)).round, 19);
t("a completed round is its own last race", lastRaceFor(raceByRound(7)).round, 7);
t("last race of R23 is R19", lastRaceFor(raceByRound(23)).round, 19);
console.log(`${n} passed`);
