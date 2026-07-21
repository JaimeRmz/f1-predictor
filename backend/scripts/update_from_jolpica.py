#!/usr/bin/env python3
"""Fetch a completed F1 race from the Jolpica-F1 API (api.jolpi.ca, Ergast-
compatible, free, no auth) and append it to this repo's dataset in the exact
existing CSV format.

Usage:
  python update_from_jolpica.py --season 2026 --round 11   # append a real race
  python update_from_jolpica.py --validate                 # self-check vs the
                                                            # already-committed
                                                            # Belgian GP (2026 R10)

Design constraints (deliberate):
  * IDs are looked up from the repo CSVs, never taken from the API:
      - Driver.driverId  slug -> data/drivers.csv .driverRef      -> integer driverId
      - Constructor.constructorId slug -> data/constructors.csv .constructorRef
      - race identity   -> data/races.csv row for (year, round)   -> integer raceId
    An unmapped slug FAILS LOUDLY (see resolve_*), never silently skipped/guessed.
  * Standings are taken straight from the API's standings endpoints (cumulative,
    authoritative) rather than re-derived by hand.
  * Timing/lap-time detail (results time/millis/fastestLap*, qualifying Q1-Q3)
    is written as the '\\N' NULL placeholder to match every other 2026 row in
    this dataset (the models don't consume those columns). Jolpica DOES provide
    richer timing; we drop it on purpose for format consistency.
  * Does NOT touch data/f1_master.csv, backend/lookups.pkl, or retraining. That
    stays a separate, explicit step so a bad fetch can't cascade into a bad
    retrain.
"""
import argparse
import csv
import io
import os
import sys

import requests

BASE_URL = "https://api.jolpi.ca/ergast/f1"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "data"))
NULL = r"\N"  # the two-char Ergast NULL placeholder used throughout the CSVs

# Jolpica driver/constructor slugs that differ in spelling from this repo's
# refs. Explicit and auditable — anything not resolvable here or by an exact
# ref match raises (never a fuzzy guess).
DRIVER_SLUG_ALIASES = {"arvid_lindblad": "lindblad"}
CONSTRUCTOR_SLUG_ALIASES = {}

# Column order for each target CSV (asserted against the real header at runtime).
SCHEMAS = {
    "results.csv": ["resultId", "raceId", "driverId", "constructorId", "number",
                    "grid", "position", "positionText", "positionOrder", "points",
                    "laps", "time", "milliseconds", "fastestLap", "rank",
                    "fastestLapTime", "fastestLapSpeed", "statusId"],
    "qualifying.csv": ["qualifyId", "raceId", "driverId", "constructorId", "number",
                       "position", "q1", "q2", "q3"],
    "driver_standings.csv": ["driverStandingsId", "raceId", "driverId", "points",
                             "position", "positionText", "wins"],
    "constructor_standings.csv": ["constructorStandingsId", "raceId", "constructorId",
                                  "points", "position", "positionText", "wins"],
}
# Surrogate primary-key column (index 0) — assigned on append, ignored on validate.
ID_COL = {k: v[0] for k, v in SCHEMAS.items()}


class MappingError(Exception):
    """Raised when a slug/race can't be resolved against the repo CSVs."""


# ── tiny CSV helpers (raw text, so we never reformat existing rows) ──────────
def read_rows(fname):
    """Return (header, rows, eol, ends_nl). Parsed with the csv module so quoted
    fields (e.g. status.csv's "Finished") are unquoted and column-aligned; eol /
    trailing-newline come from the raw bytes so the append path can match them."""
    path = os.path.join(DATA_DIR, fname)
    with open(path, "rb") as f:
        raw = f.read()
    eol = "\r\n" if b"\r\n" in raw else "\n"
    text = raw.decode("utf-8")
    ends_nl = text.endswith("\n")
    reader = list(csv.reader(io.StringIO(text)))
    header = reader[0]
    rows = [r for r in reader[1:] if r]
    return header, rows, eol, ends_nl


def load_lookup(fname, key_col, val_col):
    header, rows, _, _ = read_rows(fname)
    ki, vi = header.index(key_col), header.index(val_col)
    out = {}
    for r in rows:
        out.setdefault(r[ki], r[vi])  # first occurrence wins (status.csv has dup text)
    return out


