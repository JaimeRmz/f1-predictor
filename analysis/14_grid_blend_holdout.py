#!/usr/bin/env python3
"""Held-out re-test of the pre-qualifying grid blend (Part 1C follow-up).

Part 1C's "best available signal" blend used equal weights and was defined after the
per-signal results were seen (post hoc). Here the blend WEIGHT is fitted on one season only
and scored on the other, in both directions:

    fit on 2025  ->  evaluate on 2026 rounds 1-19      (19 races)
    fit on 2026  ->  evaluate on 2025                  (24 races)

Blend: score = (1 - w) * rank(production predicted grid) + w * rank(signal), re-ranked, where
signal = practice best lap (normal weekends) or Sprint Qualifying position (sprint weekends).
One weight per weekend type, chosen on the TRAINING season only by maximising the mean
per-race Spearman against the real qualifying order (grid of w = 0, 0.05, ..., 1). The
evaluation season is never seen when choosing w. Also reported: the unfitted equal-weight
blend (w = 0.5) and the baseline.

Metrics: Spearman and pole-sitter hit rate per race; means with bootstrap-by-race 95% CIs;
differences vs the baseline are paired (same races, same resamples). Read-only.

Run: python analysis/14_grid_blend_holdout.py
"""
import json
import os

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(REPO, "analysis", "out")
B = 5000
rng = np.random.default_rng(20261107)
WS = np.round(np.arange(0, 1.0001, 0.05), 2)

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
rows = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))
feat = pd.read_csv(os.path.join(OUT, "openf1_features.csv"))
cov = {c["raceId"]: c for c in json.load(open(os.path.join(OUT, "openf1_coverage.json")))}

b = rows[rows.cond == "b_predicted_quali"][["raceId", "year", "round", "driverRef", "grid"]].rename(columns={"grid": "p0"})
df = (b.merge(master[["raceId", "driverRef", "quali_position"]].rename(columns={"quali_position": "q"}), on=["raceId", "driverRef"], how="left")
        .merge(feat, on=["raceId", "driverRef"], how="left").sort_values(["year", "round", "p0"]).reset_index(drop=True))
df["sprint"] = df.raceId.map(lambda r: bool(cov[r]["sprint_weekend"]))


def rank(v, tb):
    v = np.where(np.isnan(v), np.inf, v)
    idx = np.lexsort((tb, v))
    r = np.empty(len(v)); r[idx] = np.arange(1, len(v) + 1)
    return r


race = {}
for rid, g in df.groupby("raceId"):
    tb = g.p0.values
    fp_cols = [c for c in ("fp1_best_ratio", "fp2_best_ratio", "fp3_best_ratio") if c in g]
    fpb = g[fp_cols].min(axis=1).values.astype(float)
    sq = g.sq_position.values.astype(float)
    sprint = bool(g.sprint.iloc[0])
    sig_raw = sq if sprint else fpb
    race[rid] = dict(year=int(g.year.iloc[0]), sprint=sprint, p0=rank(g.p0.values.astype(float), tb), tb=tb,
                     sig=rank(sig_raw, tb), usable=bool(np.isfinite(sig_raw).sum() >= 15), q=g.q.fillna(g.q.max() + 1).values.astype(float))


def blended(r, w):
    return rank((1 - w) * r["p0"] + w * r["sig"], r["tb"])


def metrics(pr, r):
    return float(spearmanr(pr, r["q"]).correlation), float(r["q"][np.argmin(pr)] == r["q"].min())


def fit_w(train_ids, sprint):
    ids = [i for i in train_ids if race[i]["sprint"] == sprint and race[i]["usable"]]
    curve = {float(w): float(np.mean([metrics(blended(race[i], w), race[i])[0] for i in ids])) for w in WS}
    best = max(curve, key=lambda w: (curve[w], -abs(w - 0.5)))  # ties -> closest to equal weight
    return best, curve, len(ids)


