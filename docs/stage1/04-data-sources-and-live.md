# Stage 1, Part 1C (b): data sources, the grid-signal experiment, and live data

Branch `docs/stage1-audit`. Read-only. Public web and API reads only; no credential of any kind was used (no Supabase key, no F1TV account, no OpenF1 sponsor token). All OpenF1 responses were cached on disk and requested at least 2.4 s apart (222 requests, exactly the number the plan required, so no retries or rate-limit errors occurred). This is not legal advice; where licensing is unclear I say so.

## 1. Sources: what I verified and what I could not

Verified on 2026-11-02/03 from each provider's own public pages unless noted.

| source | role | coverage | freshness / latency | rate limits | license / terms | cost |
|---|---|---|---|---|---|---|
| **Jolpica-F1** (`api.jolpi.ca`) | the record: schedule with session times, results, standings, drivers, constructors | Ergast-compatible; I have used 2010-2026 | I did **not** measure delay after a session; I confirmed Mexico City (race Nov 1) results and standings were present on Nov 2 | **4 requests/s burst, 500 requests/hour sustained**, unauthenticated; callers behind the same IP/token share it; "limits will decrease in the future"; token access with higher limits is planned; project asks you to cache and to use filters/offsets | Apache-2.0 (code); API Terms of Use apply (I did not read the contents of `TERMS.md`) | free; volunteer-run, about $45/month hosting, funded by donations, aiming to "break even during the 2026 season"; no uptime promise |
| **OpenF1** (`api.openf1.org`) | practice/qualifying laps, stints, session results, starting grid, live data | **2023 onwards**, 18 endpoints. My pull: all 43 target race weekends present (2025: 123 sessions; 2026: 131 incl. testing); every one of the 12 sprint weekends had Sprint Qualifying results | sessions/meetings update daily at midnight UTC; `session_result` and `starting_grid` "a few minutes after the official results are published"; live: about 3 s behind, positions about every 4 s (their claim) | free tier **3 req/s and 30 req/min** per the homepage (the docs page states no limits); Sponsor 6 req/s, 60 req/min, 10 concurrent live connections | content **CC BY-NC-SA 4.0**; intended for "educational purposes, personal learning projects, research, and non-commercial fan engagement"; commercial use means contacting them. States it is unaffiliated with Formula 1 companies and that data is "aggregated from public sources" (it does not say which) | **free for historical data** (no auth); **live data €9.90/month** (Sponsor) |
| **FastF1** (Python library) | laps, telemetry, weather | not stated on its docs page | not described | not described | page says it is unofficial and unaffiliated; library license not stated there | free library, but "**now requires an F1TV Access subscription (or higher) for most of its features**" (account auth since v3.9.0) |
| **Sportmonks** Formula 1 API | commercial REST feed | practice, qualifying, race (sprint sessions **not mentioned**); historical depth not stated | "updates in real time"; delivered by REST polling, no push; refresh rate and latency **not stated** | 3,000 calls/hour per endpoint | not stated on the page (links to ToS I did not read) | **€69/month paid yearly (€830/yr)**; the FAQ says €79: the page contradicts itself, confirm before buying |
| **API-Sports** Formula-1 | commercial REST feed | **not verified**: the documentation returned HTTP 403 | not verified | not verified | not verified | not verified |
| **Official F1 live timing** (F1TV/app feed) | the origin of most live data | n/a | n/a | n/a | requires a consumer F1TV subscription; **not a licence to redistribute**. **Out of bounds: do not scrape it** (the brief). I found no public commercial price or API | not found |

Other providers surfaced by search (RapidAPI "F1 Live Motorsport Data", Apify scrapers, assorted GitHub tools) were low-quality or scrapers of the same sources and are not evaluated.

**What this means:** only **Jolpica** (record) and **OpenF1** (historical signals) are free and clearly usable today. Anything *live* costs money, and its upstream rights are the provider's claim; that is the main legal uncertainty (section 4).

**FastF1 was not run.** It needs an F1TV subscription account (which I do not have and would not use here), and its live path reads the official timing feed. The experiment below uses OpenF1 historical data, which carries the same lap and session-result information for 2023 onwards.

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
- **The 43-race "best available signal" blend is post hoc.** I defined it after seeing the per-signal results above (it combines the two signals that helped, one rule for every weekend), and I ran about ten methods against two targets, so treat its p-values as optimistic. The **pre-specified, individually tested findings** are the ones in 2.2. They point the same way.
- **Sample sizes are small** (43, 31 and 12 races), and the 12 sprint weekends are 6 in each of two seasons with different regulations in 2026.

### 2.4 A policy consequence the scorecard must respect

The Stage 0 snapshot job freezes the model's forecast before the **first graded session** (Sprint Qualifying on a sprint weekend, otherwise Qualifying), on purpose, so it is a forecast made before any weekend result is known. Both useful signals arrive **after** that moment on a sprint weekend (the Sprint Qualifying result *is* the first graded session) and **late** on a normal weekend (practice best lap exists only after FP1-FP3, hours before qualifying, while today's snapshot is taken up to 48 hours earlier). So these are **two different forecasts**: a *pre-weekend* one (what is frozen now) and a *pre-qualifying* one (after practice or Sprint Qualifying). If the pre-qualifying forecast is added, the scorecard must label which is which, and the freeze rule and the 30-minute workflow window need a second, later cutoff. That is a product decision for you; I have not changed any code or workflow.

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

