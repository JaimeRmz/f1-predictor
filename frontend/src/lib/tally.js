// Season tally for the My Picks results view, kept as a pure function of the
// built row list so it can be unit-tested without React or the network.
//
// A row is { resultKnown, actualWinnerRef, userRefs, modelRefs, modelWinProbs },
// where userRefs / modelRefs are an ordered [p1, p2, p3] of driverRefs or null,
// and modelWinProbs is the matching [p1_win, p2_win, p3_win] frozen WIN
// probabilities (or null/omitted).

// The model's "winner" pick is NOT just modelRefs[0]. predicted_p1 was
// historically the model's highest-PODIUM-probability driver, which is a
// different question from "who does the model think wins" — a win is a
// subset of a podium (main.py clamps win_probability <= podium_probability),
// so the podium favorite and the win favorite are often, but not always, the
// same driver. snapshot_model_pick.py now writes predicted_p1 as the win
// favorite going forward, but this re-derives it from the frozen per-pick win
// probabilities instead of trusting slot order, so:
//   - old snapshots (written under the podium-first rule) get re-scored
//     correctly here, in code, with no Supabase rewrite needed, and
//   - a future regression in the write-time rule can't silently break this.
// Only the 3 frozen picks are searched (not the full 22-driver field) because
// that's all a snapshot row stores; see tally.test.mjs for the case this
// still gets right vs. the rare case it can't.
export function pickWinnerRef(refs, winProbs) {
  if (!refs) return null;
  if (!winProbs) return refs[0];
  let best = 0;
  for (let i = 1; i < refs.length; i++) {
    if ((winProbs[i] ?? -Infinity) > (winProbs[best] ?? -Infinity)) best = i;
  }
  return refs[best];
}

export function computeTally(rows) {
  if (!rows) return null;
  const scored = rows.filter(r => r.resultKnown);

  const userWins = scored.filter(r => r.userRefs && r.userRefs[0] === r.actualWinnerRef).length;
  const userPicked = scored.filter(r => r.userRefs).length;

  // The model is graded ONLY on races it actually called. A completed race
  // with no model_snapshots row (the snapshot was never taken before that
  // round's pick deadline — the Dutch GP, raceId 1180, is the first such
  // case) is excluded from BOTH sides of the ratio. Counting it in the
  // denominator alone would read as a loss the model had no opportunity to
  // avoid, which is a scoring artefact, not a measure of the model.
  //
  // Note this is deliberately NOT the same rule as the Season page's Accuracy
  // Tracker: there, a snapshot-less race is still graded, but in the
  // POST-QUALI cohort off a live /predict on the real grid, which is a
  // legitimate test-set number. Here there is no frozen pick at all, so the
  // race simply drops out.
  const modelScoredRows = scored.filter(r => r.modelRefs);
  const modelWins = modelScoredRows.filter(
    r => pickWinnerRef(r.modelRefs, r.modelWinProbs) === r.actualWinnerRef
  ).length;

  return {
    userWins,
    userPicked,
    modelWins,
    modelScored: modelScoredRows.length,
    modelSkipped: scored.length - modelScoredRows.length,
    scored: scored.length,
  };
}
