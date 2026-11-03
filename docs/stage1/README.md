# Stage 1 audit: summary

Read-only audit of f1predictor.app on branch `docs/stage1-audit` (code as of `main` `7b4dae36`). No app code, data file or model artifact was changed; no Supabase credential and no request to the production site or the Render API was used. Effort labels below are **my estimates, not measurements**: S = a day or two, M = about one to two weeks, L = several weeks. Risk is the chance of breaking something users see.

| document | contents |
|---|---|
| [00-scope.md](00-scope.md) | instructions added to later parts; decisions log |
| [01-frontend-audit.md](01-frontend-audit.md) | architecture, routes, hardcoded constants, bundle, accessibility, claims vs measurements |
| [02-model-backtest.md](02-model-backtest.md) | point-in-time check, 43-race out-of-sample backtest, calibration experiments |
| [03-backend-options.md](03-backend-options.md) | options A / B / C with cost, cold start, limits, parity plan |
| [04-data-sources-and-live.md](04-data-sources-and-live.md) | source verification, grid-signal experiment, self-updating and live designs |
| [05-schema-and-pipeline.md](05-schema-and-pipeline.md) | database schema, pipeline, validation catalogue, every manual step |

## Key findings

**Verified (measured or read from code or primary pages):**

1. **The model's scores are not probabilities.** Per race, win scores sum to about 2.9 and podium scores to about 5.2 (should be 1 and 3), and the top scores are over-confident (at 0.9-1.0 predicted win, the observed rate is 0.58 with the real grid and 0.23 with the predicted grid). Raw win Brier is worse than a constant. (02)
2. **With the real grid it ranks well but adds nothing over the grid itself; on the path the site uses before qualifying (predicted grid) it does not beat pre-race standings.** Winner hit 20.9% vs 27.9% for the standings leader. (02)
3. **The predicted grid is the weak link** (Spearman 0.74 with the real grid; pole-sitter named in 7 of 43 races). Cheap post-processing (rescaling each race to sum to 1 and 3) cuts Brier by about half but creates no skill. (02)
4. **Practice best lap and Sprint Qualifying add a small, real, out-of-sample improvement to the grid** (about +0.03 to +0.04 Spearman when blended in the full sample; +0.026 to +0.043 when the weight is fitted on one season and scored on the other, with one of the two intervals including zero); previous race's grid does not help; a crude long-run measure fails. The pole-hit gain is large in point estimate but not established. These signals arrive after today's snapshot is taken (a normal weekend's practice) or after its cutoff (Sprint Qualifying), so they are a *second, later forecast*. (04)
5. **The model inputs are clean:** every feature recomputes exactly from earlier races only (897 rows, 0 mismatches). Only 3 of 14 saved snapshots are genuine foresight picks. (02)
6. **The backend is cold and chatty, not slow:** 25 ms per prediction, 173 MB, but a free-tier wake-up of about a minute and 19 requests (164 kB) on the Season page. (03)
7. **The frontend ships the official F1 logo in the header** (against the brief), has no router, carries about 198 kB (35% of the entry chunk) of mostly unused Supabase code, has contrast and type-size problems, and has copy that contradicted the backtest. (01)
8. **A data defect:** the 2025 Qatar GP has a NULL grid for all 20 drivers (the only such race of 348 since 2010); the existing validator would have caught it had it covered 2025. (05)
9. **Everything season-specific is hand-maintained** in at least 20 places (05). Automation of the snapshot job, secrets, alerts, heartbeat and stale-data guard is already on `main`.

**Conflicting or not verified (do not rely on these):**

- **OpenF1's live price is conflicting** (EUR 9.90/month on its homepage; usage-based per the access form as you report it, and the form now loads as "no longer active"), and its free-tier rate limits differ between two fetches. Live `/location`, `/car_data`, `/intervals` are **reported** unavailable by you; I could confirm only that they hold complete historical data after a session. No live stream was tested (it needs a paid token and a session). (04)
- Sportmonks' price differs on its own page (EUR 69 vs 79) and its licence terms were not read. F1TV's English terms could not be retrieved; my statements about FastF1/F1TV redistribution are inferences. (04)
- Vercel pricing and terms, Supabase's definition of "inactivity", Jolpica's delay after a session, and whether OpenF1's non-commercial licence fits your plans. (03, 04)

## Ranked recommendations

| # | recommendation | why (evidence) | effort | risk |
|---|---|---|---|---|
| 1 | **Remove the official F1 logo and verify the clip-art car's licence** | breaks the stated IP rule; trivial to fix | S | low |
| 2 | **Merge the honesty-copy change** (`fix/honesty-copy`, `b3bb3ceb`, after your Saturday-noon window) | copy said "probabilities"; contrast fix measured on rendered pixels (262/262 failing to 23/263) | done | low |
| 3 | **Fix the Qatar data defect and add the NULL/zero-grid checks** | one race corrupts the real-grid condition; checks cost almost nothing | S | low |
| 4 | **Build the schema and the scheduled, validated, idempotent pipeline (05) and remove the manual steps** | unlocks everything else; today a race weekend needs about 20 hand edits | L | medium (shadow-run two weekends first) |
| 5 | **Precompute predictions and the scorecard into the database; keep a thin live endpoint for `/whatif` (option B)** | Season page 19 calls to 1 (0.6-3.7 kB); removes the cold start from 5 of 6 page types; $0-32/month | M | medium |
| 6 | **Rebuild the frontend on endpoints with real routes**; drop My Picks, anonymous auth, the particle code from the entry chunk; fix type scale, tokens and headings | 01 | L | medium |
| 7 | **Make the scores coherent and honest**: store per-race normalised scores (sum 1 and 3), label them; keep showing rankings and the genuine-foresight scorecard, and keep probability-heavy UI off until calibration is shipped and measured | rescaling alone cuts win Brier by about half (podium by about a quarter); calibration brings the model only to the level of a one-line rank baseline | S-M | low |
| 8 | **Add the pre-qualifying forecast** (practice best lap, Sprint Qualifying) as a separate, labelled `forecast_kind` with its own later freeze | held-out gain is consistent but modest (+0.026 to +0.043 Spearman); needs your policy decision | M | medium |
| 9 | **Live tier**: only after OpenF1 confirms in writing the price model and which topics stream; scope it to a timing tower plus race control and weather | feeds you reported unavailable are the ones a pit-wall view most wants; cost unknown | M-L | medium-high |
| 10 | **Defer a full rewrite (option C), DNF modelling and a retrain** | no evidence they are the bottleneck; DNF modelling was not examined | n/a | n/a |

## Proposed order of work

1. **P0, correctness and IP (days):** logo and licence (1); merge honesty-copy (2); Qatar fix plus the NULL-grid checks (3); apply migration 00008 after Brazil as planned.
2. **P1, foundation (weeks):** schema and pipeline in shadow (4); precomputed predictions and scorecard (5); then the frontend rebuild on those endpoints (6). The redesign consumes endpoints, as the brief requires.
3. **P2, model (weeks, parallel to the end of P1):** coherent scores (7); pre-qualifying forecast as a labelled second forecast (8); an expanding-window calibrator for the production model (02 section 5.5) before any probability-heavy UI.
4. **P3, live:** ask OpenF1 the four questions in 04 section 4.0b first; decide on a paid feed and a worker only after the answers.
5. **P4, polish.**

## Decisions I need from you

1. Remove the F1 logo (and the car art if its licence cannot be shown)?
2. Add a second, pre-qualifying forecast, and accept the extra freeze and, on sprint weekends, the second cutoff (04 section 2.4)?
3. Contact OpenF1 (price model, live topic availability, delayed feed, licence fit), and is the site staying non-commercial?
4. Supabase free or Pro, and Render free or a $7 instance for `/whatif` (03)?
5. Approve the data fix for the 2025 Qatar grid (patch from Jolpica; it changes a committed data file)?
6. Apply migration 00008 after Brazil (the service key already cannot delete; the trigger also freezes updates).

## Reproduce

All analysis is scripted in `analysis/` (numbered 01-14); `analysis/out/` holds the outputs; the raw OpenF1 cache (`analysis/cache/openf1/`, about 28 MB) is not committed and rebuilds on re-run. The Part 1B and 1C experiments have fixed seeds.