# The notebook's is_dnf feature (01_data_exploration.ipynb) treats exactly these
# status texts as a classified finish; everything else counts as a DNF. Kept in
# sync with that definition so validate can reason about DNF-equivalence.
FINISHED_STATUSES = {"Finished", "+1 Lap", "+2 Laps", "+3 Laps", "+4 Laps", "+5 Laps"}


# ── ID resolution (fail loud) ───────────────────────────────────────────────
_driver_ref_to_id = None
_constructor_ref_to_id = None
_status_text_to_id = None
_status_id_to_text = None
_misses = []


def _init_lookups():
    global _driver_ref_to_id, _constructor_ref_to_id, _status_text_to_id, _status_id_to_text
    _driver_ref_to_id = load_lookup("drivers.csv", "driverRef", "driverId")
    _constructor_ref_to_id = load_lookup("constructors.csv", "constructorRef", "constructorId")
    _status_text_to_id = load_lookup("status.csv", "status", "statusId")
    _status_id_to_text = load_lookup("status.csv", "statusId", "status")


def is_dnf(status_id):
    """1 if this statusId is a DNF, 0 if a classified finish — mirrors the
    notebook's is_dnf definition (status-text membership in FINISHED_STATUSES)."""
    return 0 if _status_id_to_text.get(str(status_id)) in FINISHED_STATUSES else 1


def resolve_driver(slug):
    ref = DRIVER_SLUG_ALIASES.get(slug, slug)
    if ref in _driver_ref_to_id:
        return _driver_ref_to_id[ref]
    _misses.append(f"driver slug '{slug}' (ref '{ref}') not in drivers.csv")
    return None


def resolve_constructor(slug):
    ref = CONSTRUCTOR_SLUG_ALIASES.get(slug, slug)
    if ref in _constructor_ref_to_id:
        return _constructor_ref_to_id[ref]
    _misses.append(f"constructor slug '{slug}' (ref '{ref}') not in constructors.csv")
    return None


def resolve_race_id(season, rnd):
    header, rows, _, _ = read_rows("races.csv")
    yi, ri, idi = header.index("year"), header.index("round"), header.index("raceId")
    hits = [r[idi] for r in rows if r[yi] == str(season) and r[ri] == str(rnd)]
    if len(hits) != 1:
        raise MappingError(
            f"expected exactly one races.csv row for year={season} round={rnd}, found {len(hits)}")
    return hits[0]


def status_id_for(status_text, laps, winner_laps):
    """Map Jolpica's coarse status model to a repo statusId.

    Jolpica collapses Ergast's detailed statuses: we see 'Finished', 'Lapped',
    'Retired'. 'Lapped' -> '+N Lap(s)' derived from the lap delta to the winner;
    everything else must match a status.csv row verbatim, else we fail loud
    (rather than invent a statusId)."""
    if status_text == "Lapped":
        n = winner_laps - int(laps)
        text = "+1 Lap" if n == 1 else f"+{n} Laps"
        if text not in _status_text_to_id:
            _misses.append(f"derived lap status '{text}' not in status.csv")
            return None
        return _status_text_to_id[text]
    if status_text in _status_text_to_id:
        return _status_text_to_id[status_text]
    _misses.append(f"status '{status_text}' not in status.csv")
    return None


# ── API fetch ───────────────────────────────────────────────────────────────
def fetch(season, rnd, endpoint):
    url = f"{BASE_URL}/{season}/{rnd}/{endpoint}.json"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()["MRData"]


def get_race(mrdata):
    races = mrdata["RaceTable"]["Races"]
    if len(races) != 1:
        raise MappingError(f"expected 1 race in response, got {len(races)}")
    return races[0]


