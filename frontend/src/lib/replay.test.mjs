// node src/lib/run-test.mjs   (run from frontend/)
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  decodeDelta, cubicAt, decodeReplay, findOutages, outageAt, carStateAt, officialPosition, lapAt, lapStartTime, boardAt, gapLabel, bandAt, raceClock, trackBounds, parseReplayBuffer,
} from "./replay.js";

let n = 0;
const t = (name, got, want) => { assert.deepEqual(got, want, name); n++; };
const near = (name, got, want, eps = 1e-6) => { assert.ok(Math.abs(got - want) <= eps, `${name}: got ${got}, want ${want}`); n++; };

// ── delta decoding
t("decodeDelta cumulative sum", Array.from(decodeDelta([100, 5, -3, 0, 2])), [100, 105, 102, 102, 104]);
t("decodeDelta empty", Array.from(decodeDelta([])), []);

// ── cubic interpolation
const sq = Float32Array.from([0, 1, 4, 9, 16, 25]);
near("cubic passes through every knot", cubicAt(sq, 3), 9);
near("cubic reproduces a quadratic between knots (1.5^2)", cubicAt(sq, 1.5), 2.25);
near("cubic reproduces a quadratic between knots (3.25^2)", cubicAt(sq, 3.25), 10.5625);
const line = Float32Array.from([0, 10, 20, 30, 40]);
near("cubic of a straight line is the line", cubicAt(line, 2.3), 23);
near("cubic clamps before the start", cubicAt(line, -5), 0);
near("cubic clamps after the end", cubicAt(line, 99), 40);
assert.ok(Number.isNaN(cubicAt(new Float32Array(0), 1))); n++;
// a circle sampled at 1 Hz: the cubic is far closer to the true curve than the straight chord between samples
const R = 5000, w = 0.12;                                       // radius 500 m (decimetres), about 0.12 rad/s
const cx = Float32Array.from({ length: 40 }, (_, i) => R * Math.cos(w * i)), cy = Float32Array.from({ length: 40 }, (_, i) => R * Math.sin(w * i));
let eCubic = 0, eLinear = 0;
for (let k = 3; k < 30; k++) for (const u of [0.25, 0.5, 0.75]) {
  const tt = k + u, X = R * Math.cos(w * tt), Y = R * Math.sin(w * tt);
  eCubic = Math.max(eCubic, Math.hypot(cubicAt(cx, tt) - X, cubicAt(cy, tt) - Y));
  eLinear = Math.max(eLinear, Math.hypot(cx[k] + (cx[k + 1] - cx[k]) * u - X, cy[k] + (cy[k + 1] - cy[k]) * u - Y));
}
assert.ok(eCubic < eLinear / 10, `cubic ${eCubic} vs linear ${eLinear}`); n++;

// ── a small synthetic race: 3 cars, 2 laps
const enc = (a) => a.map((v, i) => v - (i ? a[i - 1] : 0));
const mk = (x0, dx) => ({ x: enc(Array.from({ length: 200 }, (_, i) => x0 + dx * i)), y: enc(Array.from({ length: 200 }, () => 50)) });
const J = {
  v: 1, license: "x",
  race: { raceId: 1, year: 2025, round: 1, name: "Test GP", t0: 0, n: 200, lights_out: 20, chequered: 150, laps: 2 },
  drivers: [
    { n: 1, code: "AAA", team: "Red Bull Racing", colour: "3671C6", status: null, out_t: null, laps: 2 },
    { n: 2, code: "BBB", team: "Ferrari", colour: "E10600", status: "dnf", out_t: 60, laps: 1 },
    { n: 3, code: "CCC", team: "Mercedes", colour: "00D2BE", status: "dsq", out_t: null, laps: 2 },
  ],
  track: { outline: { x: enc([0, 100, 100, 0]), y: enc([0, 0, 50, 50]) }, pit: { x: enc([10, 90]), y: enc([-8, -8]) }, sf: { x: 0, y: 0, dx: 4, dy: 0 }, length_m: 30 },
  pos: { AAA: mk(0, 10), BBB: mk(100, 8), CCC: mk(300, 6) },
  gaps: { CCC: [[40, 50]] }, in_pit: { AAA: [[80, 90]] },
  laps: [{ lap: 1, t: 20, order: ["AAA", "BBB", "CCC"], gap: { AAA: 0, BBB: 1.5, CCC: "+1 LAP" } }, { lap: 2, t: 90, order: ["AAA", "CCC", "BBB"], gap: { AAA: 0, CCC: 2.2 } }],
  board: { AAA: [[0, 1]], BBB: [[0, 2], [70, 3]], CCC: [[0, 3], [70, 2]] },
  pits: [], flags: [], bands: [{ kind: "SC", a: 30, b: 50 }],
};
const rep = decodeReplay(J);
t("decodeReplay: cars and lookups", [rep.cars.length, rep.byCode.BBB.colour, rep.endT, rep.startT, rep.lapsTotal], [3, "#E10600", 180, 0, 2]);
near("positions decode to the original values", rep.byCode.AAA.x[7], 70);
t("trackBounds covers outline and pit lane", trackBounds(rep), { minX: 0, maxX: 100, minY: -8, maxY: 50 });

