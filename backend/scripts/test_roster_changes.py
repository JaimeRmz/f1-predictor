#!/usr/bin/env python3
"""Offline tests for entry-list corrections.   python backend/scripts/test_roster_changes.py"""
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


base = sd.roster(2026)
refs = [r for r, _ in base]
check("without a race id the roster is unchanged (Ocon is in)", "ocon" in refs, True)

r1188 = sd.roster(2026, race_id=1188)
refs1188 = [r for r, _ in r1188]
check("race 1188 drops the corrected driver", "ocon" in refs1188, False)
check("race 1188 keeps his team-mate", "bearman" in refs1188, True)
check("race 1188 has one fewer driver", len(r1188), len(base) - 1)
check("seed grids stay consecutive from 1", [g for _, g in r1188], list(range(1, len(r1188) + 1)))
check("still enough drivers for the >=20 safety check", len(r1188) >= 20, True)
check("a correction does not leak into the next race", "ocon" in [r for r, _ in sd.roster(2026, race_id=1189)], True)
check("an unknown raceId changes nothing", sd.roster(2026, race_id=999999), base)

sent = [("antonelli", 1), ("rafael_camara", 2), ("russell", 3)]
got = [{"driverRef": "antonelli"}, {"driverRef": "russell"}]
check("a driver the model silently skipped is reported", sd.unpredicted(sent, got), ["rafael_camara"])
check("nothing is reported when every driver was predicted", sd.unpredicted(sent, got + [{"driverRef": "rafael_camara"}]), [])
print(f"{n} passed")
