#!/usr/bin/env python3
"""Do practice pace, sprint-qualifying results or the previous race's grid improve the
PRE-QUALIFYING grid prediction? (experiment recorded in docs/stage1/00-scope.md)

Baseline = the production predicted grid (condition (b) of the Part 1B backtest).
Target   = the real qualifying order (quali_position from the master; also reported
           against the real race grid for continuity with Part 1B section 4.5).
Metrics  = per-race Spearman between predicted and actual order, pole-sitter hit rate,
           mean absolute rank error; means over races with bootstrap-by-race 95% CIs and
           PAIRED differences against the baseline (same races, same resamples).

Signals (all known before qualifying starts; see 10_openf1_collect.py):
  prev_grid    the driver's grid at the previous race
  prev_quali   the driver's qualifying position at the previous race
  fp_best      best practice lap, ratio to the session's fastest (min over FP sessions)
  fp_long      FP2/FP3 long-run pace (crude: no fuel/compound correction)
  pace         mean of the fp_best and fp_long ranks
  sq           Sprint Qualifying position (sprint weekends only)
Blends: equal-weight rank averages with the baseline (NO fitting) and an expanding-window
ridge regression (fit only on earlier races; burn-in 12 races).

Read-only. Inputs: analysis/out/backtest_rows.csv, openf1_features.csv, openf1_coverage.json.
Run: python analysis/11_grid_signal_experiment.py
"""
import json
import os

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(REPO, "analysis", "out")
B, BURN = 5000, 12
rng = np.random.default_rng(20261106)

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
rows = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))
feat = pd.read_csv(os.path.join(OUT, "openf1_features.csv"))
cov = {c["raceId"]: c for c in json.load(open(os.path.join(OUT, "openf1_coverage.json")))}
races = pd.read_csv(os.path.join(REPO, "data", "races.csv"))
order = races[["raceId", "year", "round"]].sort_values(["year", "round"]).reset_index(drop=True)
prev_of = {order.raceId[i]: order.raceId[i - 1] for i in range(1, len(order))}

b = rows[rows.cond == "b_predicted_quali"][["raceId", "year", "round", "driverRef", "grid", "real_grid"]].rename(columns={"grid": "p0_grid"})
m = master[["raceId", "driverRef", "quali_position", "grid"]].rename(columns={"grid": "race_grid", "quali_position": "q"})
df = b.merge(m, on=["raceId", "driverRef"], how="left").merge(feat, on=["raceId", "driverRef"], how="left")
# previous-race signals
pm = master[["raceId", "driverRef", "grid", "quali_position"]].rename(columns={"grid": "prev_grid", "quali_position": "prev_quali"})
df["prev_raceId"] = df.raceId.map(prev_of)
df = df.merge(pm, left_on=["prev_raceId", "driverRef"], right_on=["raceId", "driverRef"], how="left", suffixes=("", "_p")).drop(columns=["raceId_p"])
df["prev_grid"] = df.prev_grid.replace(0, np.nan)  # pit-lane start is not a pace signal
df["sprint"] = df.raceId.map(lambda r: bool(cov.get(r, {}).get("sprint_weekend")))
df = df.sort_values(["year", "round", "p0_grid"]).reset_index(drop=True)
print(f"races {df.raceId.nunique()} (sprint weekends: {df[df.sprint].raceId.nunique()}), driver-races {len(df)}")


def rank(v, tiebreak):
    """rank ascending within a race; NaN last; ties broken by the baseline grid (stable)."""
    v = np.where(np.isnan(v), np.inf, v)
    idx = np.lexsort((tiebreak, v))
    r = np.empty(len(v)); r[idx] = np.arange(1, len(v) + 1)
    return r


# signal scores (lower = faster) -> ranks within each race
sig = {}
for rid, g in df.groupby("raceId"):
    tb = g.p0_grid.values
    s = {}
    s["p0"] = g.p0_grid.values.astype(float)
    s["prev_grid"] = rank(g.prev_grid.values.astype(float), tb)
    s["prev_quali"] = rank(g.prev_quali.values.astype(float), tb)
    fp_cols = [c for c in ("fp1_best_ratio", "fp2_best_ratio", "fp3_best_ratio") if c in g]
    fpb = g[fp_cols].min(axis=1).values.astype(float) if fp_cols else np.full(len(g), np.nan)
    lr_cols = [c for c in ("fp2_longrun_ratio", "fp3_longrun_ratio") if c in g]
    lr = g[lr_cols].min(axis=1).values.astype(float) if lr_cols else np.full(len(g), np.nan)
    s["fp_best"] = rank(fpb, tb)
    s["fp_long"] = rank(np.where(np.isnan(lr), np.nan, lr), tb)
    have_long = ~np.isnan(lr)
    s["pace"] = rank(np.where(have_long, (s["fp_best"] + s["fp_long"]) / 2, s["fp_best"]), tb)
    sq = g.sq_position.values.astype(float) if "sq_position" in g else np.full(len(g), np.nan)
    s["sq"] = rank(sq, tb)
    s["_has_fp"] = bool(np.isfinite(fpb).sum() >= 15)
    s["_has_long"] = bool(have_long.sum() >= 10)
    s["_has_sq"] = bool(np.isfinite(sq).sum() >= 15)
    sig[rid] = s


