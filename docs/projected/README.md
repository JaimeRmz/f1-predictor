# Projected race

One illustrative race for an upcoming round, on the Replay page (strip chips marked `PROJECTED`). It is generated in the browser, replayed by
the same player as the recorded races, and never read as a forecast. It changes no score, share or probability anywhere on the site.

**What it is:** dots running lap by lap on the real circuit, starting from the model's predicted grid, finishing in an order drawn from the
the model's own ranking shuffled by noise set from the model's real backtest errors (a "rank-anchored" draw: see the header of `frontend/src/lib/projectedRace.js`), with 1-2 stops on the real pit
lane path, lapped cars at the back, and a seed shown on screen (same seed = same race; "Run another race" draws a new one).
The race opens on a **typical** seed: of 10,000 seeds, the one whose finishing order is closest to the median order (each driver's mean
finishing place over all seeds). It is computed in the browser from the same scores (~0.2 s).

## How the draw was set (analysis/23-26_projected_draw_*)
`analysis/23_projected_draw_profile.py` measures the model's real error by predicted rank over the 43 backtest races (predicted-grid condition,
retirements removed). `analysis/24_projected_draw_fit.py` fits a first set of noise parameters to that profile and
`analysis/26_projected_draw_tune.mjs` tunes them on the production code with the Brazil scores: the model's top driver wins ~28% of 10,000 seeds
(real backtest 23%), a bottom-half driver reaches the top five ~2.4% per driver / ~22% of seeds (real 3.0% / 26%), nobody finishes higher than the best
place seen in the real races for their rank, and the average finishing place never improves as the model rank gets worse (to within 0.3 places).
`analysis/25_projected_draw_compare.mjs` prints the old-vs-new table (`analysis/out/projected_draw_compare.txt`).
**What it is not:** no crashes, retirements, safety cars or red flags; a driver with no model score is not simulated.
The label "Illustration: one possible race consistent with the model's scores. It does not predict specific events such as pit stops, safety
cars or incidents." is always on screen.

## Files
| | |
|---|---|
| `scripts/build_circuit_packs.py` | reads the replay files, writes `pack-<circuitRef>.json` (3-4 KB each) and `packs.json` next to them |
| `frontend/src/lib/projectedRace.js` | pure generator `(pack, grid, scores, seed) -> replay file object`; ~120 ms for 71 laps x 20 cars |
| `frontend/src/lib/projectedRace.test.mjs` | unit tests (`node src/lib/run-test.mjs` from `frontend/`) |
| `frontend/src/lib/projectedInputs.js`, `useProjectedRace.js`, `components/ProjectedRace.jsx` | rows -> inputs, fetching, UI |

## Try it locally
1. Fill `frontend/public/replay-dev/` with `python backend/scripts/build_replay.py --all` (see `docs/replay/README.md`).
2. `python scripts/build_circuit_packs.py` (adds the packs and `packs.json` to that folder).
3. Run the backend locally (`uvicorn`, port 8000) and `npm run dev` in `frontend/`, then Race > Replay > a `PROJECTED` chip.

## Hosting
Packs go in the same place as the replay files (same bucket, same `VITE_REPLAY_BASE_URL`): upload `packs.json` and `pack-*.json` too.
No new environment variables. Without them the mode shows "not available" and nothing else changes. Circuits with no pack (or no pit lane)
show "Projected race not available for this circuit."

Circuit shapes and typical times come from OpenF1 position data (CC BY-NC-SA 4.0), 2025 race per circuit (2026 for Madring, Sepang).
Pit loss for Madring and Miami is estimated from lane time (too few clean stops).
