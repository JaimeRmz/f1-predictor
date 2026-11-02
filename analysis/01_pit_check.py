#!/usr/bin/env python3
"""Point-in-time check for the 9 race-model features.

Question: for every 2025-2026 race, are the feature values stored in
data/f1_master.csv exactly what could have been computed using ONLY data from
before that race?

Method: recompute each feature from the raw CSVs (results, races, drivers,
status, circuits) with a deliberately naive per-row loop -- "filter to earlier
races, then aggregate" -- independent of the notebook's shift/rolling pipeline,
and compare to the master. READ-ONLY: writes only analysis/out/pit_check.json.

Run:  python analysis/01_pit_check.py
"""
import json
import os

import numpy as np
import pandas as pd

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
D = os.path.join(REPO, "data")
OUT = os.path.join(REPO, "analysis", "out")
os.makedirs(OUT, exist_ok=True)
NA = chr(92) + "N"


def rd(name):
    return pd.read_csv(os.path.join(D, name), na_values=[NA], keep_default_na=False)


res, races, drv, cons, circ, status = (rd(n) for n in
    ("results.csv", "races.csv", "drivers.csv", "constructors.csv", "circuits.csv", "status.csv"))
df = (res.merge(races[["raceId", "year", "round", "circuitId"]], on="raceId")
         .merge(drv[["driverId", "driverRef"]], on="driverId")
         .merge(status[["statusId", "status"]], on="statusId"))
df = df[df.year >= 2010].copy()
df["positionOrder"] = pd.to_numeric(df["positionOrder"])
df["points"] = pd.to_numeric(df["points"]).fillna(0)
OK = ["Finished", "+1 Lap", "+2 Laps", "+3 Laps", "+4 Laps", "+5 Laps"]
df["is_dnf"] = (~df["status"].isin(OK)).astype(int)
df["podium"] = (df["positionOrder"] <= 3).astype(int)
df["t"] = df["year"] * 100 + df["round"]  # chronological key; one race per (year, round)

master = pd.read_csv(os.path.join(D, "f1_master.csv"))
FEATURES = ["driver_season_points", "constructor_season_points", "driver_circuit_podium_rate",
            "driver_recent_form", "constructor_recent_form", "driver_dnf_rate",
            "constructor_dnf_rate", "driver_last5_points"]


def features_before(row):
    """Features for one (driver, race) using ONLY rows from strictly earlier races."""
    past = df[df.t < row.t]
    mine = past[past.driverId == row.driverId].sort_values("t")
    team = past[past.constructorId == row.constructorId]
    team_races = (team.groupby("t").agg(pos=("positionOrder", "mean"), dnf=("is_dnf", "mean"))
                      .sort_index())
    team_pts = team[team.year == row.year].groupby("t")["points"].sum()
    byref = past[past.driverRef == row.driverRef].sort_values("t")

    f = {}
    f["driver_season_points"] = mine[mine.year == row.year]["points"].sum()
    f["constructor_season_points"] = team_pts.sum()
    f["driver_recent_form"] = mine["positionOrder"].tail(3).mean() if len(mine) else 10.0
    f["constructor_recent_form"] = team_races["pos"].tail(3).mean() if len(team_races) else 10.0
    f["driver_dnf_rate"] = mine["is_dnf"].tail(10).mean() if len(mine) else 0.0
    f["constructor_dnf_rate"] = team_races["dnf"].tail(10).mean() if len(team_races) else 0.0
    f["driver_last5_points"] = byref["points"].tail(5).sum() if len(byref) else 0.0
    # decayed circuit podium rate: yearly mean podium at this circuit over strictly earlier YEARS
    cy = past[(past.driverId == row.driverId) & (past.circuitId == row.circuitId) & (past.year < row.year)]
    if len(cy):
        yr = cy.groupby("year")["podium"].mean()
        w = 0.75 ** (row.year - yr.index.values)
        f["driver_circuit_podium_rate"] = float((yr.values * w).sum() / w.sum())
    else:
        f["driver_circuit_podium_rate"] = 0.0
    return f


target = df[df.year >= 2025]
rows = []
for r in target.itertuples():
    rows.append({"resultId": r.resultId, **features_before(r)})
mine = pd.DataFrame(rows).set_index("resultId")
m = master.set_index("resultId").loc[mine.index]

