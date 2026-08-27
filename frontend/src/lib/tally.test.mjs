import { computeTally } from "./tally.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const race = (o) => ({ resultKnown: true, actualWinnerRef: "norris", userRefs: null, modelRefs: null, ...o });

console.log("computeTally — snapshot-less races must not score against the model\n");

t("snapshot-less race is excluded from the model denominator", () => {
  const r = computeTally([
    race({ modelRefs: ["norris", "a", "b"] }),   // model called it, correct
    race({ modelRefs: null }),                    // NO snapshot (e.g. Zandvoort)
  ]);
  assert.equal(r.modelScored, 1, "denominator must skip the snapshot-less race");
  assert.equal(r.modelWins, 1);
  assert.equal(r.modelSkipped, 1);
  assert.equal(r.scored, 2, "overall Races Scored still counts both");
});

t("REGRESSION: old behaviour would have shown 1/2, now shows 1/1", () => {
  const rows = [race({ modelRefs: ["norris", "a", "b"] }), race({ modelRefs: null })];
  const r = computeTally(rows);
  const oldDenominator = rows.filter(x => x.resultKnown).length; // the bug
  assert.equal(oldDenominator, 2);
  assert.equal(r.modelScored, 1);
  assert.notEqual(r.modelScored, oldDenominator, "must no longer use the all-scored denominator");
});

t("a snapshot-less race is not counted as a win either", () => {
  const r = computeTally([race({ modelRefs: null })]);
  assert.equal(r.modelWins, 0);
  assert.equal(r.modelScored, 0);
  assert.equal(r.modelSkipped, 1);
});

t("a genuine miss still counts against the model", () => {
  const r = computeTally([race({ modelRefs: ["piastri", "a", "b"] })]); // wrong call
  assert.equal(r.modelScored, 1, "a real pick must stay in the denominator");
  assert.equal(r.modelWins, 0);
  assert.equal(r.modelSkipped, 0);
});

t("all-snapshotted season is unaffected by the change", () => {
  const r = computeTally([
    race({ modelRefs: ["norris", "a", "b"] }),
    race({ modelRefs: ["piastri", "a", "b"] }),
    race({ modelRefs: ["norris", "a", "b"] }),
  ]);
  assert.equal(r.modelScored, 3);
  assert.equal(r.modelWins, 2);
  assert.equal(r.modelSkipped, 0);
});

t("races with no result yet are excluded from everything", () => {
  const r = computeTally([
    race({ resultKnown: false, modelRefs: ["norris", "a", "b"] }),
    race({ modelRefs: ["norris", "a", "b"] }),
  ]);
  assert.equal(r.scored, 1);
  assert.equal(r.modelScored, 1);
  assert.equal(r.modelSkipped, 0);
});

t("user side is untouched by this change", () => {
  const r = computeTally([
    race({ userRefs: ["norris", "a", "b"], modelRefs: null }),
    race({ userRefs: null, modelRefs: ["norris", "a", "b"] }),
  ]);
  assert.equal(r.userWins, 1);
  assert.equal(r.userPicked, 1);
  assert.equal(r.scored, 2);
});

t("null rows return null (loading state)", () => {
  assert.equal(computeTally(null), null);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
