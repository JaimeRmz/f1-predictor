// node src/lib/run-test.mjs   (run from frontend/; needs Vite for import.meta.env)
import assert from "node:assert/strict";
import fs from "node:fs";
import { canonicalTeam } from "../teams.js";
import { raceNote, RACE_NOTES, rowsWithShares, BACKTEST, BACKTEST_FULL, teamIdByDriverName, normalizeShares, roundShares, pctLabel, shareLabel, titleParts, driverCode, rankRows, classifySnapshot, countdownParts, phaseOf, raceByRound, lastRaceFor, defaultRound, isRaceOver, PHASE_LABEL } from "./homeModel.js";
import { NEXT_RACE } from "../constants.js";

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
t("the next race is Las Vegas (R21)", [NEXT_RACE.raceId, NEXT_RACE.round, defaultRound()], [1189, 21, 21]);
t("phase upcoming pre", phaseOf(raceByRound(21), Date.parse("2026-11-18T00:00:00Z")), "pre");
t("phase post", phaseOf(raceByRound(21), Date.parse("2026-11-21T05:00:00Z")), "post");
t("phase final-pending: race start + 3 h passed, still upcoming", phaseOf(raceByRound(21), Date.parse("2026-11-22T07:30:00Z")), "final-pending");
t("not yet final-pending just before start + 3 h", phaseOf(raceByRound(21), Date.parse("2026-11-22T06:59:00Z")), "post");
t("race-over works for ANY upcoming round, not only the next one", [phaseOf(raceByRound(22), Date.parse("2026-11-29T20:00:00Z")), phaseOf(raceByRound(22), Date.parse("2026-11-29T18:00:00Z"))], ["final-pending", "pre"]);
t("a non-next round is never 'post'", phaseOf(raceByRound(23), Date.parse("2026-12-05T00:00:00Z")), "pre");
t("phase completed", phaseOf(raceByRound(19)), "final");
t("Brazil (R20) is completed", [raceByRound(20).kind, phaseOf(raceByRound(20), Date.parse("2026-11-09T00:00:00Z"))], ["completed", "final"]);
t("isRaceOver", [isRaceOver(raceByRound(21), Date.parse("2026-11-22T08:00:00Z")), isRaceOver(raceByRound(21), Date.parse("2026-11-20T08:00:00Z")), isRaceOver(raceByRound(20))], [true, false, false]);
t("PHASE_LABEL keeps the race-over kicker", PHASE_LABEL["final-pending"], "RACE OVER · RESULTS NOT YET LOADED");
t("last race of R21 is Brazil (R20)", lastRaceFor(raceByRound(21)).round, 20);
t("a completed round is its own last race", lastRaceFor(raceByRound(7)).round, 7);
t("last race of R23 is R20", lastRaceFor(raceByRound(23)).round, 20);
const sumOf = (a) => a.reduce((x, y) => x + (y ?? 0), 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;
t("win shares sum to 1", near(sumOf(normalizeShares([0.96, 0.76, 0.09, 0.5], 1)), 1), true);
t("podium shares sum to 3", near(sumOf(normalizeShares([0.96, 0.92, 0.91, 0.1], 3)), 3), true);
t("shares are proportional", normalizeShares([1, 3], 1), [0.25, 0.75]);
t("all-zero field -> all null", normalizeShares([0, 0, 0], 1), [null, null, null]);
t("empty field", normalizeShares([], 1), []);
t("missing values are null and ignored in the sum", normalizeShares([1, null, undefined, NaN, 3], 1), [0.25, null, null, null, 0.75]);
t("negative values are null", normalizeShares([-1, 1], 1), [null, 1]);
t("shareLabel rounds", shareLabel(0.3449), "34%");
t("shareLabel <1%", shareLabel(0.004), "<1%");
t("shareLabel zero is <1%", shareLabel(0), "<1%");
t("shareLabel 0.5% is 1%", shareLabel(0.005), "1%");
t("shareLabel null", shareLabel(null), "—");
const withShares = rankRows([
  { driver_name: "A B", driverRef: "x", podium_probability: 0.5, win_probability: 0.2 },
  { driver_name: "C D", driverRef: "y", podium_probability: 0.9, win_probability: 0.1 },
  { driver_name: "E F", driverRef: "z", podium_probability: 0.1, win_probability: 0.7 },
]);
t("rank order is by podium score, not by share", withShares.map((r) => r.code), ["D", "B", "F"]);
t("rankRows win shares sum to 1", near(sumOf(withShares.map((r) => r.winShare)), 1), true);
t("rankRows podium shares sum to 3", near(sumOf(withShares.map((r) => r.podiumShare)), 3), true);
// largest-remainder rounding: displayed whole percents total exactly 100 / 300
const win = normalizeShares([0.96, 0.76, 0.09, 0.48, 0.57, 0.04, 0.05, 0.01, 0.0001, 0], 1);
const wr = roundShares(win, 1);
t("win percents total exactly 100", sumOf(wr), 100);
const pod = normalizeShares([0.96, 0.92, 0.91, 0.87, 0.69, 0.44, 0.16, 0.11, 0.07, 0.01, 0.003], 3);
const pr = roundShares(pod, 3);
t("podium percents total exactly 300", sumOf(pr), 300);
t("naive rounding would not total 100 here", sumOf(normalizeShares([1, 1, 1], 1).map((x) => Math.round(x * 100))), 99);
t("largest remainder fixes the 3-way split", roundShares(normalizeShares([1, 1, 1], 1), 1), [34, 33, 33]);
t("ties go to the earlier (higher-ranked) entry", roundShares([0.5, 0.5], 1).reduce((a, b) => a + b, 0), 100);
t("tiny entries are 0 (shown <1%) and the rest still total", roundShares(normalizeShares([50, 49.9, 0.1], 1), 1), [50, 50, 0]);
t("missing entries stay null", roundShares([0.5, null, 0.5], 1), [50, null, 50]);
t("all-zero field", roundShares([0, 0], 1), [0, 0]);
t("empty", roundShares([], 3), []);
t("pctLabel normal", pctLabel(34, 0.34), "34%");
t("pctLabel zero", pctLabel(0, 0.001), "<1%");
t("pctLabel null", pctLabel(null, null), "—");
const ranked = rankRows(Array.from({ length: 22 }, (_, i) => ({ driver_name: `D${i} X${i}`, driverRef: `d${i}`, podium_probability: 0.95 / (1 + i * 0.6), win_probability: 0.9 / (1 + i * 1.1) ** 2 })));
t("rankRows win % total 100", sumOf(ranked.map((r) => r.winPct)), 100);
t("rankRows podium % total 300", sumOf(ranked.map((r) => r.podiumPct)), 300);
t("team by driver name", teamIdByDriverName("Kimi Antonelli"), "mercedes");
t("team by driver name (unknown driver)", teamIdByDriverName("Nobody Here"), null);
const kept = rowsWithShares([{ driver_name: "A B", driverRef: "x", podium_probability: 0.2, win_probability: 0.1 }, { driver_name: "C D", driverRef: "y", podium_probability: 0.9, win_probability: 0.9 }]);
t("rowsWithShares keeps the given order", kept.map((r) => r.code), ["B", "D"]);
t("rowsWithShares percents total", [sumOf(kept.map((r) => r.winPct)), sumOf(kept.map((r) => r.podiumPct))], [100, 300]);
// The figures on the site are generated, never typed: they must equal analysis/out/rolled/winner_hit_ci.json (analysis/29_emit_frontend_figures.py).
const WH = JSON.parse(fs.readFileSync(new URL("../../../analysis/out/rolled/winner_hit_ci.json", import.meta.url), "utf8"));
const wil = (k) => [WH[k].hits, [Number(WH[k].wilson[0].toFixed(2)), Number(WH[k].wilson[1].toFixed(2))]];
t("backtest (before qualifying): the Model and points-leader rows equal the script's output", [[BACKTEST_FULL.predicted.rows[0].hits, BACKTEST_FULL.predicted.rows[0].ci], [BACKTEST_FULL.predicted.rows[1].hits, BACKTEST_FULL.predicted.rows[1].ci]], [wil("b_predicted_quali|all_43|model"), wil("b_predicted_quali|all_43|prior_standings")]);
t("backtest (after qualifying) rows equal the script's output", BACKTEST_FULL.real.rows.map((r) => [r.hits, r.ci]), ["model", "prior_standings", "prior_constructor", "prior_grid"].map((m) => wil(`a_real_grid|all_43|${m}`)));
t("BACKTEST (Home) is the same as the Model page's table, 43 races", [BACKTEST.model.hits, BACKTEST.model.ci, BACKTEST.standingsLeader.hits, BACKTEST.standingsLeader.ci, BACKTEST.races], [BACKTEST_FULL.predicted.rows[0].hits, BACKTEST_FULL.predicted.rows[0].ci, BACKTEST_FULL.predicted.rows[1].hits, BACKTEST_FULL.predicted.rows[1].ci, 43]);
t("R20 has the Camara footnote", /Câmara.*debut.*does not score him/.test(raceNote(1188)), true);
t("no footnote leaks into other rounds", [raceNote(1187), raceNote(1189), raceNote(1190), raceNote(1191), raceNote(undefined)], [null, null, null, null, null]);
t("only R20 has a note", Object.keys(RACE_NOTES), ["1188"]);
console.log(`${n} passed`);
