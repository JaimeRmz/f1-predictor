// Season tally for the My Picks results view, kept as a pure function of the
// built row list so it can be unit-tested without React or the network.
//
// A row is { resultKnown, actualWinnerRef, userRefs, modelRefs }, where
// userRefs / modelRefs are an ordered [p1, p2, p3] of driverRefs or null.

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
  const modelWins = modelScoredRows.filter(r => r.modelRefs[0] === r.actualWinnerRef).length;

  return {
    userWins,
    userPicked,
    modelWins,
    modelScored: modelScoredRows.length,
    modelSkipped: scored.length - modelScoredRows.length,
    scored: scored.length,
  };
}
