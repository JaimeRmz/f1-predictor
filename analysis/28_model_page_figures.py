#!/usr/bin/env python3
"""The headline model figures on the Model page, computed from a backtest_rows.csv (analysis/out/backtest_rows.csv, 02_backtest.py's output).

    python analysis/28_model_page_figures.py [rows.csv ...]        default: the pre-roll-forward rows and the rolled rows

Per condition (a = real grid, b = predicted-grid path): podium ROC-AUC, winner ROC-AUC, podium recall and precision at a 0.5 score, and the
share of the drivers who really started in the top 10 that the predicted grid also put in its top 10, pooled over the races (b only). Running it on the PRE-roll-forward rows must reproduce the figures that were
published (podium AUC 0.954 / 0.909, winner AUC 0.966 / 0.904, recall 91.5 / 86.0 %, precision 52.0 / 47.4 %, top-10 overlap 79.0 %): that is the
check that this script computes what the page has always shown. Writes analysis/out/rolled/model_page_figures.json for the rolled rows.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DEFAULT = [os.path.join(REPO, "analysis", "out", "history", "pre-roll-forward", "backtest_rows.csv"), os.path.join(REPO, "analysis", "out", "rolled", "backtest_rows.csv")]


def figures(path):
    P = pd.read_csv(path)
    out = {}
    for cond in ("a_real_grid", "b_predicted_quali"):
        g = P[P.cond == cond]
        tp = ((g.p_pod >= 0.5) & (g.pod == 1)).sum()
        out[cond] = dict(podium_auc=roc_auc_score(g.pod, g.p_pod), winner_auc=roc_auc_score(g.win, g.p_win),
                         recall=tp / (g.pod == 1).sum(), precision=tp / max(1, (g.p_pod >= 0.5).sum()), races=int(g.raceId.nunique()), rows=int(len(g)))
    b = P[P.cond == "b_predicted_quali"]
    real10 = b[(b.real_grid >= 1) & (b.real_grid <= 10)]          # pooled over all races: of the drivers who really started in the top 10 ...
    out["top10_grid_overlap"] = float((real10.grid <= 10).mean())   # ... the share the predicted grid also put in its top 10
    return out


if __name__ == "__main__":
    paths = sys.argv[1:] or DEFAULT
    for p in paths:
        f = figures(p)
        print(os.path.relpath(p, REPO))
        for c in ("a_real_grid", "b_predicted_quali"):
            x = f[c]
            print(f"  {c:18s} podium AUC {x['podium_auc']:.3f}  winner AUC {x['winner_auc']:.3f}  recall {100 * x['recall']:.1f}%  precision {100 * x['precision']:.1f}%  ({x['races']} races, {x['rows']} rows)")
        print(f"  predicted-vs-real top-10 grid overlap {100 * f['top10_grid_overlap']:.1f}%")
        if p.endswith(os.path.join("rolled", "backtest_rows.csv")):
            json.dump(f, open(os.path.join(os.path.dirname(p), "model_page_figures.json"), "w"), indent=1)
