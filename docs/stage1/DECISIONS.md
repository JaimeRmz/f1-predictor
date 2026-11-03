# Stage 1: decisions recorded

Recorded 2026-11-03 on `docs/stage1-audit`. These are the owner's decisions on the six questions raised after Part 1D, plus one housekeeping item. Where a decision required work, the work and its evidence are listed. Nothing here was merged to `main`; `origin/main` is still `7b4dae36`.

## The decisions

| # | question | decision | status |
|---|---|---|---|
| 1 | Remove the official F1 logo / car art? | **Keep the logo as it is. No replacement. Stage 2 adds no new official marks.** Car-art licence: check and report only, do not replace. | logo: no action. Licence checked (below) |
| 2 | Add a second, pre-qualifying forecast? | **Not now.** Keep `forecast_kind` in the schema design. | nothing to build; schema design unchanged |
| 3 | Contact OpenF1? | **Draft the message; the owner will send it.** The site is a **non-commercial portfolio project with no ads or payments planned.** Ask the four questions. **Nothing blocks on the reply.** | draft written: `openf1-message-draft.md` (not sent) |
| 4 | Supabase / Render plans? | **Stay on Supabase free and Render free. Re-decide when the site reads from Supabase.** | no action; re-decision trigger recorded |
| 5 | Qatar grid and Verstappen's qualifying number? | **Approved**, on its own branch `fix/data-qatar-grid`, **not merged until after Saturday noon.** | done on the branch, pushed, not merged |
| 6 | Migration 00008? | **Approved in principle.** First test on a throwaway local Postgres and report; **apply to production only after the Brazil snapshot exists.** | tested: 25 of 25 pass; not applied |
| 7 | Cache hygiene | Add `analysis/cache/openf1/` to `.gitignore` and commit it. | done (`29076165`) |

### Notes and evidence

**1. Logo and car art.** Recorded as the owner's decision. For the record, the facts stay as audited in `01-frontend-audit.md`: `public/f1-logo.png` is the official Formula 1 mark and is shown in the header of every page; the brief's rule said no official marks. The decision is that this stays and that Stage 2 will not add any further official mark.
*Car-art licence (report only; nothing replaced).* `frontend/public/f1-car.png` (the image the site loads) has no embedded metadata and no recorded provenance (it was committed in `7bbdb25b` without a note). The unused `frontend/public/f11-car.svg` in the same folder does carry metadata: title "Formula One Car", creator **Gerald_G**, date 2007-11-15, source `openclipart.org/detail/8554/formula-one-car-by-gerald_g-8554`, and a Creative Commons **public domain** licence tag. Rendering that SVG shows the same red car with "OCAL" (Open Clip Art Library) on the side, and compared pixel by pixel at the PNG's size (641 x 213) the two differ by a mean of 3.5 out of 255 (3.2% of pixels differ, consistent with edge antialiasing), so the PNG is very probably a raster export of that artwork. Openclipart's own page footer says "Openclipart is 100% Public Domain" and states no attribution requirement. **Conclusion:** the car art appears to be public-domain clip-art; no replacement needed. **Caveats:** that the PNG derives from this SVG is an inference from the match, not a recorded fact; I read the licence from the Openclipart site and the file's metadata, not a legal opinion; crediting Gerald_G is optional but courteous.

**2. Second forecast.** Deferred. The held-out result (`04`, section 2.5) stays on record: a modest, consistent gain, but with the freeze and cutoff complications described in section 2.4. `forecast_kind` remains in the `predictions` and `snapshots` design in `05` so the option stays open.

**3. OpenF1 message.** `openf1-message-draft.md` asks the four questions (pricing model and a quote for the expected use; which live topics stream today and when `intervals`, `location`, `car_data` return; whether a 30-60 second delayed feed exists; whether a free non-commercial public site is within the licence, and what attribution and limits apply). It states the project is non-commercial with no ads, payments or paid tier. I did not contact OpenF1. Nothing in the plan waits for an answer: the live tier simply stays unscheduled until one arrives.

