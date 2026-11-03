# Stage 1, Part 1D: database schema and the self-updating pipeline

Branch `docs/stage1-audit`. A **design proposal**: no table was created, no migration applied, no Supabase credential used. The SQL below is **untested against a database** (no Postgres was available here); it is meant to be reviewed and run on a copy first. Facts about the current system are from Parts 1A-1C; "verified" means measured or read from code in this audit.

## 1. Design principles

1. **Jolpica is the record; OpenF1 is a cross-check and a signal source.** When they disagree, the pipeline stops and says so; it never picks silently.
2. **Every published row says when it was true and where it came from** (`as_of`, `source`, `model_version`). The site's "data last updated" badge reads one `pipeline_status` row, never a guess.
3. **Results are versioned, not overwritten.** Appeals change classifications (Monaco was reclassified twice); the old version stays, the new one becomes current, and anything derived from it is recomputed.
4. **Ingest is stage, validate, promote.** Rows land in staging, every check runs, and only a fully passing batch is promoted in one transaction. A failed run leaves the last good data published.
5. **Idempotent by construction.** Natural keys plus content hashes make a repeated run a no-op.
6. **Frozen means frozen.** Snapshots are immutable after their cutoff (migration 00008, written, not applied); predictions are append-only.
7. **Honest names.** Model outputs are stored as `*_score`, not `probability`, until calibration ships (Part 1B).
8. **Retraining is never automatic.** A new `model_version` exists only when a human inserts and approves it.

## 2. Schema (proposed)

```
seasons ─< races ─< sessions
              │  ├─< entries (who raced, in what car)
              │  ├─< results ──< result_revisions
              │  ├─< qualifying
              │  ├─< standings_driver / standings_constructor
              │  └─< predictions >── models
              └─< snapshots (frozen copy of a pre-cutoff prediction)
drivers, constructors, circuits   (reference)
ingest_runs ─< validation_results ;  pipeline_status ;  live_state (tier 2)
```

