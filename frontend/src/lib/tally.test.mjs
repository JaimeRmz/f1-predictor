import { computeTally, pickWinnerRef } from "./tally.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const race = (o) => ({
  resultKnown: true, actualWinnerRef: "norris", userRefs: null, modelRefs: null,
  modelWinProbs: null, ...o,
});

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

t("CONSECUTIVE snapshot-less races (e.g. Bahrain 1184 + Singapore 1185) both drop out", () => {
  const r = computeTally([
    race({ modelRefs: ["norris", "a", "b"] }),  // Azerbaijan 1183 -- has a snapshot
    race({ modelRefs: null }),                   // Bahrain 1184 -- no snapshot
    race({ modelRefs: null }),                   // Singapore 1185 -- no snapshot
  ]);
  assert.equal(r.scored, 3, "all three completed races still count toward Races Scored");
  assert.equal(r.modelScored, 1, "only the snapshotted race counts toward the model denominator");
  assert.equal(r.modelWins, 1);
  assert.equal(r.modelSkipped, 2, "both snapshot-less races are skipped, not just one");
});

console.log("\ncomputeTally / pickWinnerRef — the model's winner pick comes from WIN probability, not slot order\n");

t("pickWinnerRef picks the highest win-probability slot, not refs[0]", () => {
  // Monza (1181): predicted_p1/p2/p3 were podium-ranked [russell, antonelli,
  // norris], but Antonelli's frozen win probability (0.9192) beat Russell's
  // (0.7786) -- and Antonelli actually won. The old refs[0]-only rule missed
  // this; the win-probability rule gets it right.
  const ref = pickWinnerRef(["russell", "antonelli", "norris"], [0.7786, 0.9192, 0.6227]);
  assert.equal(ref, "antonelli");
});

t("pickWinnerRef falls back to refs[0] when there are no win probabilities", () => {
  assert.equal(pickWinnerRef(["norris", "a", "b"], null), "norris");
  assert.equal(pickWinnerRef(["norris", "a", "b"], undefined), "norris");
});

t("pickWinnerRef returns null for a snapshot-less (null refs) race", () => {
  assert.equal(pickWinnerRef(null, [0.9, 0.1, 0.1]), null);
});

t("pickWinnerRef keeps the first slot on an exact tie", () => {
  assert.equal(pickWinnerRef(["a", "b", "c"], [0.5, 0.5, 0.5]), "a");
});

t("REGRESSION (re-scoring, no Supabase rewrite): Monza 1181 and Spain 1182 flip from MISS to HIT", () => {
  // Frozen rows exactly as stored for raceIds 1181/1182 (podium-ranked
  // predicted_p1/p2/p3, Antonelli's win probability clamped equal to his
  // podium probability per main.py's win<=podium rule). Antonelli won both.
  const monza = race({
    actualWinnerRef: "antonelli",
    modelRefs: ["russell", "antonelli", "norris"],
    modelWinProbs: [0.7786, 0.9192, 0.6227],
  });
  const spain = race({
    actualWinnerRef: "antonelli",
    modelRefs: ["russell", "antonelli", "norris"],
    modelWinProbs: [0.8174, 0.9192, 0.5958],
  });
  const oldStyle = computeTally([
    { ...monza, modelWinProbs: null }, // simulates the pre-fix refs[0]-only rule
    { ...spain, modelWinProbs: null },
  ]);
  const newStyle = computeTally([monza, spain]);
  assert.equal(oldStyle.modelWins, 0, "old rule: russell != antonelli on both, 0 wins");
  assert.equal(newStyle.modelWins, 2, "new rule: antonelli has the higher win%, 2 wins");
});

t("Hungary 1179 and Baku 1183 stay MISSes either way (re-scoring doesn't fabricate wins)", () => {
  const hungary = race({
    actualWinnerRef: "norris",
    modelRefs: ["antonelli", "russell", "hamilton"],
    modelWinProbs: [0.8881, 0.5396, 0.7918],
  });
  const baku = race({
    actualWinnerRef: "russell",
    modelRefs: ["antonelli", "russell", "norris"],
    modelWinProbs: [0.9074, 0.7201, 0.5435],
  });
  const r = computeTally([hungary, baku]);
  assert.equal(r.modelWins, 0, "the model's own highest-win-probability pick (Antonelli, both races) still wasn't the actual winner");
});

t("MODEL SIDE ONLY: re-scoring never touches userWins/userPicked", () => {
  // User picked Russell (slot 0, the old-style "obvious" pick) and lost;
  // the model's win-probability re-scoring (Antonelli) is irrelevant to the
  // user's own win/loss, which is always judged on userRefs[0].
  const r = computeTally([
    race({
      userRefs: ["russell", "a", "b"],
      actualWinnerRef: "antonelli",
      modelRefs: ["russell", "antonelli", "norris"],
      modelWinProbs: [0.7786, 0.9192, 0.6227],
    }),
  ]);
  assert.equal(r.userWins, 0);
  assert.equal(r.userPicked, 1);
  assert.equal(r.modelWins, 1, "sanity: the model side still re-scores to a win in this same row");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