report = {"rows_checked": int(len(mine)), "races": int(target.raceId.nunique()), "features": {}}
for f in FEATURES:
    diff = (mine[f] - m[f]).abs()
    bad = diff > 1e-6
    report["features"][f] = {"max_abs_diff": float(diff.max()), "mismatching_rows": int(bad.sum())}
    if bad.any():
        sample = m.loc[bad[bad].index[:3], ["year", "round", "driver_name", f]].copy()
        sample["recomputed"] = mine.loc[sample.index, f]
        report["features"][f]["examples"] = sample.reset_index().to_dict(orient="records")

# ── quali-model features (the predicted-qualifying path) ──────────────
# Base quantity is the master's own quali_position (real qualifying, grid where
# qualifying.csv has no row); the aggregates are recomputed from EARLIER races.
mm = master.copy()
mm["t"] = mm["year"] * 100 + mm["round"]
dst = rd("driver_standings.csv")[["raceId", "driverId", "position"]].rename(columns={"position": "dpos"})
cst = rd("constructor_standings.csv")[["raceId", "constructorId", "position"]].rename(columns={"position": "cpos"})
QF = ["driver_season_quali_avg", "driver_last3_quali_avg", "constructor_season_quali_avg",
      "driver_circuit_quali_avg", "driver_championship_position", "constructor_championship_position"]
circuit_of = races.set_index("raceId")["circuitId"]


def quali_before(row):
    past = mm[mm.t < row.t]
    mine = past[past.driverId == row.driverId].sort_values("t")
    team = past[(past.constructorId == row.constructorId)]
    team_q = team[team.year == row.year].groupby("t")["quali_position"].mean()
    f = {}
    ms = mine[mine.year == row.year]["quali_position"]
    f["driver_season_quali_avg"] = ms.mean() if len(ms) else 11.0
    f["driver_last3_quali_avg"] = mine["quali_position"].tail(3).mean() if len(mine) else 11.0
    f["constructor_season_quali_avg"] = team_q.mean() if len(team_q) else 11.0
    cy = past[(past.driverId == row.driverId) & (past.circuitId == row.circuitId) & (past.year < row.year)]
    if len(cy):
        yr = cy.groupby("year")["quali_position"].mean()
        w = 0.75 ** (row.year - yr.index.values)
        f["driver_circuit_quali_avg"] = float((yr.values * w).sum() / w.sum())
    else:
        f["driver_circuit_quali_avg"] = 11.0
    # championship position as of the driver's / team's PREVIOUS race row
    if len(mine):
        got = dst[(dst.raceId == mine.iloc[-1].raceId) & (dst.driverId == row.driverId)]["dpos"]
        f["driver_championship_position"] = float(got.iloc[0]) if len(got) and pd.notna(got.iloc[0]) else 11.0
    else:
        f["driver_championship_position"] = 11.0
    if len(team):
        last_rid = team.sort_values("t").iloc[-1].raceId
        got = cst[(cst.raceId == last_rid) & (cst.constructorId == row.constructorId)]["cpos"]
        f["constructor_championship_position"] = float(got.iloc[0]) if len(got) and pd.notna(got.iloc[0]) else 6.0
    else:
        f["constructor_championship_position"] = 6.0
    return f


mt = mm[mm.year >= 2025]
qrows = [{"resultId": r.resultId, **quali_before(r)} for r in mt.itertuples()]
qmine = pd.DataFrame(qrows).set_index("resultId")
qm = master.set_index("resultId").loc[qmine.index]
report["quali_features"] = {}
for f in QF:
    diff = (qmine[f] - qm[f]).abs()
    bad = diff > 1e-6
    report["quali_features"][f] = {"max_abs_diff": float(diff.max()), "mismatching_rows": int(bad.sum())}
    if bad.any():
        ex = qm.loc[bad[bad].index[:3], ["year", "round", "driver_name", f]].copy()
        ex["recomputed"] = qmine.loc[ex.index, f]
        report["quali_features"][f]["examples"] = ex.reset_index().to_dict(orient="records")

json.dump(report, open(os.path.join(OUT, "pit_check.json"), "w"), indent=1, default=float)

print(f"rows checked: {report['rows_checked']} across {report['races']} races (2025-2026)")
for f, v in report["features"].items():
    print(f"  {f:<30} max|diff|={v['max_abs_diff']:.2e}  mismatching rows={v['mismatching_rows']}")
    for e in v.get("examples", []):
        print("      e.g.", e)
print("quali-model features:")
for f, v in report["quali_features"].items():
    print(f"  {f:<34} max|diff|={v['max_abs_diff']:.2e}  mismatching rows={v['mismatching_rows']}")
    for e in v.get("examples", []):
        print("      e.g.", e)