```sql
-- reference ---------------------------------------------------------------
create table seasons (
  year int primary key,
  regulation_era text not null,            -- e.g. '2022-2025 ground effect', '2026 new technical regs'
  points_system jsonb not null,            -- {"race":[25,18,...],"sprint":[8,7,...],"fastest_lap":false}
  created_at timestamptz not null default now()
);
create table circuits     (circuit_id int primary key, circuit_ref text unique not null, name text, country text);
create table drivers      (driver_id int primary key, driver_ref text unique not null, code text, forename text, surname text, dob date, nationality text, jolpica_id text unique);
create table constructors (constructor_id int primary key, constructor_ref text unique not null, name text, jolpica_id text unique);

-- calendar -----------------------------------------------------------------
create table races (
  race_id int primary key,                  -- keep today's raceId (models and snapshots reference it)
  season int not null references seasons(year),
  round int not null,                       -- MUTABLE: renumbering happens (Bahrain-in-Malaysia insertion)
  circuit_id int not null references circuits,
  name text not null,
  status text not null default 'scheduled'  -- scheduled | postponed | cancelled | completed
    check (status in ('scheduled','postponed','cancelled','completed')),
  scheduled_start timestamptz not null,     -- race start (UTC)
  original_start timestamptz,               -- set when postponed/moved
  schedule_as_of timestamptz not null,
  unique (season, round)
);
create table sessions (
  session_id bigint generated always as identity primary key,
  race_id int not null references races,
  kind text not null check (kind in ('fp1','fp2','fp3','sprint_quali','sprint','quali','race')),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,                -- OpenF1 sessions.date_end when known
  status text not null default 'scheduled', -- scheduled | in_progress | ended | cancelled | postponed
  openf1_session_key int,
  unique (race_id, kind)
);
create table schedule_changes (             -- append-only log of every calendar diff
  id bigint generated always as identity primary key,
  detected_at timestamptz not null default now(),
  race_id int references races, session_id bigint references sessions,
  field text, old_value text, new_value text, source text
);

-- who raced -----------------------------------------------------------------
create table entries (                      -- the entry list, per race
  race_id int references races, driver_id int references drivers,
  constructor_id int not null references constructors,
  car_number int,
  is_substitute boolean not null default false,   -- e.g. Hirakawa for Ocon at Mexico City
  provenance text not null check (provenance in ('openf1_entry_list','jolpica_results','inferred_last3')),
  as_of timestamptz not null,
  primary key (race_id, driver_id)
);

-- results (versioned) -------------------------------------------------------
create table results (
  race_id int references races, driver_id int references drivers,
  version int not null,                     -- 1, 2, ... bumped by a reclassification
  constructor_id int not null references constructors,
  grid int,                                 -- NULL only for a genuine missing value; validation forbids it for completed races
  pit_lane_start boolean not null default false,
  position int, position_text text, position_order int not null,
  points numeric not null, laps int, status text not null,
  classified boolean not null,
  is_current boolean not null default true,
  as_of timestamptz not null, source text not null, source_hash text not null,
  primary key (race_id, driver_id, version)
);
create unique index results_one_current on results (race_id, driver_id) where is_current;
create view results_current as select * from results where is_current;

create table result_revisions (             -- one row per detected change
  id bigint generated always as identity primary key,
  race_id int references races, from_version int, to_version int,
  detected_at timestamptz not null default now(),
  diff jsonb not null,                      -- {driver_id: {field: [old,new]}}
  points_changed boolean not null,
  reason text,                              -- filled by a human for anything older than N weeks
  approved_by text, approved_at timestamptz
);
-- qualifying and sprint results follow the same pattern (versioned, is_current).
create table standings_driver      (race_id int, driver_id int, points numeric, position int, wins int, as_of timestamptz, source text, primary key (race_id, driver_id));
create table standings_constructor (race_id int, constructor_id int, points numeric, position int, wins int, as_of timestamptz, source text, primary key (race_id, constructor_id));
-- standings are RECOMPUTED from results_current and compared with the source; a difference fails validation.

-- models and predictions ----------------------------------------------------
create table models (
  model_version text primary key,           -- the artifact hash the API already exposes (/meta), e.g. m-a6621e96c549
  trained_through_year int not null,
  artifact_sha256 text not null,
  git_commit text,
  created_at timestamptz not null default now(),
  approved_by text, approved_at timestamptz, -- NULL until a human approves; the pipeline refuses unapproved versions
  notes text
);
create table predictions (                  -- append-only
  prediction_id bigint generated always as identity primary key,
  race_id int not null references races, driver_id int not null references drivers,
  model_version text not null references models,
  path text not null check (path in ('real_grid','predicted_quali')),
  forecast_kind text not null check (forecast_kind in ('pre_weekend','pre_quali')),   -- see 04, section 2.4
  as_of timestamptz not null,
  inputs_as_of_race_id int not null references races,   -- newest race in the data the model saw (the stale-data guard checks this)
  grid_used int,
  win_score real not null, podium_score real not null,  -- NOT probabilities (Part 1B)
  win_score_normalised real, podium_score_normalised real  -- per-race rescaled to sum 1 and 3 (Part 1B 5.1); nullable, labelled as such
);
create index on predictions (race_id, forecast_kind, as_of desc);
create view predictions_latest as
  select distinct on (race_id, driver_id, path, forecast_kind) * from predictions
  order by race_id, driver_id, path, forecast_kind, as_of desc;

-- snapshots (the existing public.model_snapshots stays; additions only) -----
--   keeps race_id, predicted_p1..p3, p*_win, p*_podium, snapshotted_at; 00007 adds
--   model_version, git_commit, inputs_as_of_race_id, cutoff_at, source; 00008 freezes rows after cutoff_at.
--   Proposed addition: forecast_kind text, prediction_set_as_of timestamptz (links the frozen row to the predictions it copied).

-- scorecard: the one public accuracy source -----------------------------------
create view scorecard as
select s.race_id, s.forecast_kind,
       (s.snapshotted_at < s.cutoff_at) as genuine_foresight,       -- 3 of the 14 current snapshots (Part 1B)
       s.predicted_p1, s.predicted_p2, s.predicted_p3,
       r.top3 as actual_top3, r.winner as actual_winner,
       (s.predicted_p1 = r.winner) as winner_hit
from model_snapshots s join race_outcomes_current r using (race_id);
-- race_outcomes_current is a view over results_current (winner, ordered top 3).

-- operations ------------------------------------------------------------------
create table ingest_runs (
  run_id bigint generated always as identity primary key,
  job text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check (status in ('running','succeeded','failed','skipped_nothing_due')),
  race_id int, source_urls text[], rows_staged int, rows_promoted int, error text, git_sha text
);
create table validation_results (
  run_id bigint references ingest_runs, check_name text, severity text check (severity in ('error','warning','info')),
  passed boolean not null, detail jsonb, primary key (run_id, check_name)
);
create table pipeline_status (              -- ONE row; drives the site's "data last updated" badge
  id int primary key default 1 check (id = 1),
  last_success_at timestamptz, last_data_as_of timestamptz, last_failure_at timestamptz, last_error text,
  inputs_as_of_race_id int, model_version text
);
create table live_state (                   -- tier 2: one row per session, overwritten every ~5 s
  session_id bigint primary key references sessions,
  source_ts timestamptz not null, server_ts timestamptz not null default now(),
  status text not null check (status in ('live','delayed','no_live_data','final')),
  payload jsonb not null
);
```

