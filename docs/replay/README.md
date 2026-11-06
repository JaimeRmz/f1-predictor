# Race replay (OpenF1)

Real recorded car positions of completed 2025-2026 races, replayed on the track outline with an order board. Under **RACE → Replay**.

> **Position data: OpenF1 (CC BY-NC-SA 4.0). Replay is interpolated from ~3.8 Hz samples and is not official timing.**
> The site is non-commercial. The derived replay files are share-alike under the same licence.

## How it works
1. `scripts/build_replay.py` downloads one race from OpenF1's free historical API (about 30 calls, at most 25 a minute) and writes
   `<raceId>.json.gz` plus an entry in `manifest.json`. It deletes the race's raw download afterwards (a race is 90-140 MB raw; the file is about 350 KB).
2. The player (`frontend/src/pages/ReplayPage.jsx`, `components/ReplayPlayer.jsx`, `lib/replay.js`) fetches `manifest.json`, then one race file on
   demand, decodes it once and animates it with cubic interpolation of the 1 Hz positions on a canvas.
3. The **order board is OpenF1's official `/position` feed**, not an order recomputed from x/y. The recomputed order is only used to measure agreement
   (see `quality-<raceId>.md` and `SUMMARY.md`).

## File format (version 1)
Positions are decimetres, delta-encoded, one sample per second from 90 s before lights out to 45 s after the chequered flag.
`race` (ids, `t0` epoch, `n` seconds, `lights_out`, `chequered`, `laps`), `drivers` (code, team, colour, `status` dnf/dns/dsq, `out_t`), `track`
(`outline`, `sf` start/finish, `pit` lane path or null, length), `pos[code].x/y`, `gaps` (seconds a car sent no data), `in_pit` (stop windows),
`lap_starts`, `laps` (leader crossing, official order and gap per lap), `board` (official position changes per driver), `pits`, `flags`, `bands`.

## Handling of the awkward cases
- All-zero location samples (a car not transmitting) are never drawn. A retiree is marked OUT from the last second it moved and is frozen there.
- Pit-lane starters are re-anchored to the grid. The outline is closed at the start/finish line.
- The pit lane is the median path of all real stops (OpenF1's pit `date` is the moment the car leaves the lane). If the stops disagree, no lane is
  drawn and stops show as a PIT tag on the board; the race gets the `pit_lane_not_drawn` flag in `manifest.json`.
- A race that fails a check (for example under 95% leader agreement with the official feed) is flagged in `manifest.json`, never hidden.

## Order board: GAP / INT
The Order panel (real Replay and Projected race) has a two-way toggle, **GAP** (default: gap to the leader) and **INT** (interval: time to the car
directly ahead = the difference between neighbouring gaps). `orderLabels()` in `frontend/src/lib/replay.js` does the maths: the leader shows LEADER in
both modes; OUT / DSQ / PIT / NO DATA tags win; a lapped car (text gap such as "+1 LAP"), an unknown gap, or a pair of gaps that disagree with the
order (an overtake since the lap began) shows "-" in INT mode; a retired car is skipped when looking for "the car ahead". The choice is kept in
`localStorage` (key `f1.orderMode`, wrapped in try/catch; without storage the board starts on GAP). Buttons carry `aria-pressed`.

## Tyre compounds on the Order board (real replay only)
`python scripts/build_stints.py` writes `stints-<raceId>.json` (about 1 KB each, 42 files) next to the replay files:
`{"v":1,"raceId":1172,"source":"...","stints":{"NOR":[["M",1,27],["H",28,57]]}}` = [compound letter S/M/H/I/W, first lap, last lap].
Sources, first match wins: `data/openf1_strategy/<raceId>.json` (already in the repo, 9 races), a local OpenF1 response cache
(`analysis/cache/openf1`, 4 races), then OpenF1 `/stints` (one call per race, at most 25 a minute; 29 calls the first time). The script only reads the
replay `.json.gz` files, it never rewrites them. Coverage per race (cars with stint data / cars in the replay): `docs/replay/STINTS.md`.
In the player (`useStints`, `stints.js`) the file is fetched only when a real replay opens; each car shows a letter inside a coloured circle
(S red, M yellow, H white, I green, W blue) that changes on the lap after a stop (a car's own lap, from its own line crossings; the in-lap keeps the
old tyre). A race without a file, or a car without stint data, shows nothing and nothing breaks. The Projected race shows no tyre info.
The replay credit line adds "Tyre data: OpenF1 /stints (CC BY-NC-SA 4.0)."

## Try it locally
```
python scripts/build_replay.py --race-id 1147        # Japan 2025 (needs the data/*.csv in the repo and network)
cd frontend && npm run dev                                   # then RACE -> REPLAY
```
The script writes to `frontend/public/replay-dev/` (git-ignored). In development the page reads `/replay-dev/` automatically.
Everything else (all 43): `python scripts/build_replay.py --all` (about 80 s a race, resumable).

## Hosting in production (Supabase Storage)
The page works without any of this: when `VITE_REPLAY_BASE_URL` is unset or unreachable it shows "Replay not available".
1. Supabase dashboard → **Storage → New bucket**: name **`replay`**, **Public bucket: on**, file size limit 5 MB, allowed MIME types left empty.
2. Upload the contents of `frontend/public/replay-dev/` (the 43 `*.json.gz` files, `manifest.json`, and for tyres the 42 `stints-<raceId>.json` files) to the root of the bucket. In the dashboard:
   open the bucket and drag the files in. With the CLI (linked project): `supabase storage cp -r frontend/public/replay-dev ss:///replay --experimental`.
   Set the content type of `manifest.json` to `application/json` and of the `.gz` files to `application/gzip`. Do **not** set `Content-Encoding: gzip`:
   the player inflates the files itself.
3. In Vercel (Production, and Preview if wanted) set **`VITE_REPLAY_BASE_URL`** to
   `https://ykpkieabxvipkyyynypr.supabase.co/storage/v1/object/public/replay/` and redeploy.
4. Check `https://ykpkieabxvipkyyynypr.supabase.co/storage/v1/object/public/replay/manifest.json` opens in a browser.

## Attribution and licence notes
- OpenF1's footer states CC BY-NC-SA 4.0, "intended solely for non-commercial analysis and fan engagement". Attribution is shown on the replay page.
- F1's own rights in the underlying timing data were not verified (OpenF1 says its data is aggregated from public sources and disclaims affiliation).
  FastF1 is not used: it needs an F1 account.
