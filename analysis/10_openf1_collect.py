#!/usr/bin/env python3
"""Collect pre-qualifying signals from OpenF1 (historical, free, no auth) for the 43
backtest races (2025 + 2026 R1-19) and write one small feature table.

Signals available BEFORE qualifying starts:
  fp1/fp2/fp3 best lap, as a ratio to that session's fastest lap (1.000 = fastest)
  fp2 and fp3 "long run" pace: for each stint of >= 5 laps, median of the clean laps
      (stint's out lap and in lap excluded, pit-out laps excluded); the driver's best
      stint median as a ratio to the session's best -- crude: no fuel or compound correction
  sq_position: Sprint Qualifying result (sprint weekends only)
No qualifying, sprint or race data is read for the weekend being predicted, except
Sprint Qualifying, which precedes Saturday's qualifying.

Cached + rate-limited via openf1_client.py (restartable). Writes
analysis/out/openf1_features.csv and openf1_coverage.json.
Run: python analysis/10_openf1_collect.py
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import openf1_client as o  # noqa: E402

REPO = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(REPO, "analysis", "out")
NA = chr(92) + "N"

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
races = pd.read_csv(os.path.join(REPO, "data", "races.csv"))
drivers_csv = pd.read_csv(os.path.join(REPO, "data", "drivers.csv"))
code_of = dict(zip(drivers_csv.driverRef, drivers_csv.code))

target = (master[(master.year == 2025) | (master.year == 2026)][["raceId", "year", "round"]]
          .drop_duplicates().merge(races[["raceId", "date", "name"]], on="raceId").sort_values(["year", "round"]))
print(f"{len(target)} target races")

sessions_by_year = {y: o.get("sessions", year=y) for y in (2025, 2026)}


def find_meeting(year, date):
    race_sessions = [s for s in sessions_by_year[year] if s["session_name"] == "Race"]
    d = pd.Timestamp(date).date()
    c = [s for s in race_sessions if abs((pd.Timestamp(s["date_start"]).date() - d).days) <= 1 and not s.get("is_cancelled")]
    if len(c) != 1:
        return None
    return c[0]["meeting_key"]


def clean_laps(laps):
    df = pd.DataFrame(laps)
    if df.empty or "lap_duration" not in df:
        return pd.DataFrame(columns=["driver_number", "lap_number", "lap_duration", "is_pit_out_lap"])
    df = df[df.lap_duration.notna()].copy()
    df["is_pit_out_lap"] = df.get("is_pit_out_lap", False).fillna(False).astype(bool)
    return df[["driver_number", "lap_number", "lap_duration", "is_pit_out_lap"]]


def best_lap_ratio(laps):
    df = clean_laps(laps)
    df = df[~df.is_pit_out_lap]
    if df.empty:
        return {}
    best = df.groupby("driver_number").lap_duration.min()
    return (best / best.min()).to_dict()


def long_run_ratio(laps, stints):
    df, st = clean_laps(laps), pd.DataFrame(stints)
    if df.empty or st.empty:
        return {}
    med = {}
    for r in st.itertuples():
        if pd.isna(r.lap_start) or pd.isna(r.lap_end) or (r.lap_end - r.lap_start + 1) < 5:
            continue
        seg = df[(df.driver_number == r.driver_number) & (df.lap_number > r.lap_start) & (df.lap_number < r.lap_end) & (~df.is_pit_out_lap)]
        if len(seg) < 4:
            continue
        cut = seg.lap_duration.median() * 1.07  # drop traffic / cool-down laps
        seg = seg[seg.lap_duration <= cut]
        if len(seg) >= 4:
            med[r.driver_number] = min(med.get(r.driver_number, 1e9), float(seg.lap_duration.median()))
    if not med:
        return {}
    b = min(med.values())
    return {k: v / b for k, v in med.items()}


rows, coverage = [], []
for t in target.itertuples():
    mk = find_meeting(t.year, t.date)
    cov = dict(raceId=int(t.raceId), year=int(t.year), round=int(t.round), name=t.name, meeting_key=mk)
    if mk is None:
        cov["error"] = "no unique OpenF1 meeting for this race date"
        coverage.append(cov); continue
    sess = {s["session_name"]: s["session_key"] for s in sessions_by_year[t.year] if s["meeting_key"] == mk}
    cov["sessions"] = sorted(sess)
    drv = o.get("drivers", session_key=sess["Race"])
    acr = {d["driver_number"]: d["name_acronym"] for d in drv}
    feats = {}  # driver_number -> dict
    for name, tag in (("Practice 1", "fp1"), ("Practice 2", "fp2"), ("Practice 3", "fp3")):
        if name not in sess:
            continue
        laps = o.get("laps", session_key=sess[name])
        cov[f"{tag}_laps"] = len(laps)
        for dn, v in best_lap_ratio(laps).items():
            feats.setdefault(dn, {})[f"{tag}_best_ratio"] = v
        if tag in ("fp2", "fp3"):
            stints = o.get("stints", session_key=sess[name])
            for dn, v in long_run_ratio(laps, stints).items():
                feats.setdefault(dn, {})[f"{tag}_longrun_ratio"] = v
    if "Sprint Qualifying" in sess:
        res = o.get("session_result", session_key=sess["Sprint Qualifying"])
        cov["sq_results"] = len(res)
        for r in res:
            if r.get("position") is not None:
                feats.setdefault(r["driver_number"], {})["sq_position"] = r["position"]
    cov["sprint_weekend"] = "Sprint Qualifying" in sess
    race_drivers = master[master.raceId == t.raceId][["driverRef", "driverId"]]
    got = 0
    for dn, f in feats.items():
        code = acr.get(dn)
        match = race_drivers[race_drivers.driverRef.map(code_of) == code]
        if len(match) != 1:
            continue
        rows.append(dict(raceId=int(t.raceId), driverRef=match.iloc[0].driverRef, **f)); got += 1
    cov["drivers_mapped"] = got
    coverage.append(cov)
    print(f"  {t.year} R{t.round:>2} {t.name[:28]:<28} sessions={len(sess)} mapped={got} sprint={cov['sprint_weekend']} (net {o.STATS['network']}, cache {o.STATS['cached']})", flush=True)

df = pd.DataFrame(rows)
df.to_csv(os.path.join(OUT, "openf1_features.csv"), index=False)
json.dump(coverage, open(os.path.join(OUT, "openf1_coverage.json"), "w"), indent=1)
print("rows", len(df), "| races with any feature:", df.raceId.nunique(), "| network calls", o.STATS["network"], "cached", o.STATS["cached"])