**Access control (outline).** Row-level security on every table. The anonymous (publishable) key gets `select` on views only (`results_current`, `predictions_latest`, `scorecard`, `pipeline_status`, `live_state`, calendar). The service key (GitHub Actions secret) writes. Frozen snapshots: trigger from 00008. This also removes the need for any visitor to authenticate (Part 1A finding 3).

**Why keep `race_id`.** The models, snapshots and 14 existing rows use it; changing the key would break the golden parity dataset (Part 1C). `round` is deliberately mutable; matching to external sources is by circuit, never by round (the Stage 0 policy).

## 3. How each hard case is handled

| case | design |
|---|---|
| **Appeals / reclassification** | The re-validation job (daily for 3 days after a race, then weekly, last 4 races) fetches Jolpica again and compares to `results_current`. A difference writes a new `results` version, flips `is_current`, writes `result_revisions` with a diff, **recomputes standings and the scorecard actuals**, and opens a notification issue. If points changed or the race is older than 3 weeks, it requires a human `approved_by` before promotion (Monaco precedent). **Snapshots are never edited** (frozen); only the *actuals* they are scored against change, and the scorecard records which `results.version` it used. |
| **Postponement / cancellation** | The daily schedule job diffs Jolpica (and OpenF1 `sessions`, which has an `is_cancelled` flag) against `races`/`sessions`. A change inside 7 days writes `schedule_changes`, sets `status`, and alerts. The snapshot logic reads the cutoff from `sessions`, so a moved session moves the deadline and a postponed race is not reported "missed". |
| **API outage** | Retries with backoff and jitter; the run fails closed. Nothing partial is promoted; the previous data and its true `as_of` stay published. After 3 consecutive failed runs an issue is opened; the heartbeat covers the case where nothing runs at all. |
| **Conflicting sources** | A check compares Jolpica to OpenF1 where both have the field (starting grid, classified count, driver list). A disagreement is an `error`, listing both values; resolution is a human decision recorded in `result_revisions.reason`. The pipeline never averages or chooses. |
| **Roster changes** | `entries` is filled in order of trust: (1) OpenF1's driver list for the weekend (verified: Brazil's 22 drivers, with Ocon not Hirakawa, were listed 82 hours before FP1, while Mexico's list correctly had Hirakawa; caveat: possibly pre-populated); (2) Jolpica results after the race (also marks `is_substitute`); (3) the "raced in at least 2 of the last 3 rounds" inference as a last resort, flagged `inferred_last3`. A driver slug missing from `drivers` fails the run by name, then is added from Jolpica's driver endpoint after review (Hirakawa precedent). |
| **Season transition** | In December the calendar job creates the `seasons` row (with `regulation_era`) and the new `races`/`sessions`. Round-1 features use the previous season exactly as the model already does; the roster comes from OpenF1/Jolpica entry data. A regulation change sets a monitoring flag: the scorecard separates eras and the retraining decision stays human. |
| **Missing/NULL values** | See the NULL-grid check below. A NULL is never silently coerced to 0 (the current `prepare_df` does that; the Qatar defect). |

## 4. The pipeline

Runs on GitHub Actions (public repo: no cost; 5-minute minimum interval, best-effort, default branch only, 60-day inactivity auto-disable; the Stage 0 heartbeat and the optional external ping cover a stopped schedule). Render's free tier is not used for scheduled work (no cron there).

```
schedule-sync (daily)  ->  gate (every 15 min) ->  fetch  ->  STAGE  ->  VALIDATE  ->  PROMOTE (one transaction)
                                                                              |             |
                                                                         fail loudly    standings cross-check
                                                                         (issue+Discord)       |
                                                       build features/lookups (deterministic module, not a notebook)
                                                                              |
                                          stale-data guard -> predictions (approved model_version) -> publish -> pipeline_status
```

**Gate.** Reads `sessions`; exits in seconds unless a session ended within the last 6 hours and its data is unpublished, or a re-validation is due.

