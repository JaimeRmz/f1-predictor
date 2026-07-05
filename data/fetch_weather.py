"""
One-time script: fetch historical race-day weather from Open-Meteo's free
archive API (no key required) for every race from 2010 onwards, and save
precipitation summaries to data/race_weather.csv.

Resumable: raceIds already present in race_weather.csv are skipped, so the
script can be safely re-run (e.g. after a network error) without re-fetching
or duplicating rows.

Usage:
    python data/fetch_weather.py
"""
import csv
import os
import time

import pandas as pd
import requests

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
RACES_CSV = os.path.join(DATA_DIR, "races.csv")
CIRCUITS_CSV = os.path.join(DATA_DIR, "circuits.csv")
OUTPUT_CSV = os.path.join(DATA_DIR, "race_weather.csv")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
RACE_WINDOW_HOURS = {f"{h:02d}:00" for h in range(12, 18)}  # 12:00–17:00 local
WET_THRESHOLD_MM = 1.0
SLEEP_SECONDS = 0.15


def fetch_precipitation(lat, lng, date):
    """Sum precipitation (mm) for the local race window on `date` at (lat, lng)."""
    resp = requests.get(
        ARCHIVE_URL,
        params={
            "latitude": lat,
            "longitude": lng,
            "start_date": date,
            "end_date": date,
            "hourly": "precipitation",
            "timezone": "auto",
        },
        timeout=20,
    )
    resp.raise_for_status()
    payload = resp.json()
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    total = 0.0
    for t, p in zip(times, precip):
        # t looks like "2010-03-28T12:00" - keep only the HH:MM part
        clock = t.split("T")[1]
        if clock in RACE_WINDOW_HOURS and p is not None:
            total += p
    return round(total, 2)


def load_done_race_ids():
    if not os.path.exists(OUTPUT_CSV):
        return set()
    existing = pd.read_csv(OUTPUT_CSV)
    return set(existing["raceId"].tolist())


def main():
    races = pd.read_csv(RACES_CSV)
    circuits = pd.read_csv(CIRCUITS_CSV)[["circuitId", "lat", "lng"]]
    races = races[races["year"] >= 2010].merge(circuits, on="circuitId", how="left")
    races = races.sort_values(["year", "round"]).reset_index(drop=True)

    today = pd.Timestamp.today().strftime("%Y-%m-%d")
    races = races[races["date"] <= today]

    done = load_done_race_ids()
    todo = races[~races["raceId"].isin(done)]

    print(f"Total eligible races (2010+, up to {today}): {len(races)}")
    print(f"Already fetched: {len(done)}")
    print(f"Remaining to fetch: {len(todo)}")

    file_exists = os.path.exists(OUTPUT_CSV)
    fetched = 0
    wet_count = 0
    failed = []

    with open(OUTPUT_CSV, "a", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["raceId", "precipitation_mm", "wet_race"])

        for _, race in todo.iterrows():
            race_id = int(race["raceId"])
            try:
                mm = fetch_precipitation(race["lat"], race["lng"], race["date"])
                wet = 1 if mm > WET_THRESHOLD_MM else 0
                writer.writerow([race_id, mm, wet])
                f.flush()
                fetched += 1
                wet_count += wet
                print(f"  raceId={race_id} {race['year']} R{race['round']:>2} "
                      f"{race['name']:<28} precip={mm:>5.2f}mm wet={wet}")
            except requests.RequestException as e:
                print(f"  raceId={race_id} FAILED: {e}")
                failed.append(race_id)

            time.sleep(SLEEP_SECONDS)

    print()
    print(f"Fetched this run: {fetched}")
    if failed:
        print(f"Failed ({len(failed)}): {failed} — re-run the script to retry these.")

    if os.path.exists(OUTPUT_CSV):
        total = pd.read_csv(OUTPUT_CSV)
        wet_total = int(total["wet_race"].sum())
        pct = round(wet_total / len(total) * 100, 1) if len(total) else 0
        print(f"Total races in {OUTPUT_CSV}: {len(total)}")
        print(f"Total wet races: {wet_total} ({pct}%)")


if __name__ == "__main__":
    main()