# ── row builders (return dict keyed by column name; id column left None) ─────
def build_results(season, rnd, race_id):
    race = get_race(fetch(season, rnd, "results"))
    items = race["Results"]
    winner_laps = max(int(x["laps"]) for x in items)
    rows = []
    for x in items:
        ptext = x["positionText"]
        rows.append({
            "raceId": race_id,
            "driverId": resolve_driver(x["Driver"]["driverId"]),
            "constructorId": resolve_constructor(x["Constructor"]["constructorId"]),
            "number": x["number"],
            "grid": x["grid"],
            "position": ptext if ptext.isdigit() else NULL,
            "positionText": ptext,
            "positionOrder": x["position"],
            "points": x["points"],
            "laps": x["laps"],
            "time": NULL, "milliseconds": NULL, "fastestLap": NULL,
            "rank": NULL, "fastestLapTime": NULL, "fastestLapSpeed": NULL,
            "statusId": status_id_for(x["status"], x["laps"], winner_laps),
        })
    return rows


def build_qualifying(season, rnd, race_id):
    race = get_race(fetch(season, rnd, "qualifying"))
    rows = []
    for x in race["QualifyingResults"]:
        rows.append({
            "raceId": race_id,
            "driverId": resolve_driver(x["Driver"]["driverId"]),
            "constructorId": resolve_constructor(x["Constructor"]["constructorId"]),
            "number": x["number"],
            "position": x["position"],
            "q1": NULL, "q2": NULL, "q3": NULL,  # match 2026 dataset convention
        })
    return rows


def build_driver_standings(season, rnd, race_id):
    lst = fetch(season, rnd, "driverstandings")["StandingsTable"]["StandingsLists"]
    if not lst:
        raise MappingError("no driver standings returned")
    rows = []
    for x in lst[0]["DriverStandings"]:
        rows.append({
            "raceId": race_id,
            "driverId": resolve_driver(x["Driver"]["driverId"]),
            "points": x["points"],
            "position": x["position"],
            "positionText": x["positionText"],
            "wins": x["wins"],
        })
    return rows


def build_constructor_standings(season, rnd, race_id):
    lst = fetch(season, rnd, "constructorstandings")["StandingsTable"]["StandingsLists"]
    if not lst:
        raise MappingError("no constructor standings returned")
    rows = []
    for x in lst[0]["ConstructorStandings"]:
        rows.append({
            "raceId": race_id,
            "constructorId": resolve_constructor(x["Constructor"]["constructorId"]),
            "points": x["points"],
            "position": x["position"],
            "positionText": x["positionText"],
            "wins": x["wins"],
        })
    return rows


BUILDERS = {
    "results.csv": build_results,
    "qualifying.csv": build_qualifying,
    "driver_standings.csv": build_driver_standings,
    "constructor_standings.csv": build_constructor_standings,
}


def build_all(season, rnd, race_id):
    """Build rows for every target file, then raise if any slug/status missed."""
    _misses.clear()
    out = {fname: builder(season, rnd, race_id) for fname, builder in BUILDERS.items()}
    if _misses:
        raise MappingError("unresolved mappings (fix aliases or the CSVs, do not "
                           "guess):\n  - " + "\n  - ".join(dict.fromkeys(_misses)))
    return out


def assert_schema(fname):
    header, _, _, _ = read_rows(fname)
    if header != SCHEMAS[fname]:
        raise MappingError(f"{fname} header changed:\n  expected {SCHEMAS[fname]}\n  got      {header}")


def serialize(fname, row, surrogate_id):
    row = dict(row)
    row[ID_COL[fname]] = str(surrogate_id)
    return ",".join(str(row[c]) for c in SCHEMAS[fname])


# ── modes ───────────────────────────────────────────────────────────────────
def cmd_append(season, rnd):
    race_id = resolve_race_id(season, rnd)
    print(f"Resolved year={season} round={rnd} -> raceId {race_id}")
    for fname in SCHEMAS:
        assert_schema(fname)
        _, rows, _, _ = read_rows(fname)
        idi = 1  # raceId is column index 1 in every target file
        if any(r[idi] == str(race_id) for r in rows):
            raise MappingError(f"{fname} already has rows for raceId {race_id} — "
                               f"refusing to append duplicates")

    built = build_all(season, rnd, race_id)
    for fname, new_rows in built.items():
        header, rows, eol, ends_nl = read_rows(fname)
        next_id = max(int(r[0]) for r in rows) + 1
        lines = [serialize(fname, r, next_id + i) for i, r in enumerate(new_rows)]
        path = os.path.join(DATA_DIR, fname)
        with open(path, "ab") as f:
            prefix = "" if ends_nl else eol
            f.write((prefix + eol.join(lines) + eol).encode("utf-8"))
        print(f"  appended {len(lines)} rows to {fname} (ids {next_id}..{next_id+len(lines)-1})")
    print("\nDone. NOTE: f1_master.csv / lookups.pkl / model retraining are a "
          "separate, explicit step — not run here.")


