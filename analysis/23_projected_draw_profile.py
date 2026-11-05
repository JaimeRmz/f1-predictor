"""Real backtest error profile used to set the noise of the Projected race draw (rank-anchored sampling).
Reads analysis/out/backtest_rows.csv (43 races, model with the PREDICTED qualifying grid = the situation of an upcoming race) and
data/results.csv. Writes analysis/out/projected_draw_profile.json. Two profiles:
  all       : actual finishing position as classified, retirements included
  finishers : retirements removed from both the model's ranking and the actual order, then re-ranked (the animation has no retirements)
"""
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bt = pd.read_csv(os.path.join(ROOT, "analysis/out/backtest_rows.csv"))
bt = bt[bt.cond == "b_predicted_quali"].copy()
res = pd.read_csv(os.path.join(ROOT, "data/results.csv"), na_values=["\\N"])
drv = pd.read_csv(os.path.join(ROOT, "data/drivers.csv"))
res = res.merge(drv[["driverId", "driverRef"]], on="driverId")
bt = bt.merge(res[["raceId", "driverRef", "position"]], on=["raceId", "driverRef"], how="left")
bt["classified"] = bt.position.notna()

BUCKETS = [(1, 1), (2, 3), (4, 6), (7, 10), (11, 15), (16, 30)]
def profile(df, rank_col, act_col):
    out = {}
    for lo, hi in BUCKETS:
        g = df[(df[rank_col] >= lo) & (df[rank_col] <= hi)]
        e = g[act_col] - g[rank_col]
        out[f"{lo}-{hi}" if lo != hi else f"{lo}"] = dict(n=int(len(g)), mae=round(float(e.abs().mean()), 2), sd=round(float(e.std()), 2), bias=round(float(e.mean()), 2),
                                                          p90=round(float(e.abs().quantile(0.9)), 1))
    return out

def rank_in_race(df, finishers_only):
    d = df[df.classified] if finishers_only else df
    d = d.copy()
    d["prank"] = d.groupby("raceId").apply(lambda x: (-x.p_pod - x.p_win * 1e-6).rank(method="first")).reset_index(level=0, drop=True)
    d["act"] = d.groupby("raceId").positionOrder.rank(method="first")
    return d

out = {}
for name, fo in (("all", False), ("finishers", True)):
    d = rank_in_race(bt, fo)
    n = d.groupby("raceId").size()
    half = d[d.prank > d.raceId.map(n) / 2]
    top1 = d[d.prank == 1]
    out[name] = dict(
        rows=int(len(d)), races=int(d.raceId.nunique()), mean_field=round(float(n.mean()), 1), by_rank=profile(d, "prank", "act"),
        bottom_half_in_top5_rate_per_driver=round(float((half.act <= 5).mean()), 4),
        races_with_a_bottom_half_driver_in_top5=round(float(half.groupby("raceId").act.min().le(5).mean()), 3),
        model_rank1_wins=round(float((top1.act == 1).mean()), 3),
        top3_overlap_mean=round(float(d.groupby("raceId").apply(lambda x: len(set(x[x.prank <= 3].driverRef) & set(x[x.act <= 3].driverRef))).mean()), 2),
        overall_mae=round(float((d.act - d.prank).abs().mean()), 2),
    )
with open(os.path.join(ROOT, "analysis/out/projected_draw_profile.json"), "w") as fh:
    json.dump(out, fh, indent=1)
print(json.dumps(out, indent=1))
