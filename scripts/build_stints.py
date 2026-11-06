#!/usr/bin/env python3
"""Write one small tyre-stint file per replay race: frontend/public/replay-dev/stints-<raceId>.json

    {"v": 1, "raceId": 1172, "source": "...", "stints": {"NOR": [["M", 1, 27], ["H", 28, 57]], ...}}

Each stint is [compound letter, first lap, last lap]; compound letters are S / M / H / I / W (soft, medium, hard, intermediate, wet).
A stint OpenF1 reports with an unknown compound is left out, so the player shows nothing for those laps rather than guessing.

Where the data comes from, in this order (the first source that has the race wins; nothing is fetched twice):
  1. data/openf1_strategy/<raceId>.json   (already in the repo; written by backend/scripts/fetch_openf1_strategy.py, keyed by driverRef)
  2. a local OpenF1 response cache (default analysis/cache/openf1/stints_*.json, matched by session_key), if present
  3. the OpenF1 /stints endpoint, at most 25 calls a minute (one call per race), cached in --cache-dir
Driver numbers are mapped to the three-letter codes used by the replay files, which are read from <dir>/<raceId>.json.gz. The replay files
are only READ, never changed.

    python scripts/build_stints.py                 # every race in the replay manifest
    python scripts/build_stints.py --race-id 1172  # one race
    python scripts/build_stints.py --offline       # never touch the network (races with no local source are reported as missing)

Stint data: OpenF1 (CC BY-NC-SA 4.0). Standalone: needs only `requests`; never touches the model, Supabase or backend/.
"""
import argparse
import glob
import gzip
import json
import os
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, ".."))
BASE = "https://api.openf1.org/v1"
MIN_INTERVAL = 2.4            # seconds between network calls => at most 25 a minute
LETTER = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}
SOURCE = "Tyre data: OpenF1 /stints (CC BY-NC-SA 4.0)."


def read_replay(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        j = json.load(f)
    return j["race"], {d["n"]: d["code"] for d in j["drivers"]}


def from_strategy(race_id, number_to_code):
    """Stints from data/openf1_strategy/<raceId>.json, keyed by driver number."""
    p = os.path.join(REPO, "data", "openf1_strategy", f"{race_id}.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        j = json.load(f)
    rows = []
    for d in j.get("drivers", {}).values():
        for s in d.get("stints", []):
            rows.append({"driver_number": d.get("driver_number"), **s})
    return rows or None


def from_cache(session_key, cache_dir):
    rows = {}
    for p in glob.glob(os.path.join(cache_dir, "stints_*.json")):
        try:
            with open(p, encoding="utf-8") as f:
                j = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(j, list) and j and j[0].get("session_key") == session_key:
            for r in j:
                rows[(r.get("driver_number"), r.get("stint_number"), r.get("lap_start"))] = r
    return list(rows.values()) or None


class Fetcher:
    def __init__(self):
        self.last = 0.0
        self.calls = 0

    def stints(self, session_key):
        for attempt in range(4):
            wait = MIN_INTERVAL - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.calls += 1
            try:
                r = requests.get(f"{BASE}/stints", params={"session_key": session_key}, timeout=60)
            except requests.RequestException as e:
                print(f"    network error ({e}); retrying", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code == 429:
                time.sleep(20 * (attempt + 1))
                continue
            if r.status_code == 404:
                return []
            r.raise_for_status()
            return r.json()
        return None


def to_stints(rows, number_to_code, laps):
    """rows -> {code: [[letter, lap_start, lap_end], ...]} sorted by lap, dropping unknown compounds and overlapping nonsense."""
    out = {}
    for r in rows:
        code = number_to_code.get(r.get("driver_number"))
        letter = LETTER.get(str(r.get("compound") or "").upper())
        a, b = r.get("lap_start"), r.get("lap_end")
        if code is None or letter is None or a is None:
            continue
        b = laps if b is None else min(b, laps)
        if b < a:
            continue
        out.setdefault(code, []).append([letter, int(a), int(b)])
    for code in out:
        out[code].sort(key=lambda s: s[1])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=os.path.join(REPO, "frontend", "public", "replay-dev"), help="replay folder (reads manifest + replay files, writes stints-*.json)")
    ap.add_argument("--race-id", type=int, nargs="*", help="only these races")
    ap.add_argument("--cache", default=os.path.join(REPO, "analysis", "cache", "openf1"), help="local OpenF1 response cache to reuse (stints_*.json)")
    ap.add_argument("--offline", action="store_true", help="never call the network")
    ap.add_argument("--report", default=os.path.join(REPO, "docs", "replay", "STINTS.md"), help="coverage table")
    args = ap.parse_args()

    with open(os.path.join(args.dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    races = [r for r in manifest["races"] if r.get("file") and (not args.race_id or r["raceId"] in args.race_id)]
    fetcher, table = Fetcher(), []
    for r in races:
        rid = r["raceId"]
        race, number_to_code = read_replay(os.path.join(args.dir, r["file"]))
        rows, src = from_strategy(rid, number_to_code), "repo strategy file"
        if rows is None and os.path.isdir(args.cache):
            rows, src = from_cache(race["session_key"], args.cache), "local OpenF1 cache"
        if rows is None and not args.offline:
            rows, src = fetcher.stints(race["session_key"]), "OpenF1 /stints (fetched)"
        stints = to_stints(rows or [], number_to_code, race["laps"])
        cars = len(number_to_code)
        table.append((rid, r["year"], r["round"], r["name"], len(stints), cars, src if rows else "none"))
        if stints:
            path = os.path.join(args.dir, f"stints-{rid}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"v": 1, "raceId": rid, "source": SOURCE, "stints": stints}, f, separators=(",", ":"))
            print(f"{rid} {r['name']} {r['year']}: {len(stints)}/{cars} cars ({src}), {os.path.getsize(path)} bytes")
        else:
            print(f"{rid} {r['name']} {r['year']}: NO STINT DATA ({'offline' if args.offline else 'none returned'})")

    if not args.race_id:
        lines = ["# Tyre stint coverage", "", "Generated by `scripts/build_stints.py`. Cars with stint data / cars in the replay file.", "",
                 "| raceId | year | rd | race | cars with stints | cars | coverage | source |", "|---|---|---|---|---|---|---|---|"]
        for rid, y, rd, name, k, n, src in table:
            lines.append(f"| {rid} | {y} | {rd} | {name} | {k} | {n} | {100 * k / n:.0f}% | {src} |")
        under = [t for t in table if t[5] and t[4] / t[5] < 0.9]
        lines += ["", f"Races under 90%: {', '.join(f'{t[3]} {t[1]} ({t[4]}/{t[5]})' for t in under) if under else 'none'}.", ""]
        os.makedirs(os.path.dirname(args.report), exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
    print(f"network calls: {fetcher.calls}")


if __name__ == "__main__":
    main()