// ── car state
let s = carStateAt(rep, rep.byCode.AAA, 10.5);
near("carStateAt interpolates between seconds", s.x, 105);
t("a normal car is visible, not out, not in the pit", [s.hidden, s.out, s.inPit], [false, false, false]);
t("in-pit run is honoured", carStateAt(rep, rep.byCode.AAA, 85).inPit, true);
t("a retiree is OUT from out_t, frozen at its last point", [carStateAt(rep, rep.byCode.BBB, 59).out, carStateAt(rep, rep.byCode.BBB, 61).out], [false, true]);
t("a data hole hides the dot (not OUT)", [carStateAt(rep, rep.byCode.CCC, 45).hidden, carStateAt(rep, rep.byCode.CCC, 45).out, carStateAt(rep, rep.byCode.CCC, 55).hidden], [true, false, false]);
t("DSQ shows only after the chequered flag", [carStateAt(rep, rep.byCode.CCC, 100).dsq, carStateAt(rep, rep.byCode.CCC, 160).dsq], [false, true]);

// ── order board: the official feed
t("officialPosition before the first change is the first value", officialPosition(rep.byCode.BBB, -5), 2);
t("officialPosition at a change time uses the new value", officialPosition(rep.byCode.BBB, 70), 3);
t("officialPosition just before a change uses the old value", officialPosition(rep.byCode.BBB, 69.9), 2);
t("board orders by official position", boardAt(rep, 30).map((r) => r.code), ["AAA", "BBB", "CCC"]);
t("board reorders after a position change", boardAt(rep, 75).map((r) => r.code), ["AAA", "CCC", "BBB"]);
t("board flags OUT cars", boardAt(rep, 75).find((r) => r.code === "BBB").out, true);
const tie = decodeReplay({ ...J, board: { AAA: [[0, 1]], BBB: [[0, 2]], CCC: [[0, 2]] } });
t("ties break by driver code", boardAt(tie, 30).map((r) => r.code), ["AAA", "BBB", "CCC"]);

// ── gap column text
t("gap label LEADER", gapLabel({ pos: 1, gap: 0 }), "LEADER");
t("gap label seconds", gapLabel({ pos: 2, gap: 1.5 }), "+1.5");
t("gap label lapped text passes through", gapLabel({ pos: 5, gap: "+1 LAP" }), "+1 LAP");
t("gap label unknown", gapLabel({ pos: 5, gap: null }), "—");
t("tags win over the gap: OUT, DSQ, PIT", [gapLabel({ out: true, pos: 3, gap: 4 }), gapLabel({ dsq: true, pos: 3, gap: 4 }), gapLabel({ inPit: true, pos: 3, gap: 4 })], ["OUT", "DSQ", "PIT"]);
t("board gaps come from the lap row in force", [boardAt(rep, 30).find((r) => r.code === "BBB").gap, boardAt(rep, 95).find((r) => r.code === "CCC").gap], [1.5, 2.2]);

// ── laps, clock, bands
t("lap 0 before lights out", lapAt(rep, 10), 0);
t("lap 1 after lights out", lapAt(rep, 20), 1);
t("lap 2 after the second crossing", lapAt(rep, 91), 2);
t("lap never exceeds the race distance", lapAt(rep, 500), 2);
t("lapStartTime", [lapStartTime(rep, 2), lapStartTime(rep, 9)], [90, null]);
t("raceClock before / after lights out", [raceClock(rep, 14), raceClock(rep, 20), raceClock(rep, 95)], ["-0:06", "0:00", "1:15"]);
t("bandAt inside / outside", [bandAt(rep, 40)?.kind, bandAt(rep, 60)], ["SC", null]);

// ── file parsing: gzip and plain JSON, and a bad file
const raw = Buffer.from(JSON.stringify(J));
t("parseReplayBuffer inflates gzip", (await parseReplayBuffer(zlib.gzipSync(raw))).race.name, "Test GP");
t("parseReplayBuffer accepts plain JSON", (await parseReplayBuffer(raw)).race.laps, 2);
await assert.rejects(() => parseReplayBuffer(Buffer.from("not json")));
n++;

// ── data gaps
t("a car in a hole is flagged noData on the board, with its own label", [boardAt(rep, 45).find((r) => r.code === "CCC").noData, gapLabel({ ...boardAt(rep, 45).find((r) => r.code === "CCC") })], [true, "NO DATA"]);
t("noData clears after the hole", boardAt(rep, 55).find((r) => r.code === "CCC").noData, false);
t("OUT and DSQ tags still win over NO DATA", [gapLabel({ out: true, noData: true, pos: 3 }), gapLabel({ dsq: true, noData: true, pos: 3 })], ["OUT", "DSQ"]);
t("one car's hole is not a whole-feed outage", [rep.outages, outageAt(rep, 45)], [[], null]);
const allHole = decodeReplay({ ...J, gaps: { AAA: [[100, 120]], BBB: [[100, 120]], CCC: [[100, 106], [112, 120]] } });
t("a hole shared by (nearly) every car is an outage", allHole.outages, [{ a: 100, b: 120 }]);
t("outageAt inside / outside", [outageAt(allHole, 110)?.a, outageAt(allHole, 90)], [100, null]);
const half = findOutages([{ status: null, outT: null, holes: [[10, 20]] }, { status: null, outT: null, holes: null }], 40);
t("exactly half the racing cars missing counts as an outage", half, [{ a: 10, b: 20 }]);
const retiredIgnored = findOutages([{ status: "dnf", outT: 5, holes: [[10, 20]] }, { status: null, outT: null, holes: [[10, 20]] }], 40);
t("retired cars are not counted as racing", retiredIgnored, [{ a: 10, b: 20 }]);
t("a hole under 4 s is not reported", findOutages([{ status: null, outT: null, holes: [[10, 12]] }], 40), []);
console.log(`${n} replay tests passed`);