**Feature build without the notebook.** Today `f1_master.csv` is produced by executing a notebook, which also overwrites the model pickles, and a rebuild once "failed silently on a missing join". Replace that step with a deterministic module extracted from the notebook cells, with **join-drop assertions** (row counts before and after each merge must match; any drop fails). Parity test: it must reproduce the committed `f1_master.csv` value-for-value (in Stage 0 the notebook reproduced every existing row exactly and added only the new rows), and `lookups.pkl` must be recomputed from it with the existing `compute_lookups`. The model artifacts are never touched by this step.

**Predictions.** Computed with the approved `model_version`, after the stale-data guard (the backend's data horizon must include the latest completed race), written to `predictions` with `as_of` and `inputs_as_of_race_id`. If a second, pre-qualifying forecast is adopted (Part 1C 2.4), it is a separate `forecast_kind` with its own, later freeze.

### 4.1 Validation catalogue (any `error` fails the run)

| # | check | rule | why / evidence |
|---|---|---|---|
| 1 | row count | results rows == entrants for the race; qualifying rows == entrants; standings rows >= entrants | join drops |
| 2 | schema | column set and types match the contract | the notebook "missing join" failure |
| 3 | **NULL grid** | a completed race may have **no NULL `grid`**; fail if any | **Since 2010, exactly 1 of 348 races has any NULL grid: raceId 1167 (2025 Qatar GP), all 20 rows** |
| 4 | **zero-grid share** | fail if more than **25%** of entrants have `grid = 0` | max in the data is 20% (pit-lane starts); the Qatar race coerced to 100% |
| 5 | **grid vs source** | each driver's grid equals Jolpica's and OpenF1's starting grid, except documented penalties | catches a plausible-looking wrong grid, not just NULLs |
| 6 | positions | `position_order` is a permutation of 1..n; classified drivers precede unclassified | |
| 7 | points | per-driver points equal the season's scoring table (race, sprint) | |
| 8 | standings | recomputed standings from `results_current` equal the source standings; after the race = before + this race's points | |
| 9 | join resolution | every driver, constructor, circuit slug resolves; a missing driver fails and names the slug | Hirakawa |
| 10 | qualifying fields | car number and position agree with the source | the same run on race 1167 also found Verstappen's qualifying number 33 (data) vs 1 (Jolpica) |
| 11 | cross-source | driver list, classified count and winner agree between Jolpica and OpenF1 | |
| 12 | history drift | re-validate the last 4 races and report any difference as a revision (not a silent overwrite) | the 15 mismatches `--validate` currently reports in rounds 1, 4 and 9 |
| 13 | feature parity | the rebuilt master equals the committed master on all existing rows | Stage 0 rebuild |
| 14 | stale-data guard | `/meta`-style horizon >= latest completed race | already on `main` |

**Verified by test, not assumed.** I ran the existing comparison logic (`update_from_jolpica.validate_one`) against 2025 round 23, race 1167: it reports **21 mismatches (20 NULL grids against Jolpica's real values, plus Verstappen's qualifying number)**. So the existing code *would* have caught the defect, but only if 2025 were in range: the committed `--validate` scans **2026 only** (`ingested_2026_races()`), which is why it never did. The new check therefore (a) runs on every ingested race of every season, (b) has the explicit NULL and zero-share rules above rather than relying on a field-by-field diff alone, and (c) is part of the ingest, not a weekly afterthought.

### 4.2 Alerts, heartbeat, and the "data last updated" indicator

- **Any failure** opens one deduplicated GitHub issue and posts to Discord if configured; the next green run closes it (already how the snapshot job behaves).
- **Heartbeat:** the existing `pipeline-heartbeat` workflow plus an external dead-man's-switch ping, extended to cover every new job (ingest, re-validate, schedule-sync).
- **Indicator:** the page shows `pipeline_status.last_data_as_of` ("results through Mexico City GP, updated 2026-11-02 04:10 UTC") and turns amber after a threshold (for example 36 hours after a race with no new data). It reads one cached row, so it works even if the model server is asleep.

## 5. Every currently manual step, and how it is removed

| # | manual today (where) | how it is removed | stays human? |
|---|---|---|---|
| 1 | run `update_from_jolpica.py --season --round N` and commit the CSVs | ingest job: gate, fetch, stage, validate, promote to the database | no |
| 2 | add new drivers/constructors to CSVs and script aliases (Hirakawa row, `DRIVER_SLUG_ALIASES`) | job creates them from Jolpica's driver endpoint after a loud failure naming the slug; the first occurrence needs one confirmation | one-click approval for a new driver |
| 3 | edit `races.csv` when the calendar changes (Bahrain-in-Malaysia insertion, renumbering) | daily schedule-sync diffs the calendar; `round` is mutable, `race_id` stable | alert on a change inside 7 days |
| 4 | execute the notebook to rebuild `f1_master.csv` (also rewrites model pickles and chart PNGs) | deterministic build module with join-drop assertions and a master-parity test; notebook no longer in the loop | no |
| 5 | rebuild and commit `lookups.pkl` | built in the pipeline from the new master with the existing `compute_lookups` | no |
| 6 | merge to `main` to deploy new data | data no longer lives in git; the site reads the database; a deploy is needed only for code | no |
| 7 | edit `NEXT_RACE` (including five session times), `UPCOMING_RACES_2026`, `COMPLETED_2026`, `STANDINGS_GRID_2026` (roster), `CIRCUIT_COUNTRY`, `CALENDAR_FLAGS`, the nav label | frontend reads `races`/`sessions`/`entries` endpoints; flags from circuit country | no |
| 8 | hand-edit the Season page's top-10 standings array and "N races" counters | read `standings_driver` and derive counts | no |
| 9 | `CONSTRUCTOR_OVERRIDES`, `TEAM_COLORS` (driver to team, team colours) | team from `entries`; colours from a `constructors.colour` column loaded once per season | colour choice is a design decision, once |
| 10 | backend `COMPLETED_2026` backfill list in `snapshot_model_pick.py` (a policy list) | replaced by `snapshots` rows plus `genuine_foresight`; excluded races are those without a snapshot | the policy (never backfill) stays |
| 11 | run `fetch_openf1_strategy.py` (hardcoded `range(1169, 1179)`) and rebuild the frontend so strategy JSON is baked in | strategy fetched per session by the pipeline into a table or object store; the page loads it on demand | no |
| 12 | Model page numbers typed into JSX (AUC, recall, training rows) | generated from an evaluated artifact (the backtest) and stored with `model_version` | evaluation refresh is a pipeline job |
| 13 | Season page computes accuracy by calling `/predict` 19 times | reads the `scorecard` view (Part 1C) | no |
| 14 | spot-checking history for appeals and fixing by hand (the 15 open mismatches; the Miami/Monaco fixes) | re-validation job with versioned `results` and `result_revisions` | approval for old or points-changing revisions |
| 15 | noticing data defects (Qatar NULL grid) by luck | validation checks 3, 4, 5 on every ingested race | no |
| 16 | apply Supabase migrations by hand in the SQL editor (00007 applied; 00008 pending) | stays manual by choice, but migrations are listed in `pipeline_status` so an unapplied one raises a warning | **yes** (deliberate) |
| 17 | set GitHub Actions secrets, Discord/heartbeat URLs | stays manual; the access check already names exactly what is wrong | **yes** |
| 18 | check after a merge that Render/Vercel redeployed correctly | post-deploy smoke test (`/meta` model hash and data horizon; frontend route 200) in CI | no |
| 19 | model retraining and versioning (notebook, copying pickles) | **deliberately stays manual**: a script trains, writes a `models` row with `approved_at` NULL, and the pipeline refuses to publish predictions from an unapproved version | **yes** (the brief) |
| 20 | decide a snapshot is "missed" and annotate it | job already alarms; scorecard flag `genuine_foresight` replaces comments in code | the never-backfill rule stays |

## 6. Migration path and risks

Order: (1) write the schema and the deterministic build module alongside the current CSV flow, in shadow; (2) backfill the database from the CSVs and prove the master and lookups reproduce exactly; (3) run the new ingest in shadow for two race weekends and diff against the manual process; (4) switch the site to the endpoints; (5) retire the CSV-in-git path. Risks: the database becomes the single point of failure (mitigated by `pipeline_status` honesty and the fallback to last good data); row-level-security mistakes (review on a copy); Supabase free-tier pause (Part 1C); drift between `results` versions and already-frozen snapshots (the scorecard records the version used).

## 7. Not verified

The DDL has not been executed. Whether Jolpica delivers results within a predictable delay after a race is unmeasured (the polling window of 6 hours is a design choice, not an observed latency). OpenF1's entry-list reliability beyond one weekend, and `starting_grid` returning no rows for the race session key, are unexplained. Costs and plan limits are in `03-backend-options.md`.
