# Stage 1, Part 1A: frontend and code audit

Branch `docs/stage1-audit`, code as of `main` `7b4dae36`. Read-only: no app code, data or model artifact was changed. All browser work ran against the **local** dev/preview server and local backend, with every non-local request aborted (including the app's own Supabase calls); no Render, Vercel-hosted or Supabase request was made.

## 1. Findings that matter most (ranked)

1. **The official Formula 1 logo is the site header on every page** (`frontend/public/f1-logo.png`, used at `App.jsx:1428`; I looked at the file: it is the F1 mark with a "TM"). This breaks the brief's "no official F1 logos" rule. The site name ("F1 Race Predictor", `index.html:6`) also uses the F1 mark's name; whether that is a problem is a legal question I cannot answer. The car illustration (`f1-car.png`) is generic clip-art with "OCAL" printed on it; its license is **unverified**.
2. **There is no router.** The current page is `useState("Home")` (`App.jsx:1391`); nothing reads or writes the URL (grep over all of `src/`). So: no deep links, no browser back button, no shareable page URLs, no per-page titles, no prerendering. This blocks the redesign's "live session view", sharing, and any SEO.
3. **The bundle ships ~198 kB (35%) of Supabase code in the entry chunk** to support one anonymous sign-in and a few small reads. Realtime, storage and "iceberg" modules are included and unused. Every visitor is signed in anonymously to Supabase on page load (`auth.jsx:48`), whether or not they ever use a feature that needs it. With My Picks being dropped, this can go away entirely.
4. **Accessibility baseline is poor in specific, measurable ways** (section 8): between 15% and 82% of rendered text nodes are under 11 px depending on the page (Predictor 82%, Championship 76%, Compare 76%, Model 69%, Season 67%, Home 60%); the two secondary text colours fail WCAG AA contrast (analytic: 3.98:1 and 1.37:1 on the background); only the Home page has a heading (none of the other eight pages has any `h1`-`h6`); the page title never changes.
5. **The 2026 Season page makes 19 backend requests per visit** (163.7 kB), one `/predict/{raceId}` per completed race, measured on the production build. My Picks does the same (out of scope here).
6. **Copy contradicts the backtest.** The Home page says "Probabilities reflect historical outcome rates, not guesses" (`App.jsx:1367`); Part 1B shows they are not calibrated (win scores sum to ~3). The Model page's headline numbers are hard-coded and stale (section 10).
7. **Everything season-specific is hand-maintained** in at least 11 places in the frontend plus several in `backend/scripts` (section 6). The strategy data baked into the bundle stops at round 10 (raceId 1178).
8. **No CI builds, lints or tests the frontend.** The three workflows cover snapshots, validation and the heartbeat. The only test file covers `tally.js` (My Picks).

What is good and should be kept: the design token system (CSS variables, glass panels, semantic colours), the cold-start-aware `HealthProvider` / `WakingPanel` / `BackendPanel` pattern, honest empty/error states, `prefers-reduced-motion` handling, working keyboard focus styles, no horizontal overflow at 390 px on any page, and no unlabeled buttons or images.

## 2. Verified vs not verified

**Verified (measured or read from code):** everything in sections 3-9 except where marked. File sizes and bundle attribution come from a production build with sourcemaps made in a temp directory outside the repo. Request counts come from the production build served locally. Accessibility numbers come from the live DOM at three viewport widths, measured on the Vite dev server (same CSS and markup as the production build; the request counts are the ones taken from the production build).

**Not verified / approximate:**
- **Contrast of text on glass panels is approximate.** I composite the element's ancestor background colours onto the page background; gradients and `backdrop-filter` blur are not modelled. The two secondary text tokens are exact (computed analytically on the plain background, section 8.2).
- No Lighthouse, no screen-reader test, no real-device test, no measurement of the particle animation's CPU/battery cost.
- Tab order and keyboard operation of the custom dropdowns (`RaceSelector`, `DriverSelector`) were not tested by hand.
- The Vercel/production deployment was not touched, so production-only behaviour (headers, caching) is not covered.
- My Picks was excluded from the audit as instructed (only its bundle cost is noted).

## 3. Architecture

| aspect | what exists |
|---|---|
| stack | React 19.2, Vite 8, plain JavaScript (no TypeScript), `axios`, `framer-motion`, `recharts`, `html-to-image`, `@supabase/supabase-js`. ESLint is configured and passes. |
| source size | 6,688 lines in `frontend/src`: `App.jsx` 1,457; `index.css` 851; `shared.jsx` 605; 9 page files 100-520 each; `constants.js` 269. |
| routing | none (see finding 2). `pages` is an object keyed by nav label; the active key is state; a `pageKey` counter forces a remount and a 500 ms "sweep" animation on each navigation. |
| global state | two React contexts: `HealthProvider` (backend wake/online/offline) and `AuthProvider` (anonymous Supabase user). No other shared state; no cache or data-fetching library. |
| styling | CSS variables for tokens (`index.css`) plus **522 inline `style={{...}}` objects** against 158 `className=` uses. Design tokens are good; their use is mostly inline and not reusable as classes. |
| data access | direct `axios`/`fetch` inside each page's `useEffect`; no shared client, no cache, no request de-duplication. Production build: `/races` and `/drivers` are fetched once per page that needs them (so Drivers and Compare each fetch `/drivers`). |
| entry | `main.jsx` renders `<App/>` in `StrictMode` (which double-runs effects in dev only; I confirmed the production build does not double the requests). |
| error handling | per-page `BackendPanel` (waking vs offline, auto-retry). **No React error boundary** anywhere: one render exception blanks the whole app. |

`App.jsx` is a monolith: lines 80-1,008 (about 64% of the file) are a decorative particle animation (car silhouette to circuit, including Monaco circuit path data); the nav, home page and root are the remaining ~500 lines.

## 4. Pages and routes (nav labels; no URLs exist)

Chunk sizes from the production build (gzip). Backend requests are per visit on the production build.

| page | file (lines) | gzip chunk | backend calls | Supabase | verdict |
|---|---|---|---|---|---|
| Home | in `App.jsx` | in entry | 1 (health) | 1 (auth) | rebuild: new home answering the brief's questions |
| Predictor | `PredictorPage` (315) | 8.5 kB (+ recharts) | `/races`; `/predict/{id}` or `/whatif` per selection | none | rebuild |
| Next Race | `NextRacePage` (231) | 2.9 kB | `/whatif` (auto_quali) | none | rebuild: derive from schedule API; no Austin/Brazil literals left but data is hand-fed |
| What-If | `WhatIfPage` (342) | 3.4 kB | `/whatif/qualifying`, `/whatif` | none | keep concept (live-inference endpoint is in the plan); rebuild UI |
| Championship | `ChampionshipPage` (146) | 2.3 kB | `/championship/status` | none | keep (already derived); restyle |
| Drivers | `DriversPage` (142) | 2.1 kB (+ recharts) | `/drivers`, `/driver/{ref}` | none | rebuild |
| Compare | `ComparePage` (109) | 1.6 kB (+ recharts) | `/drivers`, `/compare` | none | rebuild or merge into Drivers |
| 2026 Season | `Season2026Page` (324) | 3.7 kB | **`/predict/{raceId}` x19**, 163.7 kB | `model_snapshots` read | rebuild around one precomputed scorecard endpoint |
| Model | `ModelPage` (104) | 2.6 kB | none | none | rebuild: generate from the backtest artifact, not hard-coded |
| My Picks | `MyPicksPage` (521) | 4.8 kB | `/predict/{raceId}` x19 | `predictions`, `model_snapshots` | **dropped by the product owner**; remove with `auth.jsx` and `lib/tally.js` |

Lazy loading is used for all pages except Home, which is correct. Shared lazy chunks: `useShareCard` 7.2 kB (the html-to-image share-card capture), `RaceStrategy` 3.2 kB.

## 5. Components and shared code

| item | what it is | verdict |
|---|---|---|
| `components/GlassPanel.jsx` (131) | the glass surface and HUD corner brackets; reads team tint | **keep** (the design system's core) |
| `constants.js` `card`, `cardRed`, `glassStyle`, `hexA` | glass styling helpers as JS objects | keep the look; convert to classes/tokens |
| `shared.jsx` (605) | `CountUp`, `StatCard`, `SectionHeader`, `Pill`, `CustomTooltip`, `Spinner`, `SkeletonList`, `WakingPanel`, `OfflinePanel`, `BackendPanel`, `RaceSelector`, `DriverSelector` | keep the state panels and skeletons; rebuild selectors |
| `health.jsx` (97) | backend health poller, cold-start aware (waking vs offline after 75 s) | **keep** (good pattern; extend with LIVE/DELAYED/FINAL source state) |
| `auth.jsx` (66), `lib/supabaseClient.js` (17), `lib/tally.*` | anonymous auth and My Picks scoring | **remove** with My Picks (see finding 3); the scorecard only needs a public read |
| `components/SharePredictionCard.jsx` (215), `useShareCard.js` | non-glass shareable image, captured with html-to-image | keep (brief: share card stays non-glass); lazy |
| `components/RaceStrategy.jsx` (258), `TelemetryTraces.jsx` | strategy/stint viewer from OpenF1 JSON; decorative SVG traces | strategy: keep the idea, change the data source (section 6); traces: decorative, optional |
| `carSampling.js`, `carSampler.worker.js` | samples the car PNG into particles for the hero | decorative; drop or isolate behind a lazy import |
| `App.jsx` particle animation | ~930 lines of canvas code and circuit path data | **remove from the entry chunk** |

Over-exported (used only inside their own file, so harmless): `CAR_SAMPLE_SCALE`, `CAR_FILL_PADDING` (`carSampling.js`), `hexChannels`, `CIRCUIT_COUNTRY` (`constants.js`), `OfflinePanel` (`shared.jsx`). Dead code found: backend `/canada/schedule` and `/canada/predict` (`main.py:447-466`) are not called by any frontend code; a CSS class is still named `.canada-hero` (`NextRacePage.jsx:97`). `index.html:5` points the favicon at `/vite.svg`, which does not exist (the real file is `public/favicon.svg`).

## 6. Hardcoded season/race-specific constants (file:line)

The brief's goal is "nothing season-specific in code". Today, a race weekend requires hand edits to all of these:

| where | what |
|---|---|
| `constants.js:165` `NEXT_RACE` | raceId, round, name, venue, circuitRef, flag, race time, quali cutoff, **all five session times** |
| `constants.js:190` `COMPLETED_2026` | 19 hand-listed races with quali times, plus the notes on which have no snapshot |
| `constants.js:127` `UPCOMING_RACES_2026` | remaining calendar (dates as text) |
| `constants.js:245` `STANDINGS_GRID_2026` | the 22-driver roster, in standings order (assumes Ocon back at Haas) |
| `constants.js:38` `CONSTRUCTOR_OVERRIDES`, `:60` `TEAM_COLORS` | driver-to-team map (incl. one-off Hirakawa/Tsunoda entries) and team colours |
| `constants.js:141` `CIRCUIT_COUNTRY` | circuit to flag country |
| `pages/Season2026Page.jsx:41` | hand-maintained top-10 standings (points, wins, colour) |
| `pages/Season2026Page.jsx:14` `CALENDAR_FLAGS` | per-round flag emoji, rounds 9-23 only |
| `App.jsx:58` | nav tab list, including the 2026 Season label; `:1339`, `:1351`, `:1367` "2010-2026", "Season 2026 live", "Every 2026 race ..." |
| `components/SharePredictionCard.jsx:63` | "2026 FIA F1 WORLD CHAMPIONSHIP" on the share card |
| `pages/ChampionshipPage.jsx:82`, `DriversPage.jsx:54`, `shared.jsx:335` | "2026" in titles and race-selector labels |
| `pages/ModelPage.jsx:54-56, 88, 90` | ROC-AUC 0.945, recall 89%, training 6,436, "2025-2026 holdout" |
| `components/RaceStrategy.jsx:8` + `data/openf1_strategy/` | strategy JSON for **10 races only (1169-1178)**, bundled at build time. Rounds 11-19 (9 races) have none. Adding a race means running a script and rebuilding the frontend. How `RaceStrategy` renders a missing race was not checked. |
| backend: `scripts/fetch_openf1_strategy.py:43` | `COMPLETED_IDS = range(1169, 1179)` |
| backend: `scripts/snapshot_model_pick.py:58` | the explicit completed-race list for `--backfill` (a policy list, not just data) |

Race-level facts hard-wired in code are also a correctness risk (the Las Vegas `las_vegas`/`vegas` circuitRef bug that Stage 0 found lived here).

## 7. Bundle

Production build (Vite 8) of the current code, in a temp directory. Raw / gzip.

| chunk | raw | gzip | what |
|---|---|---|---|
| `index-*.js` (entry) | 565 kB | 166 kB | see attribution below |
| `BarChart-*.js` | 340 kB | 99 kB | recharts (206 kB), redux-toolkit, es-toolkit, d3-scale; loaded by Compare, Drivers, Predictor |
| 10 strategy chunks (`1169-1178`) | 764 kB total | 83 kB total | baked OpenF1 JSON, lazy per race |
| `axios` | 40 kB | 15 kB | |
| all page chunks (incl. My Picks) | ~98 kB | ~32 kB | |
| **total JS+CSS** | **1,861 kB** | **413 kB** | across 27 files |

(The 578 kB figure in the brief is the production minifier's number for the entry chunk; I measure 565 kB in this build. Same order, different build.)

Entry chunk attribution, from the sourcemap (`analysis/07_bundle_attribution.py`, approximate to a few percent):

| package | kB | share | note |
|---|---|---|---|
| react-dom | 174 | 31% | needed |
| **Supabase (auth, realtime, phoenix, storage, postgrest, client, iceberg)** | **~198** | **35%** | auth-js 93, realtime 29, phoenix 25, storage 21, postgrest 15, client 10, iceberg 5. The app uses auth + 3 reads. |
| framer-motion + motion-dom | 121 | 21% | imported statically by `App.jsx`, `shared.jsx`, `constants.js` |
| `App.jsx` (the particle code and home) | 26 | 5% | |
| `shared.jsx` | 15 | 3% | |

Without Supabase's unused parts and with the animation lazy-loaded, the entry chunk could plausibly fall by about 40-50% (an estimate, not measured). Removing My Picks and anonymous auth removes `auth-js`, realtime, storage and most of the client.

## 8. Accessibility and mobile (measured)

### 8.1 Per page, 390 px wide (the 768 px and 1280 px results are in `analysis/out/frontend/a11y_audit.json`; they differ only in tap targets)

| page | horizontal overflow | text under 11 px | text failing AA contrast (approx) | interactive under 44 px | headings |
|---|---|---|---|---|---|
| Home | none | 24 / 40 | 28 / 40 | 10 / 10 | 1 (h1) |
| Predictor | none | 14 / 17 | 14 / 17 | 10 / 11 | 0 |
| Next Race | none | 111 / 398 | 296 / 398 | 11 / 11 | 0 |
| What-If | none | 77 / 278 | 192 / 278 | 11 / 11 | 0 |
| Championship | none | 102 / 135 | 103 / 135 | 10 / 10 | 0 |
| Drivers | none | 15 / 103 | 99 / 103 | 95 / 95 | 0 |
| Compare | none | 16 / 21 | 16 / 21 | 10 / 13 | 0 |
| 2026 Season | none | 309 / 458 | 322 / 458 | 29 / 29 | 0 |
| Model | none | 70 / 101 | 74 / 101 | 10 / 10 | 0 |

- Smallest rendered text is 8 px. Of 201 inline `fontSize` literals in rem, 116 are below 0.7 rem (11.2 px); there are 12 distinct sizes below 0.7 rem, so there is no type scale. (The Championship page I rewrote in Stage 0 follows the same pattern: 76% of its text is under 11 px.)
- **No page overflows horizontally at 390 px.** The nav tabs scroll horizontally by design.
- "Interactive under 44 px" is mostly the 40 px-tall nav tabs (above the 24 px WCAG 2.2 AA minimum, under the 44 px recommendation); nothing is under 24 px. On Drivers, 95 buttons (the driver list, `DriversPage.jsx:68`) are under 44 px.
- Zero interactive elements without an accessible name, zero images without `alt`, zero clickable non-semantic elements, on all nine pages.
- `main`, `nav` and `header` landmarks exist; the document `lang` is set; the viewport meta is correct.
- **Only the Home page has a heading.** Every other page uses `div`s styled as headings (`SectionHeader`), so assistive-technology heading navigation finds nothing.
- `document.title` is "F1 Race Predictor" on every page; there is no meta description and no social-card metadata.
- The hero `<canvas>` has no `aria-hidden` or role. ARIA attributes in the whole app: about 20.
- Visual issues seen in screenshots: **flag emoji render as the letters "BR" on Windows Chrome** (nav tab and Next Race hero); on a 390 px screen the header subtitle is clipped.

### 8.2 Contrast of the design tokens (analytic, on the `--void` background `#0a0a0c`)

| token | contrast | note |
|---|---|---|
| `--text` (ink, 100%) | 16.74:1 | fine |
| `--muted` (ink at 45%) | **3.98:1** | below the 4.5:1 AA minimum for body text; used for most secondary text. Needs at least ~49% opacity; 55% gives margin |
| `--dimmed` (ink at 14%) | **1.37:1** | meant for decoration, but used for readable text (the Home subtitle "Live predictions. Every race." measured 1.37:1) |
| `--red` `#E10600` | 3.98:1 | fails for small text; lightened `#ff3b30` gives 5.58:1 |
| `--teal`, `--green`, `--amber` | 12.5, 8.8, 10.8 | fine |
| team colours as text | Ferrari 3.98, Cadillac 3.36, Red Bull 4.08 (others 4.9-10.3) | three fail |

The failing-text counts in 8.1 are driven mostly by `--muted` and `--dimmed` in small type; fixing the tokens and the type scale together would remove most of them.

### 8.3 Other
`prefers-reduced-motion` is honoured (CSS media query plus `MotionConfig reducedMotion="user"`); `:focus-visible` draws a 2 px red outline. The one-second countdown re-renders only its own component, but whether it is announced repeatedly by screen readers was not tested.

## 9. Network and load behaviour (production build, local backend)

Home 1 request (health poll) + 1 Supabase auth call; Predictor 2 (19 kB); Next Race 3; What-If 5; Championship 2; Drivers 2; Compare 2; **2026 Season 20 (163.7 kB)**; Model 1. Every page load also attempts one anonymous Supabase sign-in call (the Season page 5, including the snapshot read). On Render's free tier a cold start is about 50 s, so the Season page's 19 parallel `/predict` calls all wait on a sleeping backend, and each recomputes predictions on the server including `feature_contributions` that the page does not display.

## 10. Claims on the site vs what was measured

| claim | where | measured |
|---|---|---|
| "Probabilities reflect historical outcome rates, not guesses" | `App.jsx:1367` | **Contradicted** by Part 1B: win scores sum to about 3 per race and are over-confident in 6-9 of 10 reliability bins |
| ROC-AUC 0.945, "2025-2026 test set" | `ModelPage.jsx:54` | I measure 0.954 on the 43-race replay with the **real grid**, and 0.909 on the **predicted-grid path the site shows before qualifying**. Static number, not updated as races complete; the page does not say which path it describes |
| Recall 89% ("podiums caught") | `ModelPage.jsx:55` | 91.5% at a 0.5 threshold (real grid); precision at that threshold is 52%. Threshold not stated on the page |
| Training 6,436 race entries | `ModelPage.jsx:56` | **Correct** (6,436 rows with year <= 2024) |
| "9 features, strictly pre-race, no leakage" | `ModelPage.jsx:87` | **Supported** for 2025-26: Part 1B's recomputation found 0 mismatches over 897 rows |
| "Every 2026 race tests the models on data they've never seen" | `App.jsx:1367` | True for training data; but only 3 of the 14 saved snapshots are genuine pre-cutoff forecasts (Part 1B) |

## 11. Maintainability

- Tests: one file (`lib/tally.test.mjs`, 9 tests), for My Picks scoring. No component, page or API-contract tests.
- No workflow builds, lints or tests the frontend; Vercel's own build on push to `main` is the only check.
- JavaScript, not TypeScript; the API shapes are implicit.
- Hand-copied constants: team colours exist in `constants.js` and again as hex literals in the Season standings array; a page can disagree with another.
- `package.json` lists `puppeteer-core` as a devDependency (used by tooling, not the app).

## 12. Keep vs rebuild

| keep | rebuild | remove |
|---|---|---|
| design tokens and the glass system (`GlassPanel`, CSS variables, semantic colours) | app shell with a real router (URLs, titles, back button, prerender or at least per-route metadata) | official F1 logo; verify or replace the clip-art car |
| `HealthProvider` + waking/offline/skeleton patterns | home screen (next race, championship incl. champion state, model expectation and uncertainty, scorecard) | particle animation from the entry chunk |
| `SharePredictionCard` (non-glass) and the lazy capture hook | all pages that hand-feed constants: Next Race, Season, Predictor, Drivers, Model | My Picks, `auth.jsx`, `lib/tally.*`, Supabase auth and its ~198 kB |
| `ChampionshipPage` logic (already derived from `/championship/status`) | the data layer: one typed client, cached, with a freshness/source field (LIVE / DELAYED / FINAL) | `/canada/*` endpoints, `.canada-hero`, `vite.svg` favicon |
| `WhatIfPage` concept (live-inference endpoint) | type scale, text and token contrast, heading structure, landmark titles | per-race N+1 `/predict` loops |
| lazy loading of pages and of the share-card capture | Model page generated from the backtest artifact | |

## 13. What this means for the redesign and the next parts

- The redesign needs, before any visual work: routes with URLs; one set of read endpoints for schedule, results, standings, roster, next race, completed races, snapshots and (for the scorecard) a single precomputed accuracy endpoint, each carrying `as_of`/source so the UI can show LIVE/DELAYED/FINAL honestly (Parts 1C and 1D).
- The accessibility floor to set for any new design: minimum 12 px text, `--muted` at least about 55% (or an equivalent token), one `h1` per route, real headings, lightened red for small text, and an AA contrast check in CI.
- Copy and numbers about model quality should be generated from an evaluated artifact, not typed in; probability-heavy UI stays out of production until calibration is shipped (the brief's UI rule), and the scorecard should say which snapshots are genuine foresight.

## 14. Reproduce

```
cd frontend && npx vite build --outDir <tmp>/dist-audit --emptyOutDir --sourcemap     # outside the repo
python analysis/07_bundle_attribution.py <tmp>/dist-audit/assets/index-XXXX.js          # sourcemap attribution (no dependencies)
node analysis/08_frontend_a11y_audit.cjs <outdir>     # needs the dev server on :5173 and backend on :8000; blocks all non-local requests
node analysis/09_frontend_network_profile.cjs <outdir> # set BASE_URL to audit a production build served locally
```

Raw outputs are committed in `analysis/out/frontend/` (`a11y_audit.json`, `network_profile.json`); screenshots were viewed but not committed. The scripts print the summary tables used above. Note `network_profile.json` was last written by the production-build run (the dev-server run double-counts requests under StrictMode).
