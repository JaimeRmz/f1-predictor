#!/usr/bin/env python3
"""Fetch and cache per-race strategy telemetry from OpenF1 (pit stops, tyre
stints, and a lap-by-lap position table) for the 2026 completed races, keyed to
this repo's raceId / driverRef.

Pipeline per race:
  1. Resolve OpenF1 meeting_key + race session_key from races.csv (year + circuit
     country + date). The mapping is printed for a manual sanity check.
  2. Map OpenF1 driver_number -> driverRef. NOTE: we resolve via /drivers' NAME
     fields (matched to drivers.csv forename+surname), NOT the drivers.csv
     `number` column, because that column holds each driver's *career* number and
     is stale for 2026 (champion runs #1, Bearman #87, etc.) — verified against
     the Belgian GP where the number column mismaps 3 drivers.
  3. Fetch /pit, /stints, /laps, /position and build, per driver, a lap-by-lap
     position table by forward-filling the (event-based) /position stream to each
     lap's crossing time — NOT a naive nearest-timestamp match.
  4. Validate: the last-lap order must match results.csv's classified finishers.

Usage:
  python fetch_openf1_strategy.py --race-id 1178              # one race (+validate)
  python fetch_openf1_strategy.py --race-id 1178 --resolve-only
  python fetch_openf1_strategy.py --all                       # all 10 completed
Output: data/openf1_strategy/{raceId}.json
"""
import argparse
import bisect
import csv
import json
import os
import sys
import time
import unicodedata
from datetime import datetime

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "data"))
OUT_DIR = os.path.join(DATA, "openf1_strategy")
OF1 = "https://api.openf1.org/v1"

# Completed 2026 rounds (mirror of the frontend's COMPLETED_2026).
COMPLETED_IDS = list(range(1169, 1179))  # 1169..1178

