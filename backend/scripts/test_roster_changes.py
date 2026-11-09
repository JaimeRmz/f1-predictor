#!/usr/bin/env python3
"""Offline tests for entry-list corrections.   python backend/scripts/test_roster_changes.py

Nothing here names a race or a driver: the "next race" is the first race in the data with no result rows, the driver whose entry is
corrected is taken from the derived roster, and ENTRY_CHANGES is replaced by a fixture for the duration of the test. So the test keeps
working after every ingest, and never depends on the network.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import season_data as sd  # noqa: E402

n = 0


def check(name, got, want):
    global n
    assert got == want, f"{name}: got {got!r}, want {want!r}"
    n += 1
    print("  PASS", name)


SEASON = 2026
upcoming = sd.upcoming_races(SEASON)
assert upcoming, "no upcoming race in the data: nothing to test the entry list against"
NEXT = upcoming[0]["raceId"]
OTHER = NEXT + 1000                                     # a raceId no correction is keyed to

base = sd.roster(SEASON)
refs = [r for r, _ in base]
assert len(refs) >= 3, f"derived roster too short to test with: {refs}"
DROPPED, KEPT = refs[-1], refs[0]                       # the correction drops the last driver of the derived roster

real_changes = sd.ENTRY_CHANGES
sd.ENTRY_CHANGES = {NEXT: {"drop": [DROPPED]}}          # fixture: one correction, for the next race only
try:
    check("without a race id the roster is unchanged (the driver is in)", DROPPED in refs, True)

    r_next = sd.roster(SEASON, race_id=NEXT)
    refs_next = [r for r, _ in r_next]
    check("the corrected race drops the corrected driver", DROPPED in refs_next, False)
    check("the corrected race keeps another driver", KEPT in refs_next, True)
    check("the corrected race has one fewer driver", len(r_next), len(base) - 1)
    check("seed grids stay consecutive from 1", [g for _, g in r_next], list(range(1, len(r_next) + 1)))
    check("the remaining drivers keep their order", refs_next, [r for r in refs if r != DROPPED])
    check("a correction does not leak into another race", DROPPED in [r for r, _ in sd.roster(SEASON, race_id=OTHER)], True)
    check("an unknown raceId changes nothing", sd.roster(SEASON, race_id=999999), base)

    # the entry list the snapshot job sends: the roster plus each driver's constructor
    entries = sd.entry_list(SEASON, race_id=NEXT)
    check("entry_list is the corrected roster, in the same order", [e[0] for e in entries], refs_next)
    check("every entrant has a constructor", all(e[2] for e in entries), True)
    cons_of_kept = dict((e[0], e[2]) for e in entries)[KEPT]
    sd.ENTRY_CHANGES = {NEXT: {"drop": [DROPPED], "team": {KEPT: "brand_new_team"}}}
    check("a team change announced in ENTRY_CHANGES wins over the latest result row",
          dict((e[0], e[2]) for e in sd.entry_list(SEASON, race_id=NEXT))[KEPT], "brand_new_team")
    check("...and only for that race", dict((e[0], e[2]) for e in sd.entry_list(SEASON, race_id=OTHER))[KEPT], cons_of_kept)
finally:
    sd.ENTRY_CHANGES = real_changes

sent = [("antonelli", 1), ("rafael_camara", 2), ("russell", 3)]
got = [{"driverRef": "antonelli"}, {"driverRef": "russell"}]
check("a driver the model silently skipped is reported", sd.unpredicted(sent, got), ["rafael_camara"])
check("nothing is reported when every driver was predicted", sd.unpredicted(sent, got + [{"driverRef": "rafael_camara"}]), [])
print(f"{n} passed")
