# Stage 1, Part 1C (b): data sources, the grid-signal experiment, and live data

Branch `docs/stage1-audit`. Read-only. Public web and API reads only; no credential of any kind was used (no Supabase key, no F1TV account, no OpenF1 sponsor token). All OpenF1 responses were cached on disk and requested at least 2.4 s apart (222 requests, exactly the number the plan required, so no retries or rate-limit errors occurred). This is not legal advice; where licensing is unclear I say so.

## 1. Sources: what I verified and what I could not

Checked 2026-11-02/03. Every claim below carries one of these labels: **PRIMARY** (quoted from the provider's own page that I could load), **CONFLICTING** (two primary statements, or primary vs what you reported, disagree), **REPORTED** (you told me; I could not load a page that says it), **NOT VERIFIED** (no primary source reached). A figure with no label is a measurement I made.

| source | role | coverage | freshness / latency | rate limits | license / terms | cost |
|---|---|---|---|---|---|---|
| **Jolpica-F1** (`api.jolpi.ca`) | the record: schedule with session times, results, standings, drivers, constructors | Ergast-compatible; I have used 2010-2026 | I did **not** measure delay after a session; I confirmed Mexico City (race Nov 1) results and standings were present on Nov 2 | **4 requests/s burst, 500 requests/hour sustained**, unauthenticated; callers behind the same IP/token share it; "limits will decrease in the future"; token access with higher limits is planned; project asks you to cache and to use filters/offsets | Apache-2.0 (code); API Terms of Use apply (I did not read the contents of `TERMS.md`) | free; volunteer-run, about $45/month hosting, funded by donations, aiming to "break even during the 2026 season"; no uptime promise |
| **OpenF1** (`api.openf1.org`) | practice/qualifying laps, stints, session results, live data | **2023 onwards**, 18 endpoints (PRIMARY, docs). My pull: all 43 target race weekends present; all 12 sprint weekends had Sprint Qualifying results (measured) | sessions/meetings update daily at midnight UTC (PRIMARY); `session_result` "a few minutes after the official results are published" (PRIMARY); live "about 3 seconds after live events" (PRIMARY homepage; **not tested**, needs a paid token) | **CONFLICTING**: two fetches of the same homepage returned different figures (free 3 req/s and 30 req/min with Sponsor 6/60, versus free 6 req/s and 60 req/min with supporters at double). I stayed at about 25 requests/minute, under every figure | content **CC BY-NC-SA 4.0**, "non-commercial analysis and fan engagement", unaffiliated with Formula 1 companies, data "aggregated from public sources" (PRIMARY, homepage footer) | historical: **free, no auth** (PRIMARY). Live: "Real-time data requires a paid subscription" (PRIMARY). **Price: CONFLICTING**, see section 4.0 |
| **FastF1** (Python library) | laps, telemetry, weather | not stated on its docs page | not described | not described | page says it is unofficial and unaffiliated; library license not stated there (PRIMARY, FastF1 docs) | free library, but its docs say it "now requires an F1TV Access subscription (or higher plan) for most of its features" (PRIMARY, FastF1 docs). That it reads F1's own timing feed is **my inference**; the page does not say so |
| **Sportmonks** Formula 1 API | commercial REST feed | practice, qualifying, race; sprint sessions not mentioned; historical depth not stated (PRIMARY product page) | "updates in real time", REST polling, no push; refresh rate and latency **not stated** (PRIMARY) | 3,000 calls/hour per endpoint (PRIMARY) | **NOT VERIFIED**: the page links to Terms of Service that I did not read; no commercial-use, redistribution or display terms appear on the page | **CONFLICTING within the primary page**: "EUR 69 per month, paid yearly (EUR 830 for twelve months)" in the pricing section, "79 euro per month" in the FAQ |
| **API-Sports** Formula-1 | commercial REST feed | **not verified**: the documentation returned HTTP 403 | not verified | not verified | not verified | not verified |
| **Official F1 live timing** (F1TV/app feed) | the origin of most live data | n/a | n/a | n/a | **NOT VERIFIED.** F1TV's English terms could not be retrieved (the F1TV page returned only a heading). The one primary-domain text I found is an **Italian translation** of formula1.com's digital-product terms, summarised by a search tool as: personal, non-commercial use only; no charging for access. I found no clause on automated access or scraping. **Out of bounds regardless: do not scrape it** (the brief) | no public commercial price or API found (NOT VERIFIED) |

Other providers surfaced by search (RapidAPI "F1 Live Motorsport Data", Apify scrapers, assorted GitHub tools) were low-quality or scrapers of the same sources and are not evaluated.

**What this means:** only **Jolpica** (record) and **OpenF1** (historical signals) are free and clearly usable today. Anything *live* costs money; the price is unconfirmed for OpenF1 and the upstream rights are each provider's claim, which is the main legal uncertainty (section 4).

**FastF1 was not run.** Its own docs say it needs an F1TV subscription for most features, and I do not have or want to use such an account here. The experiment below uses OpenF1 historical data, which carries the lap and session-result information needed for 2023 onwards.

## 2. Experiment: do pre-qualifying signals improve the predicted grid?

The question recorded in `docs/stage1/00-scope.md`. Script: `analysis/11_grid_signal_experiment.py`; data collection: `analysis/10_openf1_collect.py` (cached, rate-limited); raw output: `analysis/out/grid_signal_experiment.json`.

**Setup.**
- **Baseline:** the production predicted grid (condition (b) of the Part 1B backtest).
- **Target:** the real **qualifying order** (also reported against the real race grid, which Part 1B used; the two agree on every conclusion).
- **Races:** the 43 backtest races, 2025 and 2026 round 1-19: 31 normal weekends (with FP1-3) and 12 sprint weekends. 892 driver-races. Every signal below is known before the qualifying session it predicts.
- **Metrics:** per-race Spearman between predicted and actual order, pole-sitter hit rate, mean absolute rank error. Means over races; **bootstrap-by-race 95% intervals** (5,000 resamples); differences against the baseline are **paired** (same races, same resamples).
- **Pre-specified signals** (named in the request): practice pace (best lap, and FP2/FP3 long-run pace), Sprint Qualifying result, previous race's grid. Blends are equal-weight rank averages with the baseline (no fitting); one fitted model (expanding-window ridge, 12-race burn-in) is also reported.

### 2.1 Results, all 43 races (target: real qualifying order)

| method | races | Spearman | pole-sitter hit | MAE (positions) |
|---|---|---|---|---|
| **baseline: production predicted grid** | 43 | 0.766 [0.723, 0.806] | 16.3% (7/43) [7, 28] | 2.98 |
| previous race grid | 43 | 0.664 [0.614, 0.711] (**-0.102** [-0.139, -0.068]) | 25.6% (11/43) [14, 40] (+9.3pp [-7.0, +25.6]) | 3.60 (+0.62 [+0.38, +0.88]) |
| previous race qualifying | 43 | 0.684 [0.632, 0.733] (-0.081 [-0.111, -0.054]) | 25.6% (11/43) | 3.48 |
| blend: baseline + previous grid | 43 | 0.755 (-0.011 [-0.028, +0.008]) | 23.3% (+7.0pp [-2.3, +16.3]) | 3.06 |
| **blend: baseline + best available signal** (post hoc, see below) | 43 | **0.805** [0.769, 0.838] (**+0.039** [+0.019, +0.060]) | **32.6% (14/43)** [19, 47] (**+16.3pp** [+4.7, +30.2]) | **2.70** (**-0.28** [-0.43, -0.13]) |

Against the real race grid instead: baseline 0.737, pole 7/43; best-signal blend 0.773 (+0.036 [+0.017, +0.057]), pole 14/43 (+16.3pp [+4.7, +30.2]).

### 2.2 By weekend type (target: qualifying order)

**Normal weekends, 31 races, 640 driver-races (unfitted methods):**

| method | Spearman | pole hit | MAE |
|---|---|---|---|
| baseline | 0.775 [0.724, 0.823] | 19.4% (6/31) [6, 32] | 2.90 |
| previous race grid | 0.641 (-0.134 [-0.174, -0.099]) | 19.4% (+0.0pp [-19, +16]) | 3.72 |
| **practice best lap alone** | 0.769 [0.712, 0.821] (-0.006 [-0.050, +0.038]) | **32.3% (10/31)** [16, 48] (+12.9pp [0.0, +29.0]) | 2.95 |
| practice long-run pace alone | **0.314** [0.224, 0.407] (-0.461) | 12.9% (-6.5pp) | 5.42 |
| practice pace (best + long run) | 0.670 (-0.105 [-0.155, -0.052]) | 22.6% | 3.70 |
| **blend: baseline + practice best lap** | **0.804** [0.758, 0.846] (**+0.029** [+0.007, +0.051]) | 32.3% (+12.9pp [0.0, +29.0]) | 2.69 (-0.21 [-0.40, -0.04]) |
| blend: baseline + practice pace | 0.774 (-0.001) | 22.6% | 2.99 |
| blend: baseline + previous grid | 0.748 (-0.027 [-0.042, -0.012]) | 29.0% | 3.10 |

Fitted expanding-window ridge (19 post-burn-in races, 404 driver-races): Spearman 0.819 vs baseline 0.797 on the same races (+0.022 [+0.004, +0.042]), pole 31.6% vs 15.8% (+15.8pp [0.0, +31.6]). It is **no better than the simple blend** (+0.023), so fitting buys nothing at this sample size.

**Sprint weekends, 12 races, 252 driver-races:**

| method | Spearman | pole hit | MAE |
|---|---|---|---|
| baseline | 0.742 [0.667, 0.820] | 8.3% (1/12) [0, 25] | 3.16 |
| previous race grid | 0.725 (-0.017 [-0.068, +0.039]) | 41.7% (5/12) [17, 67] | 3.29 |
| FP1 best lap (the only practice before SQ) | 0.677 (-0.064 [-0.171, +0.041]) | 16.7% | 3.43 |
| **Sprint Qualifying result** | **0.805** [0.740, 0.871] (**+0.063** [+0.009, +0.138]) | 41.7% (5/12) [17, 67] (+33.3pp [0.0, +66.7]) | 2.62 (-0.54 [-1.25, -0.06]) |
| **blend: baseline + Sprint Qualifying** | **0.807** [0.760, 0.858] (**+0.066** [+0.027, +0.112]) | 33.3% (4/12) [8, 58] (+25pp [0.0, +50.0]) | 2.72 (-0.44 [-0.74, -0.23]) |

### 2.3 Reading it honestly

- **Previous race's grid does not help.** It is clearly *worse* than the production grid on rank correlation (about -0.10, interval excludes 0), and blending it in does not improve the baseline. Its higher pole-hit rate (25.6% vs 16.3%) is **not** distinguishable from the baseline (interval -7 to +26 points).
- **The production grid is not better than the best practice lap alone.** On normal weekends the practice best-lap order (Spearman 0.769) ties the whole XGBoost qualifying model (0.775); the model has no practice information.
- **Practice best lap and Sprint Qualifying each add a small, real improvement on rank correlation** when blended with the production grid (+0.029 and +0.066, intervals exclude 0) and reduce position error (-0.21 and -0.44). Their **pole-hit gains are large in point estimate but borderline**: the intervals start at or near 0 (n = 31 and 12 races), so I would not claim a pole-hit improvement from either one alone.
- **My long-run measure fails** (Spearman 0.31): it uses each driver's best stint median with no fuel or tyre-compound correction, and teams run different programmes. That shows *this crude measure* is useless, **not** that long-run pace is. A proper version needs fuel/compound modelling and is not attempted here.
- **The 43-race "best available signal" blend is post hoc.** I defined it after seeing the per-signal results above (it combines the two signals that helped, one rule for every weekend), and I ran about ten methods against two targets, so treat its p-values as optimistic. The **pre-specified, individually tested findings** are the ones in 2.2. They point the same way, and section 2.5 re-tests the blend with weights fitted on one season and scored on the other.
- **Sample sizes are small** (43, 31 and 12 races), and the 12 sprint weekends are 6 in each of two seasons with different regulations in 2026.

### 2.4 A policy consequence the scorecard must respect (corrected wording)

The Stage 0 snapshot job freezes the model's forecast before the **first graded session**: Qualifying on a normal weekend, **Sprint Qualifying** on a sprint weekend. It starts trying 48 hours before that cutoff (the *window*) and, because the model's inputs do not change in between, writes at the first scheduled tick after the window opens.

- **Normal weekend: practice arrives between the window opening and the cutoff.** FP1 to FP3 all finish before Qualifying, so the practice best-lap signal exists *inside* the window, before the cutoff. Today's job writes at the first tick after the window opens, i.e. **before practice has happened**, so it ignores a signal that will exist before the cutoff. Using it needs a *later freeze inside the same window* (after FP3, before Qualifying); the cutoff itself would not change.
- **Sprint weekend: Sprint Qualifying arrives after the cutoff.** Stage 0 defines the cutoff as the start of Sprint Qualifying, so its result necessarily arrives **after** it. A forecast that uses it is by construction a *later* forecast and needs a **second cutoff** at the start of Saturday's Qualifying.

So there are two different forecasts: a *pre-weekend* one (what is frozen now) and a *pre-qualifying* one (after practice, or after Sprint Qualifying). If the pre-qualifying forecast is added, the scorecard must label which is which, and the snapshot rules need the later freeze and, on sprint weekends, the second cutoff. That is a product decision for you; I have not changed any code or workflow.

### 2.5 Held-out re-test of the blend (weights fitted on one season, scored on the other)

The 43-race blend in 2.1 used equal weights and was defined after seeing results. To test it properly, the blend weight is **fitted on one season and evaluated on the other**, in both directions (`analysis/14_grid_blend_holdout.py`, output `analysis/out/grid_blend_holdout.json`). The blend is `(1 - w) * rank(production predicted grid) + w * rank(signal)`, re-ranked, where the signal is the practice best lap (normal weekends) or the Sprint Qualifying position (sprint weekends); one `w` per weekend type, chosen on the training season by maximising mean per-race Spearman (grid of 0, 0.05, ..., 1). The test season is never used to choose `w`. Intervals are bootstrap-by-race; differences are paired.

**fit 2025 -> test 2026**: 19 test races (13 normal, 6 sprint; 416 driver-races). Weights fitted on the training season only: normal weekends w = 0.45 (from 18 races), sprint weekends w = 0.65 (from 6 races).

| method (test season) | Spearman | pole-sitter hit | paired Spearman vs baseline | paired pole vs baseline |
|---|---|---|---|---|
| baseline (production predicted grid) | 0.846 [0.783, 0.896] | 3/19 = 15.8% [0, 32] | reference | reference |
| equal weights (w = 0.5), nothing fitted | 0.879 [0.842, 0.912] | 6/19 = 31.6% [11, 53] | +0.033 [+0.007, +0.068] | +15.8pp [+0.0, +31.6] |
| weights fitted on 2025 | 0.888 [0.850, 0.922] | 7/19 = 36.8% [16, 58] | +0.043 [+0.011, +0.089] | +21.1pp [+5.3, +42.1] |

normal weekends (13 races): baseline 0.856, pole 2/13; fitted blend 0.880 (+0.024 [+0.002, +0.053]), pole 4/13.
sprint weekends (6 races): baseline 0.823, pole 1/6; fitted blend 0.906 (+0.084 [+0.016, +0.202]), pole 3/6.

**fit 2026 -> test 2025**: 24 test races (18 normal, 6 sprint; 476 driver-races). Weights fitted on the training season only: normal weekends w = 0.7 (from 13 races), sprint weekends w = 0.7 (from 6 races).

| method (test season) | Spearman | pole-sitter hit | paired Spearman vs baseline | paired pole vs baseline |
|---|---|---|---|---|
| baseline (production predicted grid) | 0.703 [0.656, 0.748] | 4/24 = 16.7% [4, 33] | reference | reference |
| equal weights (w = 0.5), nothing fitted | 0.746 [0.701, 0.785] | 8/24 = 33.3% [17, 54] | +0.044 [+0.015, +0.070] | +16.7pp [+0.0, +37.5] |
| weights fitted on 2026 | 0.729 [0.680, 0.772] | 9/24 = 37.5% [21, 58] | +0.026 [-0.012, +0.062] | +20.8pp [+0.0, +41.7] |

normal weekends (18 races): baseline 0.717, pole 4/18; fitted blend 0.729 (+0.012 [-0.032, +0.055]), pole 6/18.
sprint weekends (6 races): baseline 0.661, pole 0/6; fitted blend 0.729 (+0.069 [+0.012, +0.123]), pole 3/6.

**What it shows.**
- **The direction holds out of sample in both directions.** Every blend variant beats the baseline on Spearman in both test seasons, and the pole-hit point estimates are higher in both (7/19 vs 3/19, and 9/24 vs 4/24 with fitted weights).
- **It is weaker and noisier than the in-sample number suggested, and fitting the weight did not help.** Fitted on 2025 and tested on 2026, the Spearman gain is +0.043 (interval excludes 0); fitted on 2026 and tested on 2025 it is only +0.026 and **its interval includes 0**. Equal weights (nothing fitted) did as well or better in the second direction (+0.044, interval excludes 0). With 13-18 training races for the normal-weekend weight and only 6 for the sprint weight, fitting adds noise; a fixed equal blend is the safer choice at this sample size.
- **The pole-hit improvement is not established.** Point estimates roughly double, but the lower interval bounds sit at or near 0 in most rows, with 6-19 races per cell; the 2026 baseline grid is also already much better than 2025's (Spearman 0.846 vs 0.703), so the room for improvement differs by season.
- **Sample sizes remain small** (19 and 24 test races; 6 sprint races per season) and the two seasons span a regulation change. Treat this as consistent, modest evidence, not proof.

## 3. Live data, goal (1): the site updates itself after each session (full design)

**Principle:** schedule-driven and idempotent. Nothing waits for a human; every step is safe to repeat; validation fails loudly; every published row carries `as_of` and `model_version`.

**Inputs.** Session start times from **Jolpica** (its schedule carries `FirstPractice`, `SecondPractice`, `ThirdPractice`, `Qualifying`, `Sprint`, `SprintQualifying`, race; verified for 2026 in Stage 0); session **end** times from **OpenF1** `sessions.date_end` (updated daily at midnight UTC); results and standings from **Jolpica**; practice/SQ signals and a second opinion on the starting grid from **OpenF1**.

**Trigger.** A GitHub Actions schedule (public repo: free; minimum interval 5 minutes; best-effort, may be delayed or dropped; default branch only; 60-day auto-disable on inactivity, covered by the Stage 0 heartbeat). Run every 15 minutes, with a **gate step** that reads the schedule and exits in seconds unless a session ended within the last 6 hours and its data is not yet published. Idle ticks cost nothing and wake nothing.

| weekend moment | what the pipeline does |
|---|---|
| schedule change | daily: refresh the calendar and session times; diff against the stored schedule; alert on a change inside 7 days (postponement, time move) |
| session ends (FP1/FP2/FP3) | T+10 min onward: fetch OpenF1 laps/stints for that session, store the practice signal with `as_of`; if a pre-qualifying forecast is enabled (section 2.4) recompute it after FP3 |
| Sprint Qualifying / Sprint ends | poll OpenF1 `session_result`, then Jolpica; store; recompute the pre-qualifying forecast after SQ |
| Qualifying ends | poll Jolpica qualifying and OpenF1 `starting_grid`; validate the grid (non-null, one per entrant, agrees between sources apart from penalties); store |
| race ends | poll Jolpica results every 10 minutes for up to 6 hours until the row count equals the entrant count and is unchanged for two polls; then run all checks (below), cascade standings, derive championship status, **batch-precompute next race predictions**, publish |
| after the race | **re-validate the last 4 races** daily for 3 days and then weekly (appeals reclassify results; Monaco was reclassified twice) |

**Checks that must fail the run** (the brief's "fail loudly"): row count equals entrants; schema and types; no NULL grid or position where one is required (the Qatar defect); positions contiguous; points total matches the scoring table incl. sprint; standings equal the previous standings plus the weekend's points; join-drop check (every driver, constructor and circuit resolves; a missing driver such as a substitute fails and names the slug). A failure opens one deduplicated issue and posts to Discord; the previous good data stays published and the site's "data last updated" indicator keeps showing its true time.

**Rate-limit budget.** Jolpica allows 500 requests/hour and 4/s. A race-day ingest needs about 15-30 calls and re-validation about 4 x 4 calls, far below the cap. **Catch:** Jolpica says callers behind one IP share the limit, and GitHub-hosted runners egress from shared address ranges, so other users' traffic can eat into it. Mitigation: backoff with jitter on HTTP 429, cache every response, and ask Jolpica for a token (planned) or for a higher limit (their stated process). OpenF1's free-tier limit is ample at this volume under every figure I saw (30 or 60 requests/minute; the figures conflict, see section 1); the Part 1C pull used about 25/minute.

**What the pipeline publishes** (one write per run, all stamped): results, standings, schedule, roster, next-race predictions with `model_version` and `as_of`, snapshots (unchanged, frozen), and a `pipeline_status` row (last success, last failure, last data time) that drives the site's "data last updated" badge. Part 1D gives the schema.

**What it does not do:** retraining stays a separate, deliberate, versioned step (the brief); a new `model_version` only appears when you approve it.

## 4. Live data, goal (2): true live positions during a session

### 4.0 What OpenF1's own pages say today, and what I could and could not verify (checked 2026-11-03)

I read OpenF1's homepage, its docs page, its streaming tutorial (`/auth.html`), its contact page, its GitHub README, and the Tally access form it links to. The form is the page you described; **as it loads for me it reads "This form is no longer active"** and contains only: "Instant access: Become a supporter for immediate access to real-time streams" and "Custom projects: Need high volume, dedicated instances, or integration support?". The text you quote from it (usage-based pricing; live `/location`, `/car_data` and `/intervals` unavailable) is **not on the page I can load**. A web-search summary attributed that wording to the form, so I treat it as **REPORTED**, not independently verified.

| claim | what the primary source says | status |
|---|---|---|
| live data is paid | docs: "Real-time data requires a paid subscription." | PRIMARY |
| price | homepage text (via my fetch): "EUR 9.90 / month" for the Sponsor tier and "Free / forever" for Community. The access form (as you report it) says pricing is **usage-based**. The Stripe checkout page loads only as a title, so I cannot see the amount or whether it is fixed. A third party may have repeated the 9.90 figure, but my fetch found it on openf1.org itself. | **CONFLICTING. Do not budget on EUR 9.90.** Obtain a written quote |
| rate limits | two fetches of the homepage returned different numbers (see section 1) | CONFLICTING |
| live window | homepage: "Data is considered live from 30 minutes before a session starts until 30 minutes after it ends. Outside of this window, data is classified as historical and is free to access." | PRIMARY |
| latency | homepage: "Real-time data typically updates about 3 seconds after live events"; "Real-time position changes, intervals, and gaps to leader updated every 4 seconds." | PRIMARY; **not tested**; also lists intervals as live, which your form note contradicts |
| streaming access | `/auth.html`: MQTT `mqtt.openf1.org:8883` (TLS), WebSocket `wss://mqtt.openf1.org:8084/mqtt`, OAuth2 access token used as the password, tokens expire after 1 hour, topics match REST paths (examples `v1/sessions`, `v1/laps`, `v1/location`) | PRIMARY as documented; not tested (needs a paid account) |
| which live endpoints are unavailable | no page I can load marks any live endpoint unavailable; the docs say intervals are real-time "during races only". You report the form says live `/location`, `/car_data`, `/intervals` are unavailable while the data is still ingested shortly after each session | **REPORTED** |
| licence | footer: "Licensed under CC BY-NC-SA 4.0" and "intended solely for non-commercial analysis and fan engagement" | PRIMARY |

**One thing I can test, and did** (`analysis/13_openf1_endpoint_check.py`, free API, cached): whether those endpoints **hold data for the most recent completed race** (Mexico City, ended 31.8 hours before the check). Result: *all three reported-unavailable feeds are present historically*: `intervals` 1547 rows, `location` 114 rows in a 30-second slice (about 3.8 Hz), `car_data` 117 rows in the same slice. This is consistent with your report ("still ingested after the session") and says nothing about whether they stream live. I **cannot** test live streaming: it needs a paid token and no session is running.

### 4.0a Feeds the live view would depend on

| feed | needed for | status for a live dependency | historical rows, last race | decision |
|---|---|---|---|---|
| `position` | timing tower order | not listed as unavailable anywhere I can read; **live not testable** | 13 (position changes for one driver) | **depend, but confirm live availability in writing first** |
| `laps` | last/best lap, sector times | same | 70 (one driver) | depend, confirm |
| `pit`, `stints` | pit status, tyre stint | same | 67, 80 | depend, confirm |
| `race_control` | flags, safety car, penalties | same | 169 | depend, confirm |
| `weather` | track/air temperature, rain | same (updated every minute) | 205 | depend, confirm |
| `intervals` | live gaps | **REPORTED unavailable live**; docs/homepage say available | 1547 | **do not depend.** Derive gaps from `laps` + `position` at lap granularity and say so on screen |
| `location` | live track map | **REPORTED unavailable live** | present historically | **do not depend**; track map only in the post-session replay |
| `car_data` | live speed/throttle/brake | **REPORTED unavailable live** | present historically | **do not depend**; telemetry traces only in the replay |
| `session_result`, `starting_grid` | FINAL tier | n/a (post-session) | 22 results; `starting_grid` returned **0 rows for the race session key** (not understood; do not depend on it) | `session_result` yes, after the session; `starting_grid`: investigate |

So the live product that can honestly be promised is a **timing tower** (positions, lap times, pit and tyre status) plus **race-control messages and weather**, and *only after OpenF1 confirms in writing that those feeds stream live*. Live gaps, a live track map and live telemetry should be treated as **unavailable**.

**Roster evidence (relevant to Part 1D).** OpenF1 already lists the Brazil weekend's drivers 81.7 hours before FP1: 22 drivers, with **Ocon (not Hirakawa) in the Haas seat**, while its Mexico race list correctly had Hirakawa. That supports my Ocon assumption and shows an entry list can be read from OpenF1 days before the weekend. Caveat: it may be a pre-populated list rather than a confirmed entry list.

### 4.0b Which sources, at what price and latency, with the verification status of each claim

| option | real-time? | latency | cost | rights position | status |
|---|---|---|---|---|---|
| **OpenF1 paid access** | yes: REST, MQTT, WebSocket (as documented) | "about 3 seconds" (their statement, untested) | **unconfirmed**: EUR 9.90/month on the homepage vs usage-based per the form | CC BY-NC-SA, non-commercial; upstream data "aggregated from public sources", project disclaims affiliation | price CONFLICTING; latency PRIMARY but untested; live feed availability REPORTED partial |
| **Sportmonks** | yes, **REST polling only** | not stated | EUR 69 (pricing section) or 79 (FAQ) per month | **NOT VERIFIED**: terms not read; sprint sessions not mentioned | price CONFLICTING on its own page; licence NOT VERIFIED |
| FastF1 live timing | yes | n/a | needs an F1TV subscription (FastF1 docs, PRIMARY) | **NOT VERIFIED.** That a consumer subscription does not permit republishing, and that FastF1 reads F1's own feed, are **my inferences**, not verified from F1TV's terms (English terms not retrievable; only an Italian translation of formula1.com's digital-product terms was found, saying personal, non-commercial use only) | inference; **do not use for a public site** as a prudent default |
| Official F1 live timing | yes | n/a | no public commercial price found | **do not scrape** (the brief) | NOT VERIFIED beyond that |
| any free source | **none found that is legitimate** | n/a | n/a | OpenF1's free access is historical only (outside the live window) | PRIMARY |

**Cheapest legitimate option: not decidable today.** The OpenF1 route is the only one with documented streaming, but its price is conflicting and the three feeds you reported as down are the ones a pit-wall view most wants. Before committing, ask OpenF1 through its contact form for: (1) the current pricing model and a written quote for your expected usage; (2) exactly which live topics stream today and when `/intervals`, `/location` and `/car_data` return; (3) whether a delayed feed is offered; (4) whether your intended use is within the licence. Free alternative for live: **none**; free OpenF1 gives *historical* data after the window closes, which is the FINAL tier, not a delayed feed.

### 4.1 Architecture

```
OpenF1 (paid)  --MQTT push-->  worker  --one row per session, ~every 5 s-->  Supabase live_state
                                  |                                              |
                                  |  also writes frames to a short ring buffer   +--> browser: poll cached JSON every 5 s
                                  v                                                   (or Supabase Realtime push)
                             heartbeat row (last frame time, last error)
```

- **Push vs poll:** prefer **MQTT push** (one connection, lowest latency, within the 10-connection limit); fall back to REST polling. REST polling at 60 requests/minute (the lower of the conflicting limit figures) allows about four endpoints every 5 s = 48/min; with `intervals` reported unavailable, use `position`, `laps`, `race_control`, `pit`/`stints` and `weather` (weather needs only one call a minute). The 4-second update rate of positions makes faster polling pointless.
- **Where the worker runs:** needs a long-lived process. **Not** the free Render tier: Render's docs say free services are not for production, have no background workers, and "service-initiated traffic can trigger suspension (e.g. invoking external APIs)". Options: a **paid Render instance at $7/month** (billed per second, so it could be created for race weekends only), or a small VPS (not researched). A GitHub Actions job that loops for a session is possible in principle but I did not verify its maximum run time and it conflicts with using Actions for scheduled maintenance.
- **How the frontend subscribes:** simplest and robust: a cached JSON endpoint polled every 5 s by the page (100 viewers is 20 requests/s of 3 kB responses; a 2-hour session at that load is about 43 MB of egress, trivial against the 5 GB free allowance). Supabase Realtime push is possible; its free-tier limits were not verified.
- **Monthly cost (live tier only):** OpenF1 price **unconfirmed** (EUR 9.90 on its homepage, usage-based per its form) + worker $7 (Render compute price, PRIMARY) + Supabase free ($0) or Pro ($25, PRIMARY) = **$7-32 plus the unconfirmed OpenF1 line**. Live access is only needed for roughly 5 sessions x 23 weekends; a monthly subscription can lapse between seasons.

### 4.2 What a delayed feed (30-60 s) looks like

The worker keeps a ring buffer of frames and releases each one at `source_time + delay` (say 45 s). The page shows the **DELAYED** badge with the lag ("about 45 s behind"). Benefits: polling every 10-15 s is enough; one missed poll is invisible; a REST-only provider (Sportmonks) works; and a delayed-feed licence tier, where a provider offers one, is typically cheaper than real time (**not verified for any provider here**; ask OpenF1 and Sportmonks). It does not remove the licensing question. It also does not require any extra data source: it is the same feed shown later.

### 4.3 LIVE / DELAYED / FINAL (stale data is never shown as LIVE)

Every live payload carries `source_ts` (when the data happened) and `server_ts` (when the API answered). The page computes `age = server_ts - source_ts` from those two server values, **never from the visitor's clock**.

| badge | rule |
|---|---|
| **LIVE** | the session is in progress per the schedule **and** `age <= 10 s` |
| **DELAYED** | the session is in progress and either the feed is a deliberate delayed feed (badge shows the lag) or `10 s < age <= 90 s` |
| **NO LIVE DATA** | the session is in progress but `age > 90 s`, or the worker heartbeat is missing: show the last known time and **never** the word LIVE |
| **FINAL** | the session has ended **and** the official results have been ingested and validated (Part 1D); until then show "provisional, last update HH:MM" |
| before the session | countdown, no live badge |

Invariant to test: for every state transition, a payload whose age is above the LIVE threshold can never render the LIVE badge.

## 5. Verified vs not verified (updated)

**PRIMARY (quoted from the provider's own page):** OpenF1 coverage, "real-time requires a paid subscription", the live window definition, the homepage latency statements, the streaming tutorial's endpoints and token rules, the CC BY-NC-SA licence; Jolpica's rate limits, licence, hosting cost and funding; FastF1's F1TV requirement; Sportmonks' polling model, call limit and omissions; Render, Supabase and GitHub limits (see `03-backend-options.md`).

**CONFLICTING:** OpenF1's price (EUR 9.90/month on the homepage vs usage-based per the access form as you report it) and its free-tier rate limits (two fetches of the same page differ); Sportmonks' price (EUR 69 vs 79 on one page).

**REPORTED by you, not independently verifiable (the access form now loads as inactive):** usage-based OpenF1 pricing; live `/location`, `/car_data`, `/intervals` currently unavailable. My historical-availability test is consistent with the second, and does not prove either.

**NOT VERIFIED:** OpenF1's real live latency and whether any live stream works today (needs a paid token and a session in progress); API-Sports (HTTP 403); F1TV's English terms (only an Italian translation found); the contents of Jolpica's, Sportmonks' and F1TV's terms; whether Sportmonks' licence allows public display; that a delayed-feed tier exists anywhere; Supabase Realtime free-tier limits; GitHub Actions maximum job time; whether OpenF1's non-commercial licence fits your plans; Jolpica's delay after a session; why `starting_grid` returned 0 rows for the race session key.

**Corrected from the earlier version of this document:** the live-data cost lines that assumed EUR 9.90, and the statements that FastF1/F1TV "reads F1's own feed under a consumer subscription: not a licence to republish", which are my inferences and are now labelled as such.
