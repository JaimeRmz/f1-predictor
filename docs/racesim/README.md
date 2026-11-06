# Home "Race sim" band

A full-width band on Home, directly under "Model's top 3" and above "Full forecast" and the side panels. It follows the selected race pill.
Code: `frontend/src/components/RaceSimBand.jsx` (mode choice in `lib/raceSim.js`), reusing `ReplayPlayer` (new `compact` variant), `OrderBoard`,
`useProjectedRace` / `generateProjectedRace` and `useReplayRace`. No logic is duplicated.

| Selected race | What the band shows |
|---|---|
| Upcoming round | The projected race in the model's order (same data and generator as the Race page). Dashed-gold chip "PROJECTED · ILLUSTRATION" and the notice "The model's ranking played out as a race. It shows the order the model expects, not a forecast of the exact finishing order or of events such as pit stops, safety cars or incidents." |
| Completed round with a replay | The real replay, chip "REPLAY · REAL RECORDED POSITIONS", the same OpenF1 licence line as the Replay page plus the tyre credit. |
| Monaco 2026 (no replay file) | One line, "No replay available for this race.", and no player. |

**Click to play, no autoplay.** Before Play the track and cars on the starting grid are drawn from the circuit pack (about 4 KB); for a
completed race the board says "Starting grid". The real replay file (about 360 KB) and its stints file are requested only when the visitor presses Play
or moves keyboard focus into the band's controls; a small "LOADING…" state shows meanwhile and a failure falls back to "Replay unavailable right
now." without crashing. After a Play press the replay starts as soon as it arrives (unless the visitor prefers reduced motion: then they press Play again).

**Controls** (all at least 44 px tall): Play / Pause, -10 s, +10 s, speed 1x / 4x / 16x (`aria-pressed`), "LAP n OF N", and "OPEN FULL VIEW", which opens the
Replay page on the same race (a chip id passed through `App`: the raceId, or `p<raceId>` for a projected race). The Order board shows the top 10 and has
the GAP | INT toggle (same choice as on the Replay page, remembered in `localStorage`). Below 900 px the track and controls stack above the board.

**Home first load** (default upcoming race) requests only `replay-dev/packs.json` and `replay-dev/pack-<circuitRef>.json` besides the backend calls Home
already made; no `.json.gz` and no `stints-*.json`. A completed race adds `manifest.json` and its pack. Re-check with `node docs/racesim/capture-racesim.cjs <scratch-dir>`
(it also writes the screenshots in this folder).

Completed rounds have no `circuitRef` in `constants.js`, so `COMPLETED_CIRCUIT` in `lib/raceSim.js` maps each 2026 raceId to its circuit pack.
