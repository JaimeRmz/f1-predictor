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
  session   the session the cutoff is the start of (Qualifying | Sprint_Qualifying)
  cutoff    the real cutoff (start of the first graded session), ISO-8601 UTC
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

import season_data

# JOLPICA_BASE lets the offline tests point the scripts at a local stand-in; unset, it is the real Jolpica.
JOLPICA_BASE = os.environ.get("JOLPICA_BASE", "https://api.jolpi.ca/ergast/f1")
JOLPICA_SEASON_URL = JOLPICA_BASE + "/{season}.json?limit=100"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ykpkieabxvipkyyynypr.supabase.co")

# The races to consider are DERIVED from data/races.csv + results.csv
# (season_data.upcoming_races): a race with no result rows is upcoming. There is
# no per-race dict to edit after each round. A race that finished without a
# snapshot (1180, 1184-1187) has result rows, so it drops out of consideration
# on its own and is never retro-snapshotted; the MISSED alarm covers the
# window between the cutoff passing and the result rows being ingested.

# Our circuitRef -> Jolpica circuitId, where the two disagree. Verified against
# the live 2026 schedule on 2026-09-01; every other ref matches by identity.
CIRCUIT_ALIAS = {
    "madrid": "madring",
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


def _stamp(session):
    if not session or not session.get("date") or not session.get("time"):
        return None
    try:
        return datetime.fromisoformat(f"{session['date']}T{session['time']}".replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def cutoffs(season):
    """circuitId -> (raceName, cutoff, session) where cutoff is the start of the
    FIRST graded session of the weekend: Sprint Qualifying on a sprint weekend,
    otherwise Qualifying.

    Sprint-aware on purpose. The snapshot is the model's forecast made before any
    result of the weekend is known; on a sprint weekend the sprint (and its
    qualifying) happen BEFORE Saturday's qualifying, so freezing at GP
    qualifying would let the sprint outcome inform the pick. Taking the earlier
    session keeps it a true pre-weekend forecast. (No remaining 2026 round is a
    sprint, so today this equals the qualifying time.)"""
    r = requests.get(JOLPICA_SEASON_URL.format(season=season), timeout=30)
    if r.status_code != 200:
        die(f"Jolpica {season} schedule returned HTTP {r.status_code}")
    races = r.json()["MRData"]["RaceTable"]["Races"]
    if not races:
        die(f"Jolpica returned no races for {season}")
    out = {}
    for race in races:
        sessions = [(_stamp(race.get("SprintQualifying")), "Sprint Qualifying"),
                    (_stamp(race.get("Qualifying")), "Qualifying")]
        sessions = [(t, n) for t, n in sessions if t]
        if not sessions:
            continue  # no published slot yet; nothing to schedule against
        t, kind = min(sessions)
        out[race["Circuit"]["circuitId"]] = (race["raceName"], t, kind)
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
    ap.add_argument("--race-id", type=int,
                    help="forced/manual run: target this raceId regardless of the window, but still derive its "
                         "cutoff from Jolpica exactly as a scheduled run does (so cutoff_at is always recorded)")
    ap.add_argument("--next", action="store_true",
                    help="manual dry runs: ignore the window and target the soonest upcoming race "
                         "(even if already snapshotted) so the pipeline can be exercised any day")
    ap.add_argument("--now", help="override current time (ISO-8601 UTC), for testing")
    args = ap.parse_args()

    now = (datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(timezone.utc)
           if args.now else datetime.now(timezone.utc))

    if args.race_id:
        race = next((r for r in season_data.season_races(int(args.season)) if r["raceId"] == args.race_id), None)
        if not race:
            die(f"raceId {args.race_id} is not a {args.season} race in races.csv")
        entry = cutoffs(args.season).get(CIRCUIT_ALIAS.get(race["circuitRef"], race["circuitRef"]))
        if not entry:
            # Fail loudly: a forced snapshot with no recorded cutoff would be
            # unauditable (and immediately frozen once 00008 is applied).
            die(f"Jolpica has no published session slot for raceId {args.race_id} ({race['circuitRef']}); "
                "refusing to force a snapshot that cannot record its cutoff_at")
        name, cutoff, session = entry
        emit(action="write", race_id=args.race_id, name=name, session=session.replace(" ", "_"),
             cutoff=cutoff.isoformat().replace("+00:00", "Z"),
             hours=f"{(cutoff - now) / timedelta(hours=1):.1f}")
        return

    pub = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if not pub:
        die("SUPABASE_PUBLISHABLE_KEY is not set (public read key for model_snapshots)")

    sched = cutoffs(args.season)
    have = snapshotted_ids(pub)
    upcoming = season_data.upcoming_races(int(args.season))
    if not upcoming:
        print("note: no upcoming races in races.csv (season over?)", file=sys.stderr)

    due, missed = [], []
    for race in upcoming:
        race_id, ref = race["raceId"], race["circuitRef"]
        if race_id in have and not args.next:
            continue
        entry = sched.get(CIRCUIT_ALIAS.get(ref, ref))
        if not entry:
            # Loud, not silent: a race we know about but cannot schedule is
            # exactly how a cutoff gets missed unnoticed.
            print(f"warn: no Jolpica session slot for raceId {race_id} ({ref})", file=sys.stderr)
            continue
        name, cutoff, session = entry
        hours = (cutoff - now) / timedelta(hours=1)
        if args.next:
            if hours > 0:
                due.append((hours, race_id, name, cutoff, session))
        elif args.guard_hours <= hours <= args.lead_hours:
            due.append((hours, race_id, name, cutoff, session))
        elif -args.miss_hours <= hours < args.guard_hours:
            missed.append((hours, race_id, name, cutoff, session))

    # Soonest cutoff first, so a backlog is worked in deadline order.
    if due:
        hours, race_id, name, cutoff, session = min(due)
        emit(action="write", race_id=race_id, name=name, session=session.replace(" ", "_"),
             cutoff=cutoff.isoformat().replace("+00:00", "Z"), hours=f"{hours:.1f}")
    elif missed:
        hours, race_id, name, cutoff, session = min(missed)
        emit(action="missed", race_id=race_id, name=name, session=session.replace(" ", "_"),
             cutoff=cutoff.isoformat().replace("+00:00", "Z"), hours=f"{hours:.1f}")
    else:
        emit(action="none", race_id="", name="", session="", cutoff="", hours="")


if __name__ == "__main__":
    main()
