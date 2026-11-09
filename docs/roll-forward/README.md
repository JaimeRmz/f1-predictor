# Roll-forward features: forecasts now include the latest race

## What was wrong
Both models were trained on features that describe the state **entering** a race (everything up to the previous race, `data/f1_master.csv`).
`/whatif`, and the snapshot job that calls it, took each driver's **latest stored row** instead. That row is the state entering the
driver's *last* race, so the forecast for the next race was built one race stale: a result that had just been ingested (Brazil, then Las
Vegas) was invisible to it. The Stage 1 audit had already listed this (`docs/stage1/02-model-backtest.md`, item 2, "effect small"); the
published predicted-grid backtest was measured on the same stale path, so the live forecast matched the backtest. The real-grid path
(`/predict`) always used entering-race features and is unchanged.

## What changed
- `backend/lookups.py` `roll_forward_features(df, next_year, entry_list, standings)` builds, with the notebook's own formulas, the 12 values the
  notebook would store on the **next** race's row: the 7 race-model features and the 5 extra quali-model ones. The constructor comes from the
  entry list, never from the latest row; season features reset at a rollover; a driver with one row works; a driver with no history is dropped.
- `/whatif` and `get_quali_features_for_driver` use it. `/whatif` rejects an entry with neither `constructorRef` nor a known team name (HTTP 422).
  `/whatif/qualifying` (driverRefs only) uses the constructor on the latest row, its documented fallback.
- `/meta` reports `feature_roll: "rolled_forward"` and `features_entering` (the race the features are entering) next to `inputs_as_of` (the data horizon).
- `backend/scripts/snapshot_model_pick.py` sends each entrant's constructor (`season_data.entry_list`), tags the pick `source = whatif_auto_quali_rolled`
  (a text column: no migration), prints the whole field, and **refuses** an API that does not report `features_entering` equal to the race being
  snapshotted. So a snapshot can only be written once the backend with this change is deployed.
- No stored snapshot row is touched.

## Tests (`python backend/scripts/test_roll_forward.py`, offline)
Parity with the master's own row-N features for all 44 races (913 driver-rows x 12 features, 0 mismatches, team switches included);
no leakage (altering results of race N or later changes nothing, and the same alteration without the cutoff does, so the test can fail);
edge cases (rollover, one-row driver, no history, missing constructor, new constructor, team switch, aliases); `/whatif` equals the model run on
the master's row-N features with the predicted grid for every race; `/meta` and the snapshot tag and guard.

## Old vs new backtest (same 43 races, predicted-grid path; only the code differs)
Re-run with `BACKTEST_OUT=analysis/out/rolled BACKTEST_THROUGH_T=202619 python analysis/02_backtest.py` and `analysis/05_report_tables.py`; the
figures published before are kept in `analysis/out/history/pre-roll-forward/`. The comparison is `analysis/27_backtest_old_vs_new.py`; the site's
figures are written by `analysis/29_emit_frontend_figures.py` (nothing is typed by hand).
Same 43 races (2025 + 2026 R1-R19); only the code differs. Winner-pick rows use the Wilson 95% interval the site shows; the bootstrap-by-race 95% interval is in brackets for the model rows.

## Winner picked (hits / 43)

| method | before | after |
|---|---|---|
| **Before qualifying (predicted grid)** | | |
| Model | 9/43 (21%), 11-35% | 14/43 (33%), 20-47% |
| Pick the points leader | 12/43 (28%), 17-43% | 12/43 (28%), 17-43% |
| Pick the best team's lead driver | 13/43 (30%), 19-45% | 13/43 (30%), 19-45% |
| Pick the predicted pole sitter | 8/43 (19%), 10-33% | 12/43 (28%), 17-43% |
| **After qualifying (real grid)** | | |
| Model | 26/43 (60%), 46-74% | 26/43 (60%), 46-74% |
| Pick the points leader | 12/43 (28%), 17-43% | 12/43 (28%), 17-43% |
| Pick the best team's lead driver | 13/43 (30%), 19-45% | 13/43 (30%), 19-45% |
| Pick the predicted pole sitter | 29/43 (67%), 53-80% | 29/43 (67%), 53-80% |

## Model quality, predicted-grid path (bootstrap-by-race 95% interval)

| metric | before | after | difference |
|---|---|---|---|
| winner picked | 0.209 [0.093, 0.326] | 0.326 [0.186, 0.465] | 0.116 |
| top-3 overlap (of 3) | 1.60 [1.40, 1.81] | 1.60 [1.40, 1.81] | 0.00 |
| Brier, win (lower is better) | 0.0887 [0.0794, 0.0980] | 0.0840 [0.0747, 0.0935] | -0.0047 |
| Brier, podium | 0.1133 [0.1020, 0.1253] | 0.1114 [0.1007, 0.1224] | -0.0019 |
| rank correlation of the order | 0.585 [0.520, 0.644] | 0.589 [0.525, 0.648] | 0.004 |

Reading: the ranges overlap heavily (model 11-35% before, 20-47% after; points leader 17-43%), so the accuracy figures are **not significantly
different** and no improvement is claimed. Brier win moves 0.0887 -> 0.0840 and the top-3 overlap does not move. The predicted-pole-sitter rule moves
8 -> 12 hits only because the predicted grid itself changed. The real-grid figures are identical. Model page extras (predicted-grid podium ROC-AUC
0.909 -> 0.913, winner 0.904 -> 0.916, recall 86.0 -> 88.4 %, top-10 grid overlap 79.0 -> 79.5 %) come from `analysis/28_model_page_figures.py`, which on the
old rows reproduces the published numbers exactly.

## Snapshots made with the lagging inputs
Four stored snapshots were produced by `/whatif` with the stale features: **1181, 1182, 1183 and 1188** (Brazil: `source = whatif_auto_quali`,
`inputs_as_of_race_id` 1187). They are left exactly as frozen. Only 1188 stores its provenance; the other three are inferred from their dates and the
script's history (no result rows existed when they were taken, so `/whatif` was the only possible path). The eleven snapshots 1169-1179 were backfilled
through `/predict` with the real grid (hindsight, entering-race features). New picks carry `whatif_auto_quali_rolled` and are not directly comparable with
the four older ones.
