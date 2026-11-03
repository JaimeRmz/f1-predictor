# Stage 2 — pit-wall design directions

Three previews, five screens each, all built from **local fixtures** (no API calls; the capture
script blocks every non-local request and recorded 0 attempts). Screenshots: `docs/stage2/img/`
(`{a,b,c}-{home,race,champ,live,model}-{desktop,390}.png`, desktop = 1280 px).
Regenerate with `node docs/stage2/capture.cjs <scratch-dir>` while `npx vite` runs in `frontend/`.

Preview URLs (the Vercel preview of this branch, one HTML page per direction, `?screen=` picks the page):
`<preview-host>/design-a.html?screen=home|race|champ|live|model` (same for `design-b.html`, `design-c.html`).
Extra switches: `?now=<ISO>` pins the countdown, `?frame=<n>` pins the mock live frame, `?state=live|delayed|stale|final`.
Production pages are untouched: `index.html`, `src/main.jsx`, `src/App.jsx` have no diff.

## What every direction obeys
- "Model score", never "probability". Home scores are rescaled per race (win sums to 1, podium to 3) and labelled; raw sums (2.992 / 5.265) are stated.
- Honest scorecard: only 3 of 14 saved snapshots (races 11, 13, 15) were frozen before qualifying; 1 of 3 winners named. The rest are labelled backfilled / after cutoff / none.
- "How reliable is this?" from the backtest: winner picked right 21 % (9/43) vs 28 % for "pick the standings leader"; calibration chart with 95 % intervals and a baseline table.
- Live screen is mock data, bannered as such, with only positions, race control and weather. Badge follows the Stage 1 rule (LIVE ≤ 10 s, DELAYED 10–90 s or delayed feed, NO LIVE DATA > 90 s or unknown, FINAL once results are ingested); unit-tested (14 asserts, includes "stale or delayed can never be LIVE").
- Existing glass panels and semantic colours (red actions/P1, teal model, gold win score, green outcomes); header logo kept; original graphics only; tabular numerals.

## Comparison
| | A · Timing tower | B · Strategy wall | C · Broadcast minimal |
|---|---|---|---|
| Idea | Permanent ranked rail on the left, dense monospace panels beside it | Modular 12-column wall of glass panels | Oversized type, almost no chrome, one idea per band |
| Best at | Scanning the full 22-driver order; feels most "pit wall" | Mixed content: charts, tables, stints, tiles side by side | Home and race headline; calmest, fastest to read |
| Weak at | Densest; the rail is 22 rows tall on mobile (stacked above content); heaviest to maintain | Least distinctive; closest to a generic dashboard | Tables and calibration chart look thin; needs more glass panels to hold data screens |
| Glass system | Panels reused, rail is a panel | Native fit, nearly one-to-one with today's cards | Used sparingly (reliability, chart) |
| 390 px | Works; long first screen | Works; panels simply stack | Works after fixes; best reading experience |
| Honesty copy | Fits as small notes | Fits as panel footers | Fits, but notes can feel like footnotes — needs deliberate weight |

## Recommendation: B, with C's oversized race title on Home
B is the only direction that carries all five screens equally well, maps one-to-one onto the glass panels
already in production (so the reskin is mostly layout and tokens, low regression risk), and handles the
mandatory honesty content (scorecard, reliability, baselines) without crowding. Borrow C's large Grand Prix
title and countdown for the Home hero for the broadcast feel; skip A's persistent rail (costly on mobile).

## Caveats
- Race 1183's stored foresight pick differs from a local point-in-time rerun: the snapshot was frozen before the previous race's results were ingested. The stored picks are used as authoritative (`derived_check_matches: false` is kept in `scorecard.json`).
- Race page shows round 10 because strategy data exists only through round 10 (known gap).
- In A at 390 px the tower's last row can sit tight against the next panel; cosmetic, not fixed.
- Fixtures were generated offline with `frontend/src/previews/fixtures/make_fixtures.py`; they are a snapshot, not live.
- `vite.config.js` has multi-page inputs for the previews; do not merge this branch. Task 2 branches from here and removes them.
