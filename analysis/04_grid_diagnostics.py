#!/usr/bin/env python3
"""How good is the predicted grid (the quali model's output) that condition (b) feeds the race model?
Reads analysis/out/backtest_rows.csv. Pit-lane starts (grid 0) sort last."""
import os
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
p = pd.read_csv(os.path.join(REPO, "analysis", "out", "backtest_rows.csv"))
b = p[p.cond == "b_predicted_quali"]
rows = []
for rid, g in b.groupby("raceId"):
    rg = g.real_grid.replace(0, 99)
    rho = spearmanr(g.grid, rg).correlation
    pole_ok = g.loc[g.grid.idxmin()].driverRef == g.loc[rg.idxmin()].driverRef
    top3 = len(set(g.nsmallest(3, "grid").driverRef) & set(g.assign(rg=rg).nsmallest(3, "rg").driverRef))
    rows.append(dict(raceId=rid, year=g.year.iloc[0], n=len(g), rho=rho, pole_hit=pole_ok,
                     mae=(g.grid - g.real_grid.replace(0, len(g))).abs().mean(), top3=top3))
q = pd.DataFrame(rows)
print(f"predicted vs real grid, {len(q)} races, {q.n.sum()} driver-races")
print(f"  mean Spearman {q.rho.mean():.3f} | pole-sitter hit {q.pole_hit.mean():.3f} ({int(q.pole_hit.sum())}/{len(q)}) "
      f"| mean |position error| {q.mae.mean():.2f} | top-3 grid overlap {q.top3.mean():.2f} of 3")
print(q.groupby("year")[["rho", "pole_hit", "mae", "top3"]].mean().round(3).to_string())