**4. Hosting.** Stay free on both. The trigger to revisit is the day the site starts reading predictions and the scorecard from Supabase (README recommendation 5), because that is when a free-tier pause (a project is paused after a week of inactivity; what counts as activity was not verified) would break every page rather than one.

**5. Qatar data fix.** Branch `fix/data-qatar-grid`, commit `e69bd7cd`, **pushed, not merged.**
- `results.csv`: `grid` filled for the 20 rows of raceId 1167 from Jolpica (20 lines changed, the grid column only; CRLF endings preserved).
- `qualifying.csv`: Verstappen's car number 33 changed to 1 (Jolpica, and consistent with `results.csv`).
- `f1_master.csv` rebuilt (notebook run in a scratch copy): only `grid` (20 rows), `position_gain` (20 rows) and `driver_wet_delta` (360 rows in 2026) change. None of these is among the models' 9 race features or 6 quali features. The six model pickles are byte-identical and `lookups.pkl` is unchanged.
- **Verified:** real-grid predictions for all 43 backtest races match the Part 1B golden file to 1.1e-16 (that file was produced with an in-memory patch of the same values); the predicted-grid path is identical on 4 sample races; the validator's comparison for 2025 round 23 reports **0 mismatches (was 21)**.

**6. Migration 00008, tested locally.** `analysis/15_test_migration_00008.mjs` applies the repo's real migrations 00003, 00004, 00005, 00007 and 00008 to a throwaway in-process Postgres (PGlite, installed in a temp directory outside the repo) and runs 25 assertions. **All 25 pass:**
- INSERT works (as owner, and as `service_role` with the pilot's exact column set; the stored `cutoff_at` equals `2026-11-07T18:00:00Z`);
- UPDATE before `cutoff_at` works (including the `--force` replacement path as `service_role`);
- UPDATE after `cutoff_at` is refused (owner, `service_role`, and an upsert);
- `race_id` and `cutoff_at` cannot change on an open snapshot (later, earlier, or NULL);
- DELETE is refused on open and frozen rows, and the trigger refuses it even if `service_role` were granted DELETE;
- rows with NULL `cutoff_at` are frozen immediately;
- a zero-row UPDATE (what the old access probe sent) does not error, and the escape hatch (disable then re-enable the trigger) works;
- a row whose cutoff passes 2 seconds later flips from updatable to refused.
**Limits of this test, stated plainly:** it ran on PGlite, not Supabase's Postgres; the roles are stand-ins for Supabase's; row-level security and PostgREST were not exercised; the base table is a minimal reconstruction (it is not in the repo's migrations).
**Conditions to apply it (all still open):** (a) the Brazil snapshot exists with `cutoff_at` set; (b) the test row `race_id 0` is deleted first (after 00008 it can no longer be deleted without disabling the trigger); (c) apply in the SQL editor; (d) afterwards confirm an update to the Brazil row is refused. The 14 existing snapshots have NULL `cutoff_at`, so they become immutable the moment it is applied, which is intended. I cannot check (a) or (b) from here (no Supabase access in this phase).

**7. `.gitignore`.** `analysis/cache/openf1/` (238 files, about 28 MB, never in history) is now ignored; the one tracked cache file (`analysis/cache/jolpica_2025_r23_results.json`, needed to reproduce the Qatar patch) stays tracked.

## Branches waiting on the Saturday-noon freeze

| branch | head | what | merged? |
|---|---|---|---|
| `fix/honesty-copy` | `b3bb3ceb` | copy and contrast fix | no |
| `fix/data-qatar-grid` | `e69bd7cd` | Qatar grid and qualifying-number fix | no |
| `docs/stage1-audit` | see `git log` | this audit | no (docs only) |

## Follow-ups completed after these decisions

- **A.** `06-retrain-experiment.md`: walk-forward retraining on the 43 races (read-only).
- **B.** `07-minimal-slice.md`: the smallest change that removes the most manual per-race steps before Las Vegas (design only).
