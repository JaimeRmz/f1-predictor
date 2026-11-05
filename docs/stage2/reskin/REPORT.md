# Reskin report (branch `design/reskin`)

Frontend only. Nothing merged to main, no PR. `backend/`, `supabase/`, `.github/` and My Picks untouched.

> Screenshots: only six representative images are kept in the repo (`all-home-1440`, `all-home-390`, `all-race-1440`,
> `all-champ-standings-1440`, `all-model-1440`, `header-390-menu`) to keep the tree small. `capture-all.cjs` regenerates
> one per page and sub-tab, `capture-six.cjs` regenerates the six kept here; both need `npx vite` and the backend run locally.

## Pages done (all follow the Home system: shared header, plain-English panel titles with one-line captions, glass grid, TeamMark logos, mono tabular numerals)
| Nav | Page | Screenshot (kept ones only, see note above) |
|---|---|---|
| HOME | Home | `all-home-*` |
| RACE | Next Race | `all-race-*` |
| RACE > Predictor | Predictor (empty, upcoming, charts, explain a driver, completed-race replay) | `all-predictor-{empty,upcoming,charts,explain,replay}-*` |
| CHAMPIONSHIP > Standings | Standings | `all-champ-standings-*` |
| CHAMPIONSHIP > Drivers | Drivers | `all-champ-drivers-*` |
| CHAMPIONSHIP > 2026 Season | 2026 Season | `all-champ-season-*` |
| LIVE | Live ("No live data" empty state, no mock) | `all-live-*` |
| MODEL | Model | `all-model-*` |
| MORE > What-If | What-If | `all-whatif-*` |
| MORE > Compare | Compare (empty, with result) | `all-compare-{empty,}-*` |

All images are in this folder. Every screenshot was taken against the locally run backend; Supabase and every non-local host were blocked, so no tooling call reached them.

## This round
- **Model:** the headline panel shows the winner-pick backtest both ways. Before qualifying: model 9/43 (21%) vs points leader 12/43 (28%), best team's lead driver 13/43, predicted pole sitter 8/43. With the real grid: model 26/43 vs pole sitter 29/43. Bars carry the 95% range, and the text says the model is not shown to be better before qualifying. Static Stage 1 numbers, source noted in `homeModel.js` (`BACKTEST_FULL`).
- **Predictor, What-If, Compare:** reskinned with all functions kept. Predictor and What-If now show shares of the field with the raw score on tap or hover, like Home. Compare marks the better value per row and gives an empty state until two drivers are chosen.
- **Championship review fixes:** best circuits show the race count and flag one or two races as "limited history"; the Season accuracy table text is larger with higher contrast (logic untouched); the Standings header reads MAX REACHABLE with the caption "current points plus every point still available".
- **Vercel:** build status for each pushed commit is checked through the GitHub status API and recorded in the final message.

## Deviations
- LIVE is a plain empty state (the mock lives only on `design/pitwall-previews`).
- Predictor keeps the API's row order for its table (not re-sorted), and what-if keeps the API order for its live results.
- The Season standings table is now fetched (`/championship/status` + `/season/2026`) instead of hand-typed. Wins come from race results, points from the official table.
- Compare's circuit chart has no race counts in the data, so the caption says so.
- `homeModel.js` backtest numbers and every figure on the Model page are fixed values from the Stage 1 backtest (43 races: 2025 R1-R24 and 2026 R1-R19), recomputed from `analysis/out/backtest_rows.csv`, not fetched: podium ROC-AUC 0.954 real grid / 0.909 predicted grid, podium recall at a 0.5 score 91.5% / 86.0% (precision 52.0% / 47.4%), winner ROC-AUC 0.966 / 0.904, predicted-vs-real top-10 grid overlap 79.0%. They replace the earlier 0.945 / 0.972 / 89% / 77.8%, which the backtest does not reproduce (the old 77.8% and 0.972 have no source in the backtest, so they were replaced by the measured values and labelled with what they measure).

## Still off
- Race strategy rows (inside Season) keep their original internals and are low contrast; locally they were empty (no OpenF1 cache), so they were not visually checked with data.
- The pre-race tally on Season shows 0/0 in screenshots because Supabase is blocked for tooling.
- Compare's chart legend and the season chart tooltip use recharts defaults.
- The share-image card (Race page "Share prediction") is still an old-style image and only uses the new wording on its solo variant.

## Remaining probability / odds / confidence / chance wording
- User-facing, by design: "not a calibrated chance" (Home, Race, Predictor, What-If, Model captions).
- Model page: "a score, not a probability" (a denial).
- Not user-facing: API field names `win_probability` and `podium_probability`; `position_confidence` in `RaceStrategy`; code comments in `tally.js`, `homeModel.js`, `ChampionshipPage`.
- My Picks (unlinked, untouched): its own strings and comments still say "win probability".
- Share card fallback label "WIN PROBABILITY" (used only by My Picks' comparison card).

## Pages still on the old style
- My Picks (page kept, not linked from the nav; not edited, as instructed).
- The share-image card component and the race strategy rows inside Season.
