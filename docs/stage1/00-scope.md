# Stage 1: scope additions and decisions log

This file records instructions added to later Stage 1 parts, so they are not lost between sessions. Each item is **not yet done** unless marked otherwise.

## Added to Part 1C (backend, data sources, live)

**Test whether three pre-qualifying signals improve the predicted grid**, using OpenF1 and FastF1 historical data:

1. practice pace: FP2 / FP3 long-run pace;
2. sprint-qualifying results (on sprint weekends);
3. the previous race's grid.

*Why this is the right question:* `02-model-backtest.md` sections 4.5 and 5.2 show the quali model's predicted grid (Spearman 0.74 vs the real grid; pole-sitter named in 7 of 43 races) is the largest single source of error on the path the snapshot job and the Next Race page use. Fixing probabilities by rescaling or calibration does not create ranking skill; a better grid might.

*What the test needs to state up front (so it is not fishing):* the baseline (the production quali model's predicted grid, and the "previous race's grid" and "standings order" baselines), the metric (Spearman and pole-hit against the real grid, plus the downstream effect on race-level Brier / winner hit using the same replay), the evaluation set (2023-2026 where the sources have data, chronological, never fit on the races being scored), and the coverage limits of each source (which sessions and years actually exist, and how much of 2026 is available). Any improvement must be reported with bootstrap-by-race intervals and the sample size, like Part 1B.

*Constraints from the brief:* public reads only, cached and rate-limited; no official F1 live-timing scraping; findings about licensing and coverage verified, not assumed.

## Added to Part 1D (schema and automation)

**A validation check for NULL / all-zero grids**, motivated by the 2025 Qatar GP (raceId 1167): `results.csv` has `grid` NULL for all 20 drivers, which `prepare_df` silently turns into 0 ("pit lane") for everyone. The check must:

- fail loudly (not warn) during ingest and in the weekly validation job when any race has `grid` missing for more than a small fraction of its entrants (and, separately, when *every* entrant has grid 0 or NULL);
- compare against Jolpica's grid for that race rather than only testing for NULLs, so a plausible-looking wrong grid is also caught;
- be part of the "join-drop / row-count / schema" family of checks described in the brief, and run on every ingested race (not only the latest).

The existing `--validate` did not catch this. **Verified (by reading `update_from_jolpica.py`):** its scan covers ingested **2026** races only (`ingested_2026_races()`), so raceId 1167 (2025) is outside its range. **Not tested:** whether it would flag the defect if 2025 were in range; it compares every column of `results.csv` against Jolpica, so it very likely would, but that was not run. Part 1D should test it rather than assume.

## Decisions log

- Stage 1 part order (as instructed): 1B (done) -> 1A (done) -> 1C -> 1D. Each part is pushed to `docs/stage1-audit` and followed by a stop.
- The 2025 Qatar grid defect is patched **in memory only** inside the audit scripts. No data file was modified.
- My Picks is out of scope for every part.