results = {}
for train_year, test_year in ((2025, 2026), (2026, 2025)):
    tr = [i for i, r in race.items() if r["year"] == train_year]
    te = [i for i, r in race.items() if r["year"] == test_year and r["usable"]]
    wn, curve_n, n_n = fit_w(tr, False)
    ws, curve_s, n_s = fit_w(tr, True)
    fitted = {False: wn, True: ws}
    per = {"baseline": [], "equal weights (w=0.5, nothing fitted)": [], f"weights fitted on {train_year}": []}
    for i in te:
        r = race[i]
        per["baseline"].append(metrics(r["p0"], r) + (i,))
        per["equal weights (w=0.5, nothing fitted)"].append(metrics(blended(r, 0.5), r) + (i,))
        per[f"weights fitted on {train_year}"].append(metrics(blended(r, fitted[r["sprint"]]), r) + (i,))
    arr = {k: np.array([(a, b_) for a, b_, _ in v]) for k, v in per.items()}
    sprint_mask = np.array([race[i]["sprint"] for i in te])
    out = {"train_year": train_year, "test_year": test_year, "test_races": len(te),
           "test_driver_races": int(sum(len(race[i]["p0"]) for i in te)),
           "test_normal_races": int((~sprint_mask).sum()), "test_sprint_races": int(sprint_mask.sum()),
           "fitted_weight_normal": wn, "fitted_weight_sprint": ws, "train_races_normal": n_n, "train_races_sprint": n_s,
           "train_curve_normal": curve_n, "train_curve_sprint": curve_s, "scopes": {}}
    for scope, mask in (("all test races", np.ones(len(te), bool)), ("normal weekends", ~sprint_mask), ("sprint weekends", sprint_mask)):
        n = int(mask.sum())
        if n == 0:
            continue
        idxs = [rng.integers(0, n, n) for _ in range(B)]
        res = {}
        for name, a in arr.items():
            a = a[mask]
            d = np.array([a[ix].mean(0) for ix in idxs])
            res[name] = {"races": n, "spearman": float(a[:, 0].mean()), "pole_hits": int(a[:, 1].sum()), "pole": float(a[:, 1].mean()),
                         "ci_spearman": [float(np.quantile(d[:, 0], .025)), float(np.quantile(d[:, 0], .975))],
                         "ci_pole": [float(np.quantile(d[:, 1], .025)), float(np.quantile(d[:, 1], .975))]}
            if name != "baseline":
                base = arr["baseline"][mask]
                bd = np.array([base[ix].mean(0) for ix in idxs]); diff = d - bd
                res[name]["paired_spearman"] = [float(a[:, 0].mean() - base[:, 0].mean()), float(np.quantile(diff[:, 0], .025)), float(np.quantile(diff[:, 0], .975))]
                res[name]["paired_pole"] = [float(a[:, 1].mean() - base[:, 1].mean()), float(np.quantile(diff[:, 1], .025)), float(np.quantile(diff[:, 1], .975))]
        out["scopes"][scope] = res
    results[f"fit {train_year} -> test {test_year}"] = out

json.dump(results, open(os.path.join(OUT, "grid_blend_holdout.json"), "w"), indent=1)
for key, o in results.items():
    print(f"\n=== {key}: {o['test_races']} test races ({o['test_normal_races']} normal, {o['test_sprint_races']} sprint), {o['test_driver_races']} driver-races")
    print(f"    fitted weight on the training season: normal weekends w={o['fitted_weight_normal']} (from {o['train_races_normal']} races), sprint weekends w={o['fitted_weight_sprint']} (from {o['train_races_sprint']} races)")
    print("    train-season Spearman by w (normal):", {w: round(v, 3) for w, v in o["train_curve_normal"].items() if w in (0, 0.25, 0.5, 0.75, 1.0)})
    print("    train-season Spearman by w (sprint):", {w: round(v, 3) for w, v in o["train_curve_sprint"].items() if w in (0, 0.25, 0.5, 0.75, 1.0)})
    for scope, res in o["scopes"].items():
        print(f"  -- {scope}")
        for name, v in res.items():
            ps = "" if "paired_spearman" not in v else "  | vs baseline: Spearman %+.3f [%+.3f,%+.3f]  pole %+.1fpp [%+.1f,%+.1f]" % (
                v["paired_spearman"][0], v["paired_spearman"][1], v["paired_spearman"][2], v["paired_pole"][0] * 100, v["paired_pole"][1] * 100, v["paired_pole"][2] * 100)
            print(f"     {name:<42} Spearman {v['spearman']:.3f} [{v['ci_spearman'][0]:.3f},{v['ci_spearman'][1]:.3f}]  pole {v['pole_hits']}/{v['races']} = {v['pole']*100:.1f}% [{v['ci_pole'][0]*100:.0f},{v['ci_pole'][1]*100:.0f}]{ps}")