# circuits.csv abbreviates some countries differently from OpenF1's country_name.
COUNTRY_ALIAS = {
    "usa": "united states", "uk": "united kingdom", "uae": "united arab emirates",
}


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def norm(s):
    """Lowercase + strip accents, for robust name matching."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().lower()


# ── OpenF1 HTTP with light retry (public API can 429 / hiccup) ──
def of1_get(path, **params):
    url = f"{OF1}/{path}"
    for attempt in range(7):
        try:
            r = requests.get(url, params=params, timeout=60)
            if r.status_code == 200:
                time.sleep(0.4)  # politeness — stay under OpenF1's rate limit
                return r.json()
            if r.status_code in (429, 500, 502, 503):
                time.sleep(3 * (attempt + 1))
                continue
            die(f"{url} params={params} -> HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:
            if attempt == 6:
                die(f"{url} params={params} failed: {e}")
            time.sleep(3 * (attempt + 1))
    die(f"{url} params={params}: exhausted retries")


# ── repo CSV loads ──
def load_csv(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_races():
    return {r["raceId"]: r for r in load_csv("races.csv")}


def load_circuits():
    return {c["circuitId"]: c for c in load_csv("circuits.csv")}


def load_drivers():
    """driverRef records + a (forename,surname)->driverRef index for name matching."""
    rows = load_csv("drivers.csv")
    by_name = {}  # (norm forename, norm surname) -> [driverRef,...]
    by_ref = {}
    for r in rows:
        by_ref[r["driverRef"]] = r
        by_name.setdefault((norm(r["forename"]), norm(r["surname"])), []).append(r["driverRef"])
    return rows, by_name, by_ref


# ── date helpers ──
def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        # OpenF1 sometimes omits the offset; assume UTC.
        return datetime.fromisoformat(s + "+00:00").timestamp()


# ── step 1: resolve meeting + race session ──
def resolve_session(race, circuit):
    year = race["year"]
    country = circuit["country"]           # e.g. "Belgium"
    race_date = race["date"]               # "2026-07-19"
    race_epoch = parse_iso(race_date + "T00:00:00+00:00")

    meetings = of1_get("meetings", year=year)
    # Filter to the right country, then (for multi-race countries, e.g. 3 US
    # rounds) pick the meeting whose start date is closest to this race's date.
    target = COUNTRY_ALIAS.get(norm(country), norm(country))
    cands = [m for m in meetings if norm(m.get("country_name")) == target]
    if not cands:
        die(f"no OpenF1 meeting in {year} matched country '{country}' (as '{target}')")
    cands.sort(key=lambda m: abs((parse_iso(m["date_start"]) or 0) - race_epoch))
    meeting = cands[0]
    days_off = abs((parse_iso(meeting["date_start"]) or 0) - race_epoch) / 86400

    sessions = of1_get("sessions", meeting_key=meeting["meeting_key"], session_name="Race")
    if not sessions:
        die(f"no Race session for meeting {meeting['meeting_key']} ({meeting['meeting_name']})")
    session = sessions[0]
    return meeting, session, days_off


def print_mapping(race_id, race, circuit, meeting, session, days_off):
    print(f"\n{'='*72}")
    print(f"raceId {race_id}: {race['name']} ({race['year']} round {race['round']})")
    print(f"  repo circuit : {circuit['circuitRef']} / {circuit['name']} / {circuit['country']}")
    print(f"  repo date    : {race['date']}")
    print(f"  -> OpenF1 meeting_key {meeting['meeting_key']}: {meeting['meeting_name']} "
          f"@ {meeting['circuit_short_name']} ({meeting['country_name']})")
    print(f"     meeting start {meeting['date_start']}  (Δ{days_off:.1f}d from race date)")
    print(f"  -> OpenF1 session_key {session['session_key']}: {session['session_name']} "
          f"start {session['date_start']}")
    if days_off > 4:
        print(f"  !! WARNING: matched meeting is {days_off:.1f} days from the race date — verify it's correct")


# ── step 2: driver_number -> driverRef via OpenF1 /drivers names ──
def build_driver_map(session_key, by_name, by_ref):
    of1_drivers = of1_get("drivers", session_key=session_key)
    num_to_ref = {}
    unresolved = []
    for d in of1_drivers:
        num = d.get("driver_number")
        first, last = norm(d.get("first_name")), norm(d.get("last_name"))
        refs = by_name.get((first, last))
        if not refs:
            # surname-only fallback, disambiguated by career number if possible
            surname_hits = [ref for (fn, sn), rs in by_name.items() if sn == last for ref in rs]
            if len(surname_hits) == 1:
                refs = surname_hits
            elif surname_hits:
                refs = [r for r in surname_hits if by_ref[r].get("number") not in ("", "\\N")
                        and str(by_ref[r]["number"]) == str(num)] or surname_hits
        if refs:
            num_to_ref[num] = refs[0]
        else:
            unresolved.append((num, d.get("full_name")))
    if unresolved:
        print(f"  !! unresolved OpenF1 drivers (number, name): {unresolved}")
    return num_to_ref


# ── step 3: lap-by-lap position via forward-fill of the /position stream ──
def build_position_series(position_rows):
    """Per driver_number: sorted [(epoch, position)] event list + a lookup that
    forward-fills to a query time (position held AS OF t = last event with ts<=t).
    Event-based, so nearest-timestamp would be WRONG — must step backward."""
    series = {}
    for p in position_rows:
        dn, pos, ts = p.get("driver_number"), p.get("position"), parse_iso(p.get("date"))
        if dn is None or pos is None or ts is None:
            continue
        series.setdefault(dn, []).append((ts, pos))
    for dn in series:
        series[dn].sort(key=lambda x: x[0])
    return series


def position_asof(events, t):
    """Position held at time t: the last event at or before t (step function).
    t=None/inf => the final event (finishing state)."""
    if not events:
        return None
    if t is None:
        return events[-1][1]
    times = [e[0] for e in events]
    i = bisect.bisect_right(times, t)
    if i == 0:
        return events[0][1]  # before first recorded event: assume its position
    return events[i - 1][1]


def checkered_time(laps_rows):
    """Wall-clock time the WINNER completes the final race lap. Used to stop the
    /position forward-fill at the flag — OpenF1 keeps emitting position events on
    the post-race cool-down/in-lap, which would otherwise corrupt the last lap."""
    if not laps_rows:
        return None
    max_lap = max((l.get("lap_number") or 0) for l in laps_rows)
    by = {}
    for l in laps_rows:
        by.setdefault(l["driver_number"], []).append(l)
    finishes = []
    for laps in by.values():
        dmax = max((l.get("lap_number") or 0) for l in laps)
        if dmax != max_lap:
            continue  # lapped car, didn't complete the final race lap
        final = next(l for l in laps if (l.get("lap_number") or 0) == dmax)
        st, dur = parse_iso(final.get("date_start")), final.get("lap_duration")
        if st is not None and dur:
            finishes.append(st + dur)
    return min(finishes) if finishes else None


def build_lap_positions(laps_rows, series, checkered_t=None):
    """Per driver_number: [{lap, position, lap_duration}] where `position` is the
    order at the END of that lap (forward-filled to the driver's crossing time
    completing the lap = the START of their next lap), never sampling past the
    checkered flag. The final classified order is anchored separately by the
    caller (via /session_result), since /position can be sparse/gappy."""
    by_driver = {}
    for lp in laps_rows:
        by_driver.setdefault(lp["driver_number"], []).append(lp)

    out = {}
    for dn, laps in by_driver.items():
        laps.sort(key=lambda x: x.get("lap_number") or 0)
        # Compute a start epoch per lap; if date_start is null, derive from the
        # previous lap's start + duration so we don't silently drop laps.
        start = {}
        prev_epoch = None
        for lp in laps:
            ln = lp.get("lap_number")
            e = parse_iso(lp.get("date_start"))
            if e is None and prev_epoch is not None and laps[0].get("lap_duration"):
                e = prev_epoch  # best effort; refined below via duration
            start[ln] = e
            prev_epoch = e if e is not None else prev_epoch

        events = series.get(dn, [])
        rows = []
        for idx, lp in enumerate(laps):
            ln = lp.get("lap_number")
            # crossing time completing THIS lap = start of the next lap; for the
            # last lap, use None so position_asof returns the final event.
            nxt = laps[idx + 1] if idx + 1 < len(laps) else None
            end_t = parse_iso(nxt.get("date_start")) if nxt else None
            if nxt and end_t is None:
                # next lap's start unknown -> approximate via this lap's start+duration
                st = start.get(ln)
                dur = lp.get("lap_duration")
                end_t = (st + dur) if (st is not None and dur) else None
            # Never sample past the flag: the final lap (end_t is None) resolves to
            # the checkered time, and any lap whose crossing is later is capped.
            if checkered_t is not None:
                end_t = checkered_t if end_t is None else min(end_t, checkered_t)
            pos = position_asof(events, end_t)
            if pos is not None:
                rows.append({"lap": ln, "position": pos, "lap_duration": lp.get("lap_duration")})
        out[dn] = rows
    return out


# ── assembling one race ──
def fetch_race(race_id, races, circuits, by_name, by_ref, id_to_ref, resolve_only=False):
    race = races.get(str(race_id))
    if not race:
        die(f"raceId {race_id} not in races.csv")
    circuit = circuits[race["circuitId"]]
    meeting, session, days_off = resolve_session(race, circuit)
    print_mapping(race_id, race, circuit, meeting, session, days_off)
    if resolve_only:
        return None

    sk = session["session_key"]
    num_to_ref = build_driver_map(sk, by_name, by_ref)

    pit_rows = of1_get("pit", session_key=sk)
    stint_rows = of1_get("stints", session_key=sk)
    lap_rows = of1_get("laps", session_key=sk)
    pos_rows = of1_get("position", session_key=sk)
    print(f"  fetched: {len(pit_rows)} pit, {len(stint_rows)} stint, "
          f"{len(lap_rows)} lap, {len(pos_rows)} position rows")

    # Authoritative classified finish comes from THIS repo's results.csv (Jolpica,
    # penalty-adjusted) — not OpenF1's /session_result, which shows on-track order
    # and diverges by a few spots when post-race penalties are applied (Miami,
    # Barcelona). results.csv is the ground truth the chart is validated against.
    classified = {}  # ref -> (positionOrder, is_finisher)
    for order, ref, is_fin in load_results(race_id, id_to_ref):
        classified[ref] = (order, is_fin)

    checkered_t = checkered_time(lap_rows)
    series = build_position_series(pos_rows)
    lap_pos = build_lap_positions(lap_rows, series, checkered_t)

    # group pit/stints by driver_number
    pits_by = {}
    for p in pit_rows:
        pits_by.setdefault(p["driver_number"], []).append(
            {"lap": p.get("lap_number"), "duration": p.get("pit_duration")})
    stints_by = {}
    for s in stint_rows:
        stints_by.setdefault(s["driver_number"], []).append({
            "compound": s.get("compound"),
            "lap_start": s.get("lap_start"),
            "lap_end": s.get("lap_end"),
            "tyre_age_start": s.get("tyre_age_at_start"),
            "stint_number": s.get("stint_number"),
        })

    drivers_out = {}
    pre_match = finishers = 0
    for dn, ref in num_to_ref.items():
        laps = lap_pos.get(dn, [])
        result_pos, is_fin = classified.get(ref, (None, False))
        # Anchor the final chart point to the authoritative classified position:
        # /position's last on-track sample can be gappy (a late, unrecorded drop)
        # or reflect the pre-penalty order.
        if laps and result_pos is not None and is_fin:
            finishers += 1
            if laps[-1]["position"] == result_pos:
                pre_match += 1          # on-track order already agreed before anchoring
            laps[-1] = {**laps[-1], "position": result_pos}
        drivers_out[ref] = {
            "driver_number": dn,
            "result_position": result_pos,
            "dnf": not is_fin,
            "pits": sorted(pits_by.get(dn, []), key=lambda x: x["lap"] or 0),
            "stints": sorted(stints_by.get(dn, []), key=lambda x: x["stint_number"] or 0),
            "laps": laps,
        }
    print(f"  on-track last lap agreed with classified for {pre_match}/{finishers} finishers "
          f"before anchoring (residual = OpenF1 /position gaps)")

    return {
        "raceId": race_id,
        "meeting_key": meeting["meeting_key"],
        "session_key": sk,
        "circuit": circuit["circuitRef"],
        "date": race["date"],
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "drivers": drivers_out,
    }


# ── step 4: validate last-lap order vs results.csv ──
def load_results(race_id, id_to_ref):
    """Classified order from results.csv: [(positionOrder, driverRef, is_finisher)]."""
    out = []
    with open(os.path.join(DATA, "results.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["raceId"] == str(race_id):
                # positionText is numeric for classified finishers, letter (R/D/W/N) for DNF/DNS
                is_fin = row["positionText"].isdigit()
                out.append((int(row["positionOrder"]), id_to_ref.get(row["driverId"], row["driverId"]), is_fin))
    out.sort()
    return out


def validate(cache, race_id, id_to_ref):
    """Per-driver check: each classified finisher's last-lap position (in the
    cached chart) must equal their results.csv positionOrder. Per-driver — not a
    re-sort of everyone — so DNFs' on-track positions can't shuffle finisher
    slots. DNFs are reported but not asserted (their last recorded lap is where
    they retired, which legitimately differs from the classified order)."""
    results = load_results(race_id, id_to_ref)
    last_pos = {ref: d["laps"][-1]["position"] for ref, d in cache["drivers"].items() if d["laps"]}

    print(f"\n  VALIDATION — chart last-lap position vs results.csv (raceId {race_id})")
    print(f"  {'Pos':>3}  {'driver':<18} {'chart last-lap':>14}  {'':<4}")
    print(f"  {'-'*45}")
    mism = checked = 0
    for order, ref, is_fin in results:
        my = last_pos.get(ref)
        if is_fin:
            checked += 1
            ok = (my == order)
            if not ok:
                mism += 1
            tag = "OK" if ok else "XX"
        else:
            tag = "dnf"
        print(f"  {order:>3}  {ref:<18} {str(my) if my is not None else '—':>14}  {tag}")
    print(f"\n  finishers checked: {checked}, mismatches: {mism}")
    return mism == 0


def write_cache(cache, race_id):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{race_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    print(f"  wrote {os.path.relpath(path, os.path.join(HERE, '..', '..'))}")


def main():
    ap = argparse.ArgumentParser(description="Fetch OpenF1 strategy telemetry per race.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--race-id", type=int, help="single raceId")
    g.add_argument("--all", action="store_true", help="all 10 completed 2026 races")
    ap.add_argument("--resolve-only", action="store_true", help="print meeting/session mapping only, no fetch")
    args = ap.parse_args()

    races, circuits = load_races(), load_circuits()
    _, by_name, by_ref = load_drivers()
    id_to_ref = {r["driverId"]: r["driverRef"] for r in load_csv("drivers.csv")}

    ids = COMPLETED_IDS if args.all else [args.race_id]
    all_ok = True
    for rid in ids:
        cache = fetch_race(rid, races, circuits, by_name, by_ref, id_to_ref, resolve_only=args.resolve_only)
        if cache is None:
            continue
        ok = validate(cache, rid, id_to_ref)
        all_ok = all_ok and ok
        write_cache(cache, rid)
        time.sleep(1)  # be polite to OpenF1

    if not args.resolve_only and not all_ok:
        print("\nSome races had finisher mismatches — review before trusting the data.")
        sys.exit(2)


if __name__ == "__main__":
    main()