def blend(*names):
    return lambda s: rank(np.mean([s[n] for n in names], axis=0), s["p0"])


methods = {
    "baseline: production predicted grid": lambda s: s["p0"],
    "previous race grid": lambda s: s["prev_grid"],
    "previous race qualifying": lambda s: s["prev_quali"],
    "practice best lap": lambda s: s["fp_best"],
    "practice long run": lambda s: s["fp_long"],
    "practice pace (best + long run)": lambda s: s["pace"],
    "sprint qualifying result": lambda s: s["sq"],
    "blend: baseline + practice best lap": blend("p0", "fp_best"),
    "blend: baseline + practice pace": blend("p0", "pace"),
    "blend: baseline + previous grid": blend("p0", "prev_grid"),
    "blend: baseline + pace + previous grid": blend("p0", "pace", "prev_grid"),
    "blend: baseline + sprint qualifying": blend("p0", "sq"),
    # one rule for every weekend: sprint weekends use Sprint Qualifying, normal weekends the practice best lap
    "blend: baseline + best available signal (SQ on sprint weekends, practice best lap otherwise)":
        lambda s: rank(np.mean([s["p0"], s["sq"] if s["_has_sq"] else (s["fp_best"] if s["_has_fp"] else s["p0"])], axis=0), s["p0"]),
}

# expanding-window ridge (fit only on earlier races): predicts quali position from the rank features
FEATS = ["p0", "prev_grid", "fp_best", "fp_long"]
race_order = list(df.drop_duplicates("raceId").raceId)


def race_X(rid, with_sq=False):
    g = df[df.raceId == rid]
    cols = [sig[rid][f] for f in FEATS] + ([sig[rid]["sq"]] if with_sq else [])
    return np.column_stack(cols).astype(float), g


def ridge_predictions(subset_ids, with_sq=False, lam=1.0):
    """chronological expanding window within subset_ids; returns {raceId: predicted rank array} for races after burn-in."""
    out = {}
    for k, rid in enumerate(subset_ids):
        if k < BURN:
            continue
        Xs, ys = [], []
        for pid in subset_ids[:k]:
            X, g = race_X(pid, with_sq)
            Xs.append(X); ys.append(g.q.values.astype(float))
        X, y = np.vstack(Xs), np.concatenate(ys)
        ok = ~np.isnan(y)
        mu, sd = X[ok].mean(0), X[ok].std(0) + 1e-9
        Z = (X[ok] - mu) / sd
        w = np.linalg.solve(Z.T @ Z + lam * np.eye(Z.shape[1]), Z.T @ (y[ok] - y[ok].mean()))
        Xt, gt = race_X(rid, with_sq)
        pred = ((Xt - mu) / sd) @ w + y[ok].mean()
        out[rid] = rank(pred, sig[rid]["p0"])
    return out


def per_race_metrics(ranks_by_race, target):
    rows_ = []
    for rid, pr in ranks_by_race.items():
        g = df[df.raceId == rid]
        t = g[target].replace(0, np.nan) if target == "real_grid" else g[target]
        t = t.fillna(t.max() + 1).values.astype(float)
        if np.nanstd(pr) == 0 or np.nanstd(t) == 0:
            continue
        rho = spearmanr(pr, t).correlation
        pole = float(t[np.argmin(pr)] == t.min())
        rows_.append(dict(raceId=rid, rho=rho, pole=pole, mae=float(np.abs(pr - rank(t, g.p0_grid.values)).mean()), n=len(g)))
    return pd.DataFrame(rows_).set_index("raceId")


