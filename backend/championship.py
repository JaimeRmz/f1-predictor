"""Championship status, derived from the committed Jolpica-sourced CSVs.

Nothing here is a hardcoded standing or a hardcoded champion: a title is
reported as clinched only when the arithmetic says so, using the standings the
ingest script wrote (data/driver_standings.csv, constructor_standings.csv) and
the calendar in data/races.csv.

Rules assumed (stated in the response under "rules" so the UI can show them):
  * a Grand Prix awards at most 25 points to a driver, a sprint at most 8;
  * no point for fastest lap (removed from 2025);
  * a constructor can score at most 25+18 = 43 in a race, 15 in a sprint;
  * a tie on points is NOT treated as clinched (countback is not modelled).
A change to the points system would need the constants below updated.
"""
import csv
import os
from functools import lru_cache

RACE_MAX = 25
SPRINT_MAX = 8
CONSTRUCTOR_RACE_MAX = 25 + 18
CONSTRUCTOR_SPRINT_MAX = 8 + 7

RULES = {
    "driver_race_max": RACE_MAX,
    "driver_sprint_max": SPRINT_MAX,
    "constructor_race_max": CONSTRUCTOR_RACE_MAX,
    "constructor_sprint_max": CONSTRUCTOR_SPRINT_MAX,
    "fastest_lap_point": False,
    "tie_counts_as_clinched": False,
}


def _rows(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _mtime_key(data_dir):
    names = ("races.csv", "driver_standings.csv", "constructor_standings.csv",
             "drivers.csv", "constructors.csv")
    return tuple(os.path.getmtime(os.path.join(data_dir, n)) for n in names)


def _clinch(totals_by_round, calendar, completed, race_max, sprint_max):
    """Walk the completed rounds in order and return the first one after which
    the leader's lead over EVERY other entry exceeds the points still available.

    totals_by_round: {round: {entry_id: points}}.
    calendar:        {round: {"sprint": bool, ...}} for the whole season.
    Returns (round, lead, max_available) or None."""
    for rnd in completed:
        pts = sorted(totals_by_round[rnd].values(), reverse=True)
        if len(pts) < 2:
            continue
        remaining = [r for r in calendar if r > rnd]
        max_avail = race_max * len(remaining) + sprint_max * sum(1 for r in remaining if calendar[r]["sprint"])
        lead = pts[0] - pts[1]
        if lead > max_avail:
            return rnd, lead, max_avail
    return None


def _status_for(kind, totals_by_round, names, calendar, completed, race_max, sprint_max, top_n):
    last = completed[-1]
    now = totals_by_round[last]
    order = sorted(now.items(), key=lambda kv: -kv[1])
    remaining = [r for r in calendar if r > last]
    n_sprints = sum(1 for r in remaining if calendar[r]["sprint"])
    max_avail = race_max * len(remaining) + sprint_max * n_sprints
    leader_id, leader_pts = order[0]
    runner_id, runner_pts = order[1]
    lead = leader_pts - runner_pts

    clinched_now = lead > max_avail
    clinch = _clinch(totals_by_round, calendar, completed, race_max, sprint_max)
    # A title clinched at round N stays clinched; report the FIRST such round.
    out = {
        "kind": kind,
        "clinched": bool(clinch) and clinched_now,
        "leader": {"id": leader_id, "name": names[leader_id], "points": leader_pts},
        "runner_up": {"id": runner_id, "name": names[runner_id], "points": runner_pts},
        "points_gap": lead,
        "max_points_available": max_avail,
        "surplus": lead - max_avail,  # > 0 means clinched
        "remaining_races": len(remaining),
        "remaining_sprints": n_sprints,
        "clinched_at": None,
        "contenders": [],
    }
    if out["clinched"]:
        rnd, c_lead, c_avail = clinch
        out["clinched_at"] = {
            "round": rnd,
            "race": calendar[rnd]["name"],
            "raceId": calendar[rnd]["raceId"],
            "lead": c_lead,
            "max_points_available": c_avail,
            "margin": c_lead - c_avail,
        }
    for pos, (eid, pts) in enumerate(order[:top_n], start=1):
        reach = pts + max_avail
        out["contenders"].append({
            "position": pos,
            "id": eid,
            "name": names[eid],
            "points": pts,
            "gap_to_leader": pts - leader_pts,
            "max_reachable": reach,
            # Can still finish ahead of the leader if the leader scores nothing
            # and this entry scores everything. Equal totals are not "ahead".
            "mathematically_alive": pos == 1 or reach > leader_pts,
        })
    return out


@lru_cache(maxsize=4)
def _compute(data_dir, season, key):  # `key` busts the cache when a CSV changes
    races = [r for r in _rows(os.path.join(data_dir, "races.csv")) if int(r["year"]) == season]
    if not races:
        return {"season": season, "error": f"no races for {season} in races.csv"}
    calendar = {
        int(r["round"]): {
            "raceId": int(r["raceId"]),
            "name": r["name"],
            "date": r["date"],
            "sprint": r.get("sprint_date", r"\N") not in (r"\N", ""),
        }
        for r in races
    }
    race_round = {v["raceId"]: k for k, v in calendar.items()}

    drivers = {r["driverId"]: f'{r["forename"]} {r["surname"]}' for r in _rows(os.path.join(data_dir, "drivers.csv"))}
    constructors = {r["constructorId"]: r["name"] for r in _rows(os.path.join(data_dir, "constructors.csv"))}

    d_by_round, c_by_round = {}, {}
    for r in _rows(os.path.join(data_dir, "driver_standings.csv")):
        rnd = race_round.get(int(r["raceId"]))
        if rnd is not None:
            d_by_round.setdefault(rnd, {})[r["driverId"]] = float(r["points"])
    for r in _rows(os.path.join(data_dir, "constructor_standings.csv")):
        rnd = race_round.get(int(r["raceId"]))
        if rnd is not None:
            c_by_round.setdefault(rnd, {})[r["constructorId"]] = float(r["points"])

    completed = sorted(d_by_round)
    if not completed:
        return {"season": season, "error": "no standings ingested yet"}
    # Fail loudly rather than report a champion off a partial ingest: the
    # completed rounds must be a gapless prefix of the calendar.
    expected = list(range(1, completed[-1] + 1))
    if completed != expected:
        return {"season": season, "error": f"standings rounds are not contiguous: have {completed}, expected {expected}"}

    last = completed[-1]
    return {
        "season": season,
        "as_of": {"round": last, "race": calendar[last]["name"], "raceId": calendar[last]["raceId"],
                  "date": calendar[last]["date"]},
        "total_rounds": len(calendar),
        "rules": RULES,
        "drivers": _status_for("drivers", d_by_round, drivers, calendar, completed, RACE_MAX, SPRINT_MAX, 10),
        "constructors": _status_for("constructors", c_by_round, constructors, calendar,
                                    sorted(c_by_round), CONSTRUCTOR_RACE_MAX, CONSTRUCTOR_SPRINT_MAX, 10),
    }


def championship_status(data_dir, season=2026):
    return _compute(os.path.abspath(data_dir), season, _mtime_key(data_dir))
