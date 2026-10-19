#!/usr/bin/env python3
"""Decide which race (if any) needs its model snapshot taken right now.

Exists so the scheduled workflow never hardcodes a "N days before the race"
heuristic. Real qualifying cutoffs are pulled from Jolpica -- the same source
update_from_jolpica.py already syncs race results from -- and matched to our
raceIds by CIRCUIT, never by round number. See CIRCUIT_ALIAS / the round note
below for why round arithmetic is not safe on the 2026 calendar.

Emits GitHub Actions outputs (to $GITHUB_OUTPUT when set, else stdout):

  action    write | missed | none
  race_id   the raceId to snapshot (write/missed)
  name      human-readable race name
  cutoff    the real qualifying cutoff, ISO-8601 UTC
  hours     signed hours from now to that cutoff (negative = already passed)

Exit status is always 0 unless something genuinely broke -- "nothing due" is a
normal outcome, not a failure.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

JOLPICA_SEASON_URL = "https://api.jolpi.ca/ergast/f1/{season}.json?limit=100"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ykpkieabxvipkyyynypr.supabase.co")

# raceId -> the circuitRef snapshot_model_pick.py uses for /whatif.
# Mirrors UPCOMING_CIRCUIT there; keep the two in step. 1181 (Italian GP),
# 1182 (Spanish GP) and 1183 (Azerbaijan GP) are completed and already
# snapshotted; 1184 (Bahrain GP in Malaysia) and 1185 (Singapore GP) are
# completed with NO snapshot (the workflow never ran successfully -- see the
# 2026-10-18 Actions audit) and are not getting a hindsight one. All five are
# dropped here the same way 1181/1182 were dropped from this dict before.
UPCOMING_CIRCUIT = {
    1186: "americas", 1187: "rodriguez", 1188: "interlagos",
    1189: "las_vegas", 1190: "losail", 1191: "yas_marina",
}

# Our circuitRef -> Jolpica circuitId, where the two disagree. Verified against
# the live 2026 schedule on 2026-09-01; every other ref matches by identity.
CIRCUIT_ALIAS = {
    "madrid": "madring",
    "las_vegas": "vegas",
}

# Round numbers: as of the raceId 1184 renumbering (2026-10-08), Bahrain
# Grand Prix in Malaysia (Sepang) was inserted as raceId 1184/round 16, with
# Singapore and every later 2026 race shifted up by one raceId and one round.
# Our round numbers now match Jolpica's official round numbers again.
# Matching is still done by CIRCUIT, not round -- see CIRCUIT_ALIAS above --
# so this stays immune to any further calendar revision, same as before.


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def quali_cutoffs(season):
    """circuitId -> (raceName, aware datetime of the qualifying start)."""
    r = requests.get(JOLPICA_SEASON_URL.format(season=season), timeout=30)
    if r.status_code != 200:
        die(f"Jolpica {season} schedule returned HTTP {r.status_code}")
    races = r.json()["MRData"]["RaceTable"]["Races"]
    if not races:
        die(f"Jolpica returned no races for {season}")
    out = {}
    for race in races:
        q = race.get("Qualifying")
        if not q or not q.get("date") or not q.get("time"):
            continue  # no published quali slot yet; nothing to schedule against
        stamp = f"{q['date']}T{q['time']}".replace("Z", "+00:00")
        try:
            out[race["Circuit"]["circuitId"]] = (
                race["raceName"],
                datetime.fromisoformat(stamp).astimezone(timezone.utc),
            )
        except ValueError:
            continue
    return out


def snapshotted_ids(key):
    """raceIds that already have a snapshot. Public read -- the publishable key
    is enough, and is what the site itself uses."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/model_snapshots",
        params={"select": "race_id"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=20,
    )
    if r.status_code != 200:
        die(f"reading model_snapshots failed: HTTP {r.status_code}: {r.text[:200]}")
    return {row["race_id"] for row in r.json()}


def emit(**fields):
    line = " ".join(f"{k}={v}" for k, v in fields.items())
    print(line)
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            for k, v in fields.items():
                fh.write(f"{k}={v}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", default="2026")
    ap.add_argument("--lead-hours", type=float, default=48.0,
                    help="start trying this many hours before the cutoff")
    ap.add_argument("--guard-hours", type=float, default=2.0,
                    help="stop trying this many hours before the cutoff")
    ap.add_argument("--miss-hours", type=float, default=72.0,
                    help="raise a missed alarm for this long after a cutoff passes")
    ap.add_argument("--now", help="override current time (ISO-8601 UTC), for testing")
    args = ap.parse_args()

    now = (datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(timezone.utc)
           if args.now else datetime.now(timezone.utc))

    pub = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if not pub:
        die("SUPABASE_PUBLISHABLE_KEY is not set (public read key for model_snapshots)")

    cutoffs = quali_cutoffs(args.season)
    have = snapshotted_ids(pub)

    due, missed = [], []
    for race_id, ref in sorted(UPCOMING_CIRCUIT.items()):
        if race_id in have:
            continue
        entry = cutoffs.get(CIRCUIT_ALIAS.get(ref, ref))
        if not entry:
            print(f"warn: no Jolpica quali slot for raceId {race_id} ({ref})", file=sys.stderr)
            continue
        name, cutoff = entry
        hours = (cutoff - now) / timedelta(hours=1)
        if args.guard_hours <= hours <= args.lead_hours:
            due.append((hours, race_id, name, cutoff))
        elif -args.miss_hours <= hours < args.guard_hours:
            missed.append((hours, race_id, name, cutoff))

    # Soonest cutoff first, so a backlog is worked in deadline order.
    if due:
        hours, race_id, name, cutoff = min(due)
        emit(action="write", race_id=race_id, name=name,
             cutoff=cutoff.isoformat().replace("+00:00", "Z"), hours=f"{hours:.1f}")
    elif missed:
        hours, race_id, name, cutoff = min(missed)
        emit(action="missed", race_id=race_id, name=name,
             cutoff=cutoff.isoformat().replace("+00:00", "Z"), hours=f"{hours:.1f}")
    else:
        emit(action="none", race_id="", name="", cutoff="", hours="")


if __name__ == "__main__":
    main()
