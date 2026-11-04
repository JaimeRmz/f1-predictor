"""Season facts derived from the committed CSVs, for the snapshot scripts.

Replaces hand-maintained dicts (UPCOMING_CIRCUIT, UPCOMING_NAME, ROSTER) that had
to be edited after every race. Everything here is read from data/*.csv, which
update_from_jolpica.py keeps in step with Jolpica.

  upcoming_races(season)  races with no result rows yet, with the circuitRef the
                          model was trained on (circuits.csv, NOT a guess: the
                          Las Vegas ref is "vegas", and passing "las_vegas" to
                          /whatif silently zeroes the circuit-history feature).
  roster(season)          the entry list to predict with, see roster() below.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "data"))


def _rows(name):
    with open(os.path.join(DATA_DIR, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def season_races(season):
    circuits = {r["circuitId"]: r["circuitRef"] for r in _rows("circuits.csv")}
    out = []
    for r in _rows("races.csv"):
        if int(r["year"]) != int(season):
            continue
        out.append({
            "raceId": int(r["raceId"]),
            "round": int(r["round"]),
            "name": r["name"],
            "circuitRef": circuits[r["circuitId"]],
            "date": r["date"],
        })
    return sorted(out, key=lambda r: r["round"])


def _raced_ids():
    return {int(r["raceId"]) for r in _rows("results.csv")}


def upcoming_races(season):
    done = _raced_ids()
    return [r for r in season_races(season) if r["raceId"] not in done]


# One-off entry-list corrections for changes Jolpica has not published yet (it publishes no entry list before a race
# weekend, so roster() below can only look backwards). Keyed by raceId so a correction can never leak into a later race.
# "drop": driverRefs who are NOT racing that weekend. A driver with no history rows (a debutant) needs no entry here:
# the model cannot score him, and snapshot_model_pick.py now warns when a roster driver gets no prediction.
# Leave this empty unless the FIA entry list has been checked.
ENTRY_CHANGES = {
    1188: {"drop": ["ocon"]},   # Brazilian GP. ONLY if Haas has confirmed Ocon is out for this race.
}


def unpredicted(roster_pairs, records):
    """driverRefs that were sent to the model but got no prediction back. /whatif silently skips a driver with no
    history rows (HTTP 200, shorter list), so the caller has to compare the two lists to notice."""
    got = {r["driverRef"] for r in records}
    return [ref for ref, _ in roster_pairs if ref not in got]


def roster(season, window=3, min_appearances=2, race_id=None):
    """[(driverRef, seed_grid)] for the next race, ordered by current standings.

    Jolpica publishes no entry list before a race weekend, so the list is
    inferred: a driver who raced in at least `min_appearances` of the last
    `window` completed rounds. That keeps a mid-season swap (Lawson/Hadjar) once
    it has held for two rounds, and ignores a one-race substitute (Hirakawa
    covering Ocon at the Mexico City GP). It is an inference: if a team has
    announced a change, the rule lags it by up to `min_appearances` races.
    """
    races = [r for r in season_races(season) if r["raceId"] in _raced_ids()]
    last = [r["raceId"] for r in races[-window:]]
    drivers = {r["driverId"]: r["driverRef"] for r in _rows("drivers.csv")}
    seen = {}
    for r in _rows("results.csv"):
        if int(r["raceId"]) in last:
            seen.setdefault(r["driverId"], set()).add(int(r["raceId"]))
    keep = {d for d, ids in seen.items() if len(ids) >= min(min_appearances, len(last))}

    standings = {}
    for r in _rows("driver_standings.csv"):
        if int(r["raceId"]) == last[-1]:
            standings[r["driverId"]] = float(r["points"])
    ordered = sorted(keep, key=lambda d: (-standings.get(d, 0.0), int(d)))
    drop = set(ENTRY_CHANGES.get(race_id, {}).get("drop", ()))
    refs = [drivers[d] for d in ordered if drivers[d] not in drop]
    return [(ref, i + 1) for i, ref in enumerate(refs)]
