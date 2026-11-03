#!/usr/bin/env python3
"""Separate 'better ranking' from 'different score level' in the walk-forward retrain results.

The retrained variants change Brier partly because their scores are LOWER overall (sums per race
fall), i.e. less over-confident, which is a level shift that a per-race rescale also produces.
Here every variant's scores are rescaled per race to sum to 1 (win) and 3 (podium), exactly as in
Part 1B section 5.1, and Brier is recomputed. If retraining helped the RANKING it would still beat
production after rescaling; if it only shifted the level, the differences vanish.

Reads analysis/out/retrain_rows.csv. Paired bootstrap by race (5,000 resamples), differences vs
the production model rescaled the same way. Writes analysis/out/retrain_normalised.json.
Run: python analysis/17_retrain_normalised.py
"""
import json
import os

import numpy as np
import pandas as pd

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(REPO, "analysis", "out")
B = 5000
rng = np.random.default_rng(20261109)
rows = pd.read_csv(os.path.join(OUT, "retrain_rows.csv"))
PROD = "V0 production (trained once, year <= 2024)"


def scale_to_sum(p, total):
    p = np.asarray(p, float)
    if p.sum() <= 0:
        return np.full_like(p, total / len(p))
    lo, hi = 0.0, 1e6
    for _ in range(80):
        c = (lo + hi) / 2
        if np.minimum(1.0, c * p).sum() < total:
            lo = c
        else:
            hi = c
    return np.minimum(1.0, hi * p)


res = {}
for cond in ("a_real_grid", "b_predicted_quali"):
    comp = {}
    for v, g in rows[rows.cond == cond].groupby("variant"):
        per = {}
        for rid, gr in g.groupby("raceId"):
            w, p = scale_to_sum(gr.p_win.values, 1), scale_to_sum(gr.p_pod.values, 3)
            per[rid] = (len(gr), ((w - gr.win.values) ** 2).sum(), ((p - gr.pod.values) ** 2).sum(), int(gr.year.iloc[0]))
        comp[v] = per
    ids_all = sorted(comp[PROD])
    for scope, ids in (("all_43", ids_all), ("2025_24", [i for i in ids_all if comp[PROD][i][3] == 2025]), ("2026_19", [i for i in ids_all if comp[PROD][i][3] == 2026])):
        arr = {v: np.array([comp[v][i][:3] for i in ids], float) for v in comp}
        idx = [rng.integers(0, len(ids), len(ids)) for _ in range(B)]
        def stat(a, ix):
            s = a[ix].sum(0); return np.array([s[1] / s[0], s[2] / s[0]])
        draws = {v: np.array([stat(arr[v], ix) for ix in idx]) for v in arr}
        out = {}
        for v in arr:
            e = stat(arr[v], np.arange(len(ids)))
            d = {"brier_win_norm": float(e[0]), "brier_pod_norm": float(e[1]),
                 "ci_win": [float(np.quantile(draws[v][:, 0], .025)), float(np.quantile(draws[v][:, 0], .975))],
                 "ci_pod": [float(np.quantile(draws[v][:, 1], .025)), float(np.quantile(draws[v][:, 1], .975))]}
            if v != PROD:
                ep = stat(arr[PROD], np.arange(len(ids))); dd = draws[v] - draws[PROD]
                d["paired_win"] = [float(e[0] - ep[0]), float(np.quantile(dd[:, 0], .025)), float(np.quantile(dd[:, 0], .975))]
                d["paired_pod"] = [float(e[1] - ep[1]), float(np.quantile(dd[:, 1], .025)), float(np.quantile(dd[:, 1], .975))]
            out[v] = d
        res[f"{cond}|{scope}"] = {"n_races": len(ids), "variants": out}
json.dump(res, open(os.path.join(OUT, "retrain_normalised.json"), "w"), indent=1)
for k, r in res.items():
    print(f"\n=== {k} ({r['n_races']} races): Brier AFTER per-race rescaling to sum 1 / 3")
    for v, d in r["variants"].items():
        pv = "" if "paired_win" not in d else "  vs prod(norm): win %+.4f [%+.4f,%+.4f]  pod %+.4f [%+.4f,%+.4f]" % (*d["paired_win"], *d["paired_pod"])
        print(f"  {v[:46]:<46} win {d['brier_win_norm']:.4f} pod {d['brier_pod_norm']:.4f}{pv}")