def cmd_validate():
    """Build rows for the Belgian GP (2026 R10) and diff, field by field, against
    the already-committed rows for its raceId. Surrogate id columns are ignored
    (positional). Reports every mismatch; exit code 1 if any."""
    season, rnd = 2026, 10
    race_id = resolve_race_id(season, rnd)
    print(f"VALIDATE: 2026 round 10 (Belgian GP) -> raceId {race_id}")
    print("Comparing API-derived rows against committed CSV rows "
          "(ignoring surrogate id column).\n")
    built = build_all(season, rnd, race_id)

    total_mismatch = 0
    notes = []
    for fname, new_rows in built.items():
        header = SCHEMAS[fname]
        keyi = 2  # driverId / constructorId is column index 2 in every target file

        _, all_rows, _, _ = read_rows(fname)
        committed = {r[keyi]: r for r in all_rows if r[1] == str(race_id)}
        api = {}
        for r in new_rows:
            serialized = serialize(fname, r, 0).split(",")  # id placeholder ignored
            api[serialized[keyi]] = serialized

        keys_c, keys_a = set(committed), set(api)
        file_mismatch = 0
        for k in sorted(keys_c - keys_a):
            print(f"  [{fname}] key {k} present in CSV but not in API output"); file_mismatch += 1
        for k in sorted(keys_a - keys_c):
            print(f"  [{fname}] key {k} present in API output but not in CSV"); file_mismatch += 1
        for k in sorted(keys_c & keys_a):
            crow, arow = committed[k], api[k]
            for i, col in enumerate(header):
                if i == 0 or crow[i] == arow[i]:
                    continue
                # statusId is allowed to differ when both sides are DNFs: the API's
                # coarse status model (only Finished/Lapped/Retired) can't express
                # the finer Ergast reason (e.g. Collision) our data may carry, and
                # the models only consume is_dnf, not the exact statusId. General
                # rule (not a per-driver allowlist): equal is_dnf==1 -> informational.
                if col == "statusId" and is_dnf(crow[i]) == 1 and is_dnf(arow[i]) == 1:
                    notes.append(f"  [{fname}] {col_label(fname, k)} · statusId: "
                                 f"committed={crow[i]!r} api={arow[i]!r} "
                                 f"(both DNF / is_dnf=1 — accepted, not a mismatch)")
                    continue
                print(f"  [{fname}] {col_label(fname, k)} · {col}: "
                      f"committed={crow[i]!r}  api={arow[i]!r}")
                file_mismatch += 1
        tag = "OK" if file_mismatch == 0 else f"{file_mismatch} MISMATCH(ES)"
        print(f"  -> {fname}: {len(committed)} committed / {len(api)} api rows — {tag}\n")
        total_mismatch += file_mismatch

    if notes:
        print("Informational (DNF-equivalent statusId differences, not counted):")
        for n in notes:
            print(n)
        print()

    if total_mismatch == 0:
        print("VALIDATE PASSED — API-derived rows match committed Belgian GP "
              "(statusId differences that preserve is_dnf are accepted).")
        return 0
    print(f"VALIDATE FAILED — {total_mismatch} field mismatch(es). "
          "Investigate before trusting on an unchecked race.")
    return 1


def col_label(fname, key):
    kind = "constructorId" if fname == "constructor_standings.csv" else "driverId"
    return f"{kind}={key}"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, help="season year, e.g. 2026")
    ap.add_argument("--round", type=int, help="round number, e.g. 11")
    ap.add_argument("--validate", action="store_true",
                    help="self-check against the committed Belgian GP (2026 R10); writes nothing")
    args = ap.parse_args()

    _init_lookups()
    try:
        if args.validate:
            sys.exit(cmd_validate())
        if args.season is None or args.round is None:
            ap.error("provide --season and --round (or --validate)")
        cmd_append(args.season, args.round)
    except MappingError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
