# Stage 1 follow-up B: the minimal slice before Las Vegas (design only)

**Design only. No code was written for this, no workflow, data file, Supabase object or production artifact was touched.** Dates are from the Jolpica schedule I checked on 2026-11-03.

## 1. The constraint

| date (UTC) | event |
|---|---|
| Sat 7 Nov 18:00 | Brazil qualifying and snapshot cutoff (12:00 CST; my reading of "Saturday noon" for the merge freeze) |
| Sun 8 Nov 17:00 | Brazilian GP |
| **Thu 19 Nov 04:00** | **Las Vegas snapshot window opens** (48 hours before its cutoff) |
| Fri 20 Nov 00:30 / Sat 21 Nov 04:00 | Las Vegas FP1 / **qualifying (the snapshot cutoff)** |
| Sun 22 Nov 04:00 | Las Vegas GP |

So there are roughly **ten days between the Brazil race and the Las Vegas window**. Brazil is the natural live rehearsal; Las Vegas, Qatar and Abu Dhabi are all normal weekends per the Jolpica schedule (no sprint), so the slice need not handle sprint weekends in 2026. The full pipeline and schema of `05` (weeks of work) will not exist by then; this slice is what can realistically exist, be rehearsed on Brazil, and be trusted for Las Vegas.

**What a race weekend costs by hand today** (from `05`, section 5): about 20 manual steps. Seven of them happen after every race and each one has already caused a defect or a near miss in this project: the ingest command, a missing driver (Hirakawa), the notebook rebuild (it once failed silently on a missing join and also rewrites the model pickles), the `lookups.pkl` rebuild, five hand-edited frontend constants, the Season page's standings array, and noticing data defects by luck (the Qatar NULL grid).

## 2. The slice: one command

A single command that does everything *data-side* for one race and **stops short of anything that touches production**:

```
python backend/scripts/run_race_update.py --season 2026 --round 20      (proposed name)
```

It works on a fresh branch (`data/<race>`), writes only to the working tree, **never pushes and never merges**, and ends by printing a review checklist. It is idempotent: running it again after a partial result (Jolpica often lags) changes nothing that is already correct.