**Rate-limit budget.** Jolpica allows 500 requests/hour and 4/s. A race-day ingest needs about 15-30 calls and re-validation about 4 x 4 calls, far below the cap. **Catch:** Jolpica says callers behind one IP share the limit, and GitHub-hosted runners egress from shared address ranges, so other users' traffic can eat into it. Mitigation: backoff with jitter on HTTP 429, cache every response, and ask Jolpica for a token (planned) or for a higher limit (their stated process). OpenF1's free tier (30 requests/minute) is ample at this volume (the Part 1C pull used about 25/minute).

**What the pipeline publishes** (one write per run, all stamped): results, standings, schedule, roster, next-race predictions with `model_version` and `as_of`, snapshots (unchanged, frozen), and a `pipeline_status` row (last success, last failure, last data time) that drives the site's "data last updated" badge. Part 1D gives the schema.

**What it does not do:** retraining stays a separate, deliberate, versioned step (the brief); a new `model_version` only appears when you approve it.

## 4. Live data, goal (2): true live positions during a session

**Which sources legally allow real-time use, and at what price and latency.**

| option | real-time? | latency | cost | rights position |
|---|---|---|---|---|
| **OpenF1 Sponsor tier** | yes: REST, **MQTT and WebSocket** | "typically about 3 seconds after live events"; positions about every 4 s (their statement; I could not test it, it needs a paid token) | **€9.90/month**; 6 req/s, 60 req/min, up to 10 concurrent MQTT/WebSocket connections | content is **CC BY-NC-SA 4.0, non-commercial only**; upstream data described only as "aggregated from public sources" and the project disclaims any affiliation. Legitimate **for a non-commercial fan project**; the rights to the underlying timing feed are not something OpenF1 claims to own, so the legal footing of any live display rests on OpenF1's terms and on staying non-commercial. If the site ever carries ads or charges, ask OpenF1 (and expect to need Formula 1's permission) |
| **Sportmonks** | yes, by **REST polling only** | not stated | **€69-79/month** (page contradicts itself) | licence terms not seen; sprint sessions not mentioned: verify both before buying |
| FastF1 live timing | yes | not applicable | needs an **F1TV subscription** | reads F1's own feed under a **consumer** subscription: not a licence to republish; **do not use for a public site** |
| Official F1 live timing | yes | n/a | no public commercial price found | **do not scrape** |
| any free source | **none found that is legitimate** | n/a | n/a | OpenF1's free tier is historical only: "live" is defined as 30 minutes before a session until 30 minutes after it, and only paid access works inside that window |

**Cheapest legitimate option:** OpenF1 Sponsor at €9.90/month, provided the site stays non-commercial (verified from their own pages; the legal footing beyond that is for you to judge, not something I can certify). Free alternative: **none** for live; free OpenF1 gives you *historical* data once the window closes, which is the FINAL tier, not a delayed feed.

### 4.1 Architecture

```
OpenF1 (paid)  --MQTT push-->  worker  --one row per session, ~every 5 s-->  Supabase live_state
                                  |                                              |
                                  |  also writes frames to a short ring buffer   +--> browser: poll cached JSON every 5 s
                                  v                                                   (or Supabase Realtime push)
                             heartbeat row (last frame time, last error)
```

- **Push vs poll:** prefer **MQTT push** (one connection, lowest latency, within the 10-connection limit); fall back to REST polling. REST at the Sponsor limit (60 req/min) allows about four endpoints polled every 5 s (positions, intervals, laps, race control) = 48/min, leaving headroom; the 4-second update rate of positions makes faster polling pointless.
- **Where the worker runs:** needs a long-lived process. **Not** the free Render tier: Render's docs say free services are not for production, have no background workers, and "service-initiated traffic can trigger suspension (e.g. invoking external APIs)". Options: a **paid Render instance at $7/month** (billed per second, so it could be created for race weekends only), or a small VPS (not researched). A GitHub Actions job that loops for a session is possible in principle but I did not verify its maximum run time and it conflicts with using Actions for scheduled maintenance.
- **How the frontend subscribes:** simplest and robust: a cached JSON endpoint polled every 5 s by the page (100 viewers is 20 requests/s of 3 kB responses; a 2-hour session at that load is about 43 MB of egress, trivial against the 5 GB free allowance). Supabase Realtime push is possible; its free-tier limits were not verified.
- **Monthly cost (live tier only):** OpenF1 €9.90 + worker $7 + Supabase free ($0) or Pro ($25) = **about $18, or $43 with Pro**. Live access is only needed for roughly 5 sessions x 23 weekends; a monthly subscription can lapse between seasons.

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

## 5. Verified vs not verified

**Verified (fetched from each source's own page on 2026-11-02/03, or measured by me):** OpenF1 coverage, tiers, price, live definition, stated rate limits, update rates and license text; Jolpica's rate limits, license, hosting cost and funding; FastF1's F1TV requirement; Sportmonks' price (with its internal contradiction), polling model, call limit and omitted details; Render, Supabase and GitHub limits (see `03-backend-options.md`); the experiment's results.

**Not verified:** OpenF1's real live latency and whether MQTT/WebSocket access currently works (needs a paid token; a third-party note suggested streaming may have been disabled at one point); API-Sports (HTTP 403); any official F1 commercial price or terms; Jolpica's actual delay after a session; the contents of Jolpica's Terms of Use, Sportmonks' terms and F1TV's terms; whether a delayed-feed licence tier exists anywhere; Supabase Realtime free-tier limits; GitHub Actions maximum job time; whether OpenF1's non-commercial licence is compatible with your plans for the site.
