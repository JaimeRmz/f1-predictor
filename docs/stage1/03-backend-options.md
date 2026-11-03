# Stage 1, Part 1C (a): backend options

Branch `docs/stage1-audit`. Read-only: no app code, data or model artifact changed; no Supabase credential used; no request to f1predictor.app or the Render API (the Render facts below come from Render's public docs). All timings were measured against my own **local** copy of the backend.

## 1. Recommendation in one paragraph

The backend is not slow or expensive to run; it is **cold and chatty**. A prediction call costs about 25 ms of CPU and the whole process fits in 173 MB, but the free Render tier sleeps after 15 minutes and takes about a minute to wake, and the Season page makes 19 requests that all wait on that wake-up. The cheapest change with the largest effect is **option B**: compute predictions in the data pipeline after each update, store them with `model_version` and `as_of`, and let the site read small precomputed rows; keep a thin live endpoint for `/whatif` only. That makes the common pages independent of the sleeping server, removes the 19-call pattern (to about 1 call, 0.6-4 kB), and costs $0-32 a month. A full rewrite (C) is only justified if you also want to drop Python from the serving path, and it carries the highest migration risk. Option A alone fixes the data layer but leaves the cold start and the call pattern unless you also pay for an always-on instance.

## 2. Facts about the current backend

**Measured locally** (my machine, `127.0.0.1`; not Render's hardware):

| item | value |
|---|---|
| process startup to ready | 4.7 s (0.9 s pandas/joblib, 3.6 s loading models and importing xgboost, 0.1 s data) |
| resident memory | 173 MB |
| `/predict/{raceId}` | 25 ms median, 8.6 kB response; 19 sequential calls = 476 ms, 163.7 kB total |
| `/whatif` with `auto_quali`, 22 drivers | 348 ms, 3.6 kB (one model call per driver) |
| `/championship/status`, `/drivers`, `/races`, `/meta` | 7-10 ms, 0.2-18.9 kB |
| artifacts | three models about 0.3 MB each, `lookups.pkl` 64 kB, `f1_master.csv` 2.4 MB |

(An early run showed every call at about 2.05 s. That was the Windows `localhost` IPv6-then-IPv4 fallback delay, not the server; it disappeared with `127.0.0.1`. I mention it so nobody re-measures it wrongly.)

**What this means:** compute is negligible. A 512 MB instance is ample. The costs that matter are wake-up time, request count and the fact that the data lives in CSV files in git (every ingest is a commit plus a redeploy, which is why results ingest is manual).

**Hosting limits (verified against the vendors' public pages on 2026-11-02/03):**

| platform | limit that matters here |
|---|---|
| Render free web service | spins down after **15 minutes** without inbound traffic; spin-up "takes about one minute"; **750 free instance hours** per workspace per month; "Do not use them for production applications"; may be restarted at any time; local disk is lost on restart; **no cron jobs or background workers on the free plan**; and "service-initiated traffic can trigger suspension, e.g. accessing external databases or invoking external APIs" (so a free Render service that polls a live feed is not an option) |
| Render paid | compute: free $0 / 512 MB; **$7** (<1 CPU, 512 MB); **$25** (1 CPU, 2 GB); $85 (2 CPU, 4 GB). Workspace plans: Hobby $0 + compute (5 GB bandwidth), Pro $25 + compute (25 GB), overage $0.15/GB. Cron jobs billed per minute ($0.00016/min for the small size) |
| Supabase free | 500 MB database, 5 GB egress, unlimited API requests, **projects pause after 1 week of inactivity**, no backups |
| Supabase Pro | from **$25/month**, 8 GB disk, 250 GB egress, daily backups (7 days), no inactivity pause |
| GitHub scheduled workflows | shortest interval **5 minutes**; run **only from the default branch**; can be **delayed or dropped under load**; in a public repo they are **disabled after 60 days without repository activity**; `workflow_dispatch` workflow file must be on the default branch |
| Vercel | not verified in this session (the Hobby plan's terms on commercial use should be checked before relying on it) |

## 3. The three options

### Option A: keep FastAPI, restructure the data layer

**What changes.** Move the source of truth from CSV-in-git to a database (Supabase or Render Postgres); the ingest job upserts rows; FastAPI reads the DB instead of `f1_master.csv`; `lookups` are built at startup or refreshed after each ingest. Models and the prediction code do not change. Add one aggregated endpoint (for example `/season/2026/scorecard`) so the Season page stops looping.

| | free Render | paid Render |
|---|---|---|
| monthly cost | **$0** (+ DB: Supabase free $0, or $25 Pro) | **$7** compute (+ DB as left) |
| cold start | about 1 minute after 15 idle minutes; every request in that window waits | none (always on) |
| Season page, 19 calls | 19 requests / 164 kB, all stuck behind the wake-up; 0.5 s of CPU once awake. With the new endpoint: 1 request | same, with no wake-up; 1 request with the new endpoint |
| main risks | still depends on a free tier that Render says is not for production | small |

Migration risk: **low to moderate**. The predictions are produced by the same artifacts and code; the risk is in the new data layer (types, ordering, NULLs; the Qatar NULL-grid defect is exactly the kind of thing a new loader must not hide).

### Option B: batch-precompute into Supabase, tiny live endpoint for `/whatif`

**What changes.** After each ingest, a pipeline job (GitHub Actions, public repo, no cost) runs the model and writes `predictions` rows stamped with `model_version` and `as_of` (Part 1D's schema), plus a `scorecard` view. The site reads Supabase's REST API with the read-only anon key (the key is already public by design). Only `/whatif` still needs a model server; it can stay on free Render (the What-If page alone pays the cold start) or move to a $7 instance.

| | monthly cost |
|---|---|
| Supabase | **$0** free (pause risk below) or **$25** Pro |
| `/whatif` server | **$0** free Render, or **$7** |
| pipeline | $0 (GitHub Actions on a public repo) |
| **total** | **$0 to $32** |

- **Cold start:** the Home, Next Race, Championship, Season and Model pages no longer touch Render at all. Only What-If does. Supabase REST answers in a normal request time; there is no 1-minute wake.
- **Season page, 19 calls:** replaced by **1 request**. Sizes measured from the real backtest rows: a scorecard (model top 3 plus actual top 3, 19 races) is **2.7 kB raw / 0.6 kB gzip**; if you store every driver's scores for the 19 races it is **23.9 kB raw / 3.7 kB gzip**, versus 163.7 kB today. At 5 GB free egress that is hundreds of thousands of visits a month.
- **Limits that bite:** (1) a free Supabase project pauses after a week without activity. The snapshot workflow reads the database every 30 minutes, which very likely counts as activity, but I could not verify what Supabase counts, so treat the pause as a real risk until tested (a paused project would break every page, not just one). Pro removes it. (2) The pipeline runs in GitHub Actions: 5-minute minimum interval, delays and dropped runs under load, and 60-day auto-disable on an inactive public repo; the heartbeat added in Stage 0 already covers a stopped schedule. (3) Do not run a poller on a free Render service (suspension clause above).
- **Migration risk:** **moderate**. The model code is unchanged; new surface area is the pipeline-to-DB write, row-level security on the new tables, and keeping the live `/whatif` consistent with the precomputed numbers (same `model_version`).

### Option C: full rewrite

Two realistic shapes: (1) **static + edge**: the pipeline writes JSON to a CDN or storage and the site reads it; `/whatif` runs in an edge function by evaluating the exported XGBoost trees in TypeScript (the three model pickles are about 300 kB each; a JSON export would be of a similar order, which I did not measure); or (2) a new always-on service in another framework. Shape (1) removes Python from serving entirely.

| | monthly cost |
|---|---|
| hosting | **$0-20** (static hosting free tiers; Vercel pricing not verified here) |
| pipeline | $0 (GitHub Actions) |
| cold start | none for static pages; edge functions start in milliseconds |
| Season page, 19 calls | **1 static file**, 0.6-3.7 kB, cached at the CDN; zero compute |

- **Migration risk: highest.** A TypeScript tree evaluator must reproduce XGBoost's output; floats differ slightly and a feature-ordering or missing-value bug silently shifts every probability. Two languages in the repo during the transition. Most benefit is the same as B; the extra benefit is no Render at all.
- Only worth doing if the redesign also wants a unified TypeScript codebase. It is not needed to fix cold starts or the 19-call pattern.

## 4. Side-by-side

| | now | A (free) | A (paid) | B | C |
|---|---|---|---|---|---|
| monthly cost | $0 | $0 | $7 | $0-32 | $0-20 |
| first-visit wait after idle | ~1 min | ~1 min | none | none on 5 of 6 page types; ~1 min on What-If (free Render) | none |
| Season page requests | 19 (164 kB) | 19, or 1 with new endpoint | 19, or 1 | **1 (0.6-3.7 kB)** | **1 static (0.6-3.7 kB)** |
| ingest without a commit and redeploy | no | yes | yes | yes | yes |
| model code changes | n/a | none | none | none | **port to TypeScript** |
| migration risk | n/a | low-moderate | low-moderate | moderate | high |
| depends on a free tier "not for production" | yes | yes | no | partly (What-If only) | no |

## 5. Parity-test plan (applies to any option)

**Goal:** a new serving path reproduces today's predictions exactly, and the model artifacts stay byte-identical unless you approve a retrain.

1. **Artifacts:** the deployed `/meta` model hash (`m-a6621e96c549` today) must equal the hash of the committed `.pkl` files; the migration must not change it.
2. **Golden dataset:** `analysis/out/backtest_rows.csv` holds 1,789 rows produced by the repo's own `predict_race` and `whatif_predict` (real-grid and predicted-quali conditions) for 43 races, with point-in-time lookups. The new path must reproduce: win and podium scores within **1e-9 for A and B** (same code, same artifacts; `/whatif` is rounded to 4 decimals so compare after rounding), and within **1e-4 with identical driver order in every race for C** (float differences in a TypeScript port).
3. **Real-grid and predicted-grid paths separately**, because they use different feature routes (master row versus latest-row plus lookups).
4. **Contract tests:** every endpoint the frontend uses returns the same fields and types (`/predict`, `/whatif`, `/races`, `/drivers`, `/championship/status`, `/meta`).
5. **Shadow mode for two race weekends:** run old and new side by side, diff every response automatically, alert on any difference, and only then switch the frontend.
6. **Rollback:** the frontend reads the base URL from one constant, so reverting is one deploy.

## 6. What I would do first (and what I could not verify)

Order: add the aggregated scorecard endpoint and the `as_of` field first (smallest change, immediate relief); build the pipeline-to-Supabase write for predictions next (option B); decide about the paid instance for `/whatif` only if the What-If wake-up proves annoying. Defer C unless the redesign needs it.

**Not verified:** Vercel pricing and Hobby-plan terms; Supabase's definition of "inactivity"; Render's actual wake time for this specific service (the 1-minute figure is Render's own statement; the "~50 s" figure is from the brief); behaviour under real traffic; any figure on Render hardware (all timings are local).