| # | stage | what it does | fails loudly when |
|---|---|---|---|
| 0 | preflight | clean git tree on a new branch; Jolpica reachable; the round exists in `races.csv`; the race is in the past; not a sprint weekend (unsupported in this slice, so it refuses rather than guessing) | any of those is false |
| 1 | fetch to staging | the existing `build_all` logic (results, qualifying, driver and constructor standings) into temporary files, not straight into `data/` | an unmapped driver/constructor/status slug (it names it) |
| 2 | new-driver proposal | for an unknown driver slug, fetch Jolpica's driver record and print the proposed `drivers.csv` row (Hirakawa precedent); written only if you pass `--accept-new-drivers` | unknown slug without the flag |
| 3 | validate | the catalogue checks that can run on CSVs: row count equals entrants, schema, **no NULL grid, no more than 25% zero grids**, positions are a permutation, points match the scoring table, standings equal previous standings plus this race, every join resolves; plus the existing field-by-field comparison with Jolpica | any check fails (nothing is promoted) |
| 4 | promote | append the staged rows to the CSVs (the existing append code) | a duplicate raceId already present |
| 5 | rebuild master | run the notebook **in a scratch copy** (about 35 s, the procedure used in Stage 0 and for the Qatar fix), copy back **only** `f1_master.csv` | model pickles differ from the committed ones; any existing master row changed unexpectedly; row count is not (results rows since 2010); the new race's rows are missing |
| 6 | rebuild lookups | `build_lookups.py`, then confirm the model artifact hashes are unchanged (the same `m-...` hash `/meta` reports) | hash mismatch |
| 7 | derive the constants | generate one file, `frontend/src/generated/season.js`, from the CSVs and the Jolpica schedule: `NEXT_RACE` (with all session times), the completed and upcoming race lists, the roster (OpenF1's entry list if present, else the "raced 2 of the last 3" rule, flagged), driver-to-team map, the Season page's standings table and race counters, calendar flags | the next race has no published session times, or the roster has fewer than 20 drivers |
| 8 | report | print what changed (rows added, files touched), every validation result, the Las Vegas snapshot window time from the same logic the workflow uses, the stale-data horizon the deployed API will need to show, and the exact next manual steps | n/a |

**A one-time frontend refactor makes stage 7 possible:** `constants.js` currently *defines* `NEXT_RACE`, `COMPLETED_2026`, `UPCOMING_RACES_2026`, `STANDINGS_GRID_2026`, `CONSTRUCTOR_OVERRIDES` and the Season page defines its own standings array. The refactor makes `constants.js` re-export those names from `generated/season.js` (same names and shapes, so no page changes), and deletes the hand-typed copies. Team colours and circuit-to-country stay hand-written: they are design choices and change once a season.

## 3. Which of the 20 manual steps it removes

Numbers refer to the table in `05-schema-and-pipeline.md` section 5.

| # | step | effect of the slice |
|---|---|---|
| 1 | run the ingest command and commit CSVs | **removed** (stages 1, 4) |
| 2 | add new drivers/constructors | **partly** (detected, row proposed; you confirm with a flag) |
| 3 | edit `races.csv` for calendar changes | **partly** (stage 0 compares the calendar to Jolpica and refuses if the upcoming race's times differ; no automatic rewrite) |
| 4 | notebook rebuild of `f1_master.csv` | **removed** (stage 5, with the guards the manual run lacked) |
| 5 | rebuild `lookups.pkl` | **removed** (stage 6) |
| 6 | merge to `main` to deploy | **not removed** (still a human merge; data is still in git) |
| 7 | edit `NEXT_RACE`, race lists, roster, flags, nav label | **removed** (stage 7, after the refactor) |
| 8 | hand-edit the Season page standings and counters | **removed** (stage 7) |
| 9 | driver-to-team map | **partly** (generated from results; colours remain hand-written) |
| 10 | backfill policy list in `snapshot_model_pick.py` | not removed |
| 11 | strategy fetch with a hardcoded race range, then rebuild | not removed (optional later flag) |
| 12 | Model page numbers | not removed |
| 13 | Season page's 19 `/predict` calls | not removed (needs the scorecard endpoint, `03`) |
| 14 | spot-check history for appeals | **partly** (stage 3 re-runs the existing full comparison and reports drift; no versioning) |
| 15 | noticing data defects by luck | **removed for new races** (NULL/zero-grid, positions, points, standings checks run on every update) |
| 16 | apply migrations by hand | not removed (deliberate) |
| 17 | set secrets | not removed (deliberate) |
| 18 | confirm the deploy went right | **partly** (stage 8 prints the exact `/meta` model hash and data horizon to look for) |
| 19 | retrain and version a model | not removed (**deliberately manual**) |
| 20 | annotate a missed snapshot | **partly** (stage 8 shows the snapshot window for the next race from the workflow's own logic) |

**Count:** 6 fully removed (1, 4, 5, 7, 8, 15), 6 partly (2, 3, 9, 14, 18, 20), 8 untouched (6, 10, 11, 12, 13, 16, 17, 19), of which 16, 17 and 19 are deliberate. After a race the remaining human work is: run one command, read its report, review the diff, push the branch, merge, and look at `/meta`.

## 4. Effort (estimates, not measurements)

| piece | estimate |
|---|---|
| orchestration script, preflight and report (stages 0, 4, 8) | 0.5-1 day |
| validation stage on CSVs (stage 3; most checks are small) | 1 day |
| scripted notebook build with its guards (stages 5, 6) | 0.5 day (the procedure already exists and was run twice) |
| derived-constants generator and the one-time frontend refactor (stage 7) | 1.5 days |
| tests and the Brazil rehearsal (section 6) | 1 day |
| **total** | **about 4-5 working days** |

Fits before the Las Vegas window only if started now and rehearsed on Brazil (race Nov 8, command run Nov 9, fixes by Nov 14, Las Vegas weekend as the first "real" use).

## 5. Risks

| risk | why it matters | mitigation |
|---|---|---|
| **The frontend refactor changes what visitors see** | a generator bug could show a wrong next race or roster | the replay test below must reproduce today's constants exactly for round 19 before the refactor is merged; screenshot comparison of Next Race, Season and Championship |
| **The notebook is the weakest link** | it needs Jupyter, it can overwrite model pickles, it once failed silently | it runs in a scratch copy only; the command refuses unless the pickles are byte-identical and existing master rows are unchanged (both checks exist today as manual steps) |
| **Jolpica lag or partial results** | a half-published race would otherwise be ingested | stage 3 requires the row count to equal the entrants; a failed run changes nothing and can be re-run |
| **Roster guess** | a substitute driver (Hirakawa) or a late change breaks the next race's field | OpenF1's list first (verified: Brazil's 22 drivers were listed 82 hours early), the inference rule as fallback, and a `--roster` override flag; the report prints which source was used |
| **Single command, single point of failure** | one bug blocks every race | it is only a wrapper over steps that exist and are proven; the manual path stays available as a fallback |
| **Sprint weekends unsupported** | the next sprint is in 2027 | refuses explicitly; fixed in the full pipeline |
| **Merge freeze and deploy ordering** | nothing may reach `main` before Saturday noon | the command only ever works on a branch; merging stays a human decision (decision 5 branch and honesty-copy are already waiting) |
| **It does not fix appeals, versioning or the cold start** | the slice is not the pipeline | stated plainly: those need the schema work in `05` and the backend work in `03` |

## 6. Verification plan (before relying on it)

1. **Replay test (the strongest):** in a temp copy of the repo, delete round 19's rows (results, qualifying, standings, master) and run the command for round 19. The result must equal today's committed files **row for row**, the model hashes must be unchanged, and the generated constants must equal the hand-written ones currently in `constants.js` and the Season page.
2. **Failure injection:** feed it a Qatar-style NULL grid (must fail naming the check), an unknown driver slug (must fail naming it), a result set with 19 of 22 rows (must fail), and a changed model pickle (must refuse).
3. **Idempotence:** run it twice; the second run must change nothing.
4. **Brazil rehearsal:** after the race, run it for real on a branch, compare with a hand ingest done in parallel (the old way), and only then trust it for Las Vegas.

## 7. What this deliberately does not do

No database, no scheduled workflow, no live tier, no scorecard endpoint, no second forecast, no retrain, no frontend rebuild beyond the one refactor, no change to the snapshot job. It is the smallest change that stops a race weekend from needing a dozen careful hand edits, and it leaves the larger design in `03` and `05` intact; everything it builds (validation checks, scripted build, generated constants) is reused by the full pipeline.
