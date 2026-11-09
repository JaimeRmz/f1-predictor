# Advance to R20 (Brazilian GP completed, Las Vegas upcoming)

`capture-advance.cjs` drives the Home page in a real browser and writes the screenshots in this folder (Las Vegas upcoming, Last race card for
Brazil, the race-over panel with the clock moved past Las Vegas start + 3 h, Brazil completed with no replay file yet).

## Advance points (hand-maintained: there is no schedule endpoint yet)
- `frontend/src/constants.js`: `NEXT_RACE` (now Las Vegas, 1189, sessions in UTC from Jolpica / races.csv), `UPCOMING_RACES_2026` (Brazil out, every round now carries `raceISO`), `COMPLETED_2026` (+1188 with `qualiISO` 2026-11-07T18:00Z).
- `frontend/src/lib/raceSim.js`: `COMPLETED_CIRCUIT` (+1188 interlagos).
- `frontend/src/lib/homeModel.js`: `phaseOf` now says "final-pending" (race start + 3 h passed, still upcoming) for ANY round that has `raceISO`; `isRaceOver()`.
- Already derived, nothing to edit: default round, "Last race" (`lastRaceFor`), Season / Next Race / What-If / My Picks (all read `NEXT_RACE`, `COMPLETED_2026`, `UPCOMING_RACES_2026`).
- Not changed: `STANDINGS_GRID_2026` (the /whatif roster; Camara is still not in it, see the PR notes) and backend snapshot scripts (`snapshot_model_pick.py` mirrors `COMPLETED_2026`).

## Race-over and no-replay states (Home Race sim)
| state | panel |
|---|---|
| upcoming round, start + 3 h passed, results not in the data | "Race finished. Results are loading." No projected race, no starting grid, no Play button. Kicker: RACE OVER · RESULTS NOT YET LOADED |
| results loaded, no replay entry/file in the manifest (Monaco, Brazil until uploaded) | "No replay available for this race." |
| manifest lists the race but its file is missing or broken | the same message after Play, no JS error |

## Brazil replay files (generated, NOT uploaded; scratch directory outside the repo)
| file | size |
|---|---|
| `1188.json.gz` | 419,794 bytes |
| `stints-1188.json` | 1,200 bytes |
| `manifest.json` (43 -> 44 entries) | 21,315 bytes |

Upload by hand in this order: `1188.json.gz`, `stints-1188.json`, then `manifest.json` LAST.
Proposed manifest entry (all other 43 entries are unchanged):
```json
{"raceId": 1188, "year": 2026, "round": 20, "name": "Brazilian Grand Prix", "date": "2026-11-08", "file": "1188.json.gz", "bytes": 419794, "seconds": 5860, "cars": 22, "laps": 71, "pit_lane": true, "quality": {"leader_strict": 0.997, "leader": 1.0, "exact": 0.977, "within1": 1.0, "longest_gap_s": 0.0, "retired": ["STR"]}, "flags": []}
```
Quality: leader agrees with the official /position feed 0.997 strict (1.0 lenient), positions exactly right 0.977 (1.0 within one place), top 3 0.992, longest location gap 0 s, no zero-filled or dropped cars, pit lane drawn, no flags. Retired STR, did not start BOT. Stints: 22 of 22 cars.
Notes: OpenF1 listed a phantom "lap 72" for the winner starting 0.1 s before the flag (real distance 71, Jolpica agrees); `build_replay.py` now drops lap rows that start at the chequered flag, so the file says 71. The replay's final official order has LEC 7th and LAW 8th (OpenF1 /position feed); the final classification (OpenF1 session_result and Jolpica) has LAW 7th and LEC 8th.