def boot(res, base_name):
    ids = sorted(set.intersection(*[set(v.index) for v in res.values()]))
    idxs = [rng.integers(0, len(ids), len(ids)) for _ in range(B)]
    out = {}
    for name, d in res.items():
        d = d.loc[ids]
        est = d[["rho", "pole", "mae"]].mean()
        draws = np.array([d.iloc[ix][["rho", "pole", "mae"]].mean().values for ix in idxs])
        item = dict(n_races=len(ids), n_rows=int(d.n.sum()), est=est.to_dict(),
                    ci={k: (float(np.quantile(draws[:, i], .025)), float(np.quantile(draws[:, i], .975))) for i, k in enumerate(["rho", "pole", "mae"])})
        if name != base_name:
            bd = res[base_name].loc[ids]
            bdraws = np.array([bd.iloc[ix][["rho", "pole", "mae"]].mean().values for ix in idxs])
            diff = draws - bdraws
            item["paired_vs_baseline"] = {k: dict(est=float(est[k] - bd[k].mean()), lo=float(np.quantile(diff[:, i], .025)), hi=float(np.quantile(diff[:, i], .975)))
                                          for i, k in enumerate(["rho", "pole", "mae"])}
        out[name] = item
    return out


subsets = {
    "ALL_43 (no practice needed)": [r for r in race_order],
    "NORMAL weekends with practice data": [r for r in race_order if not df[df.raceId == r].sprint.iloc[0] and sig[r]["_has_fp"]],
    "NORMAL weekends, ALL with practice data, unfitted methods only": [r for r in race_order if not df[df.raceId == r].sprint.iloc[0] and sig[r]["_has_fp"]],
    "SPRINT weekends with Sprint Qualifying": [r for r in race_order if df[df.raceId == r].sprint.iloc[0] and sig[r]["_has_sq"]],
}
results = {}
BASE = "baseline: production predicted grid"
BEST = "blend: baseline + best available signal (SQ on sprint weekends, practice best lap otherwise)"
use = {
    "ALL_43 (no practice needed)": ["baseline: production predicted grid", "previous race grid", "previous race qualifying", "blend: baseline + previous grid", BEST],
    "NORMAL weekends, ALL with practice data, unfitted methods only": [m_ for m_ in methods if m_ not in ("sprint qualifying result", "blend: baseline + sprint qualifying", BEST)],
    "NORMAL weekends with practice data": [m_ for m_ in methods if m_ not in ("sprint qualifying result", "blend: baseline + sprint qualifying")],
    "SPRINT weekends with Sprint Qualifying": ["baseline: production predicted grid", "previous race grid", "practice best lap", "sprint qualifying result", "blend: baseline + sprint qualifying", "blend: baseline + previous grid"],
}
for sname, ids in subsets.items():
    for target in ("q", "real_grid"):
        res = {name: per_race_metrics({rid: methods[name](sig[rid]) for rid in ids}, target) for name in use[sname]}
        if sname.startswith("NORMAL weekends with"):  # fitted model, only races after the burn-in (the all-races block is unfitted)
            rp = ridge_predictions(ids)
            res["fitted: expanding-window ridge (baseline, prev grid, practice)"] = per_race_metrics(rp, target)
            # compare on the SAME post-burn-in races for every method
            keep = set(rp)
            res = {k: v[v.index.isin(keep)] for k, v in res.items()}
        results[f"{sname}|target={'quali' if target == 'q' else 'real_grid'}"] = boot(res, BASE)

json.dump(results, open(os.path.join(OUT, "grid_signal_experiment.json"), "w"), indent=1, default=float)
cov_summary = dict(
    races_total=len(race_order), normal_with_practice=len(subsets["NORMAL weekends with practice data"]),
    sprint_with_sq=len(subsets["SPRINT weekends with Sprint Qualifying"]),
    driver_rows_missing_fp_best=int(df[[c for c in df.columns if c.endswith("best_ratio")]].isna().all(axis=1).sum()),
    rows=len(df))
json.dump(cov_summary, open(os.path.join(OUT, "grid_signal_coverage.json"), "w"), indent=1)
for key, res in results.items():
    n = next(iter(res.values()))
    print(f"\n=== {key} | races={n['n_races']} driver-races={n['n_rows']}")
    for name, v in res.items():
        d = v.get("paired_vs_baseline")
        ds = "" if not d else "  vs baseline: rho %+.3f [%+.3f,%+.3f] | pole %+.3f [%+.3f,%+.3f] | MAE %+.2f [%+.2f,%+.2f]" % (
            d["rho"]["est"], d["rho"]["lo"], d["rho"]["hi"], d["pole"]["est"], d["pole"]["lo"], d["pole"]["hi"], d["mae"]["est"], d["mae"]["lo"], d["mae"]["hi"])
        print(f"  {name:<58} rho {v['est']['rho']:.3f} [{v['ci']['rho'][0]:.3f},{v['ci']['rho'][1]:.3f}] pole {v['est']['pole']*100:5.1f}% [{v['ci']['pole'][0]*100:.0f},{v['ci']['pole'][1]*100:.0f}] MAE {v['est']['mae']:.2f}{ds}")
