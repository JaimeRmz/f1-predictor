#!/usr/bin/env python3
"""Throwaway experiments on the 2025-2026 replay (reads analysis/out/backtest_rows.csv).

NOTHING here touches the production models: calibrators are fit on separate data,
and the only models trained are throwaway XGBoost fits through 2022 used solely to
produce honest 2023-24 predictions to fit calibrators on. Nothing is saved to
backend/ or data/.

Variants (per condition a = real grid, b = predicted quali):
  raw                the production scores (win clamped to podium)
  norm               per race: win scores scaled to sum to 1, podium to sum to 3
  platt23 / iso23    Platt / isotonic calibrators fit on 2023-24 out-of-sample
                     predictions of throwaway models trained through 2022
  platt23+norm ...   calibrate, then normalise
  cv_platt / cv_iso  expanding-window calibrators fit only on EARLIER races of the
                     same replay (burn-in 12 races), evaluated on races 13-43
  pl_*               Plackett-Luce finishing-order model with strengths taken from
                     the raw scores (exact win, Monte-Carlo podium): coherent sums
  fresh_features     (b only) race features from the master row entering the race
                     (point-in-time) + the PREDICTED grid: isolates feature
                     staleness from grid-prediction error
Baselines for reference: base_rate, prior_standings, prior_grid.

Run:  python analysis/03_experiments.py
"""
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BACKEND = os.path.join(REPO, "backend")
OUT = os.path.join(REPO, "analysis", "out")
sys.path.insert(0, BACKEND)
EPS, B, BURN = 1e-4, 2000, 12
rng = np.random.default_rng(20261103)

P = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))
master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
FEATURES = joblib.load(os.path.join(BACKEND, "features.pkl"))
prod_pod = joblib.load(os.path.join(BACKEND, "podium_model.pkl"))
prod_win = joblib.load(os.path.join(BACKEND, "winner_model.pkl"))
race_t = P[["raceId", "year", "round"]].drop_duplicates().assign(t=lambda d: d.year * 100 + d["round"]).sort_values("t")
RACE_ORDER = list(race_t.raceId)


def clip(p):
    return np.clip(p, EPS, 1 - EPS)


# ── throwaway models through 2022 -> honest 2023-24 predictions ───
def fit_through_2022():
    tr = master[master.year <= 2022]
    X, ypod, ywin = tr[FEATURES], (tr.positionOrder <= 3).astype(int), (tr.positionOrder == 1).astype(int)
    pp = {k: v for k, v in prod_pod.get_params().items() if k != "missing"}
    wp = {k: v for k, v in prod_win.get_params().items() if k != "missing"}
    wp["scale_pos_weight"] = int((len(ywin) - ywin.sum()) / ywin.sum())  # as the notebook derived it
    m_pod = XGBClassifier(**pp).fit(X, ypod)
    m_win = XGBClassifier(**wp).fit(X, ywin)
    ho = master[(master.year >= 2023) & (master.year <= 2024)].copy()
    ho["p_pod"] = m_pod.predict_proba(ho[FEATURES])[:, 1]
    ho["p_win"] = np.minimum(m_win.predict_proba(ho[FEATURES])[:, 1], ho["p_pod"])
    ho["win"] = (ho.positionOrder == 1).astype(int)
    ho["pod"] = (ho.positionOrder <= 3).astype(int)
    return ho


HO = fit_through_2022()
print(f"calibration set: {len(HO)} rows / {HO.raceId.nunique()} races (2023-24) from throwaway models trained through 2022")


def logit(p):
    p = clip(np.asarray(p, float))
    return np.log(p / (1 - p)).reshape(-1, 1)


def fit_cal(kind, p, y):
    if kind == "platt":
        m = LogisticRegression(C=1e6, max_iter=1000).fit(logit(p), y)
        return lambda q: m.predict_proba(logit(q))[:, 1]
    m = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(np.asarray(p, float), y)
    return lambda q: m.predict(np.asarray(q, float))


CAL = {(k, t): fit_cal(k, HO["p_win"] if t == "win" else HO["p_pod"], HO["win"] if t == "win" else HO["pod"])
       for k in ("platt", "isotonic") for t in ("win", "pod")}


# ── normalisation / simulation helpers ───────────────────────────
def scale_to_sum(p, total):
    """Scale probabilities to sum to `total`, capping at 1 (bisection on the multiplier)."""
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


def pl_probs(w, sims=20000):
    """Plackett-Luce: P(win) exact; P(top3) by Gumbel-max simulation."""
    w = np.maximum(np.asarray(w, float), 1e-6)
    pw = w / w.sum()
    g = -np.log(-np.log(rng.random((sims, len(w)))))
    order = np.argsort(-(np.log(w)[None, :] + g), axis=1)[:, :3]
    pp = np.bincount(order.ravel(), minlength=len(w)) / sims
    return pw, pp


# ── build variants ───────────────────────────────────────────────
def per_race_apply(df, fn):
    out_w, out_p = np.empty(len(df)), np.empty(len(df))
    for rid, idx in df.groupby("raceId").indices.items():
        w, p = fn(df.iloc[idx])
        out_w[idx], out_p[idx] = w, p
    return out_w, out_p


def add(df, name, w, p):
    df[f"{name}__w"], df[f"{name}__p"] = w, p


def cv_calibrate(df, kind):
    """expanding window over races of this condition; only races >= BURN+1 get values."""
    w, p = np.full(len(df), np.nan), np.full(len(df), np.nan)
    order = [r for r in RACE_ORDER if r in set(df.raceId)]
    for i, rid in enumerate(order):
        if i < BURN:
            continue
        past = df[df.raceId.isin(order[:i])]
        cur = np.where(df.raceId.values == rid)[0]
        for tgt, arr, col, ycol in (("win", w, "p_win", "win"), ("pod", p, "p_pod", "pod")):
            f = fit_cal(kind, past[col].values, past[ycol].values)
            arr[cur] = f(df.iloc[cur][col].values)
    return w, p


conds = {}
for cond in ("a_real_grid", "b_predicted_quali"):
    df = P[P.cond == cond].reset_index(drop=True).copy()
    df["raw__w"], df["raw__p"] = df.p_win, df.p_pod
    add(df, "norm", *per_race_apply(df, lambda g: (scale_to_sum(g.p_win, 1), scale_to_sum(g.p_pod, 3))))
    for kind, tag in (("platt", "platt23"), ("isotonic", "iso23")):
        cw, cp = CAL[(kind, "win")](df.p_win.values), CAL[(kind, "pod")](df.p_pod.values)
        add(df, tag, cw, cp)
        df["_cw"], df["_cp"] = cw, cp
        add(df, tag + "+norm", *per_race_apply(df, lambda g: (scale_to_sum(g._cw, 1), scale_to_sum(g._cp, 3))))
    for kind, tag in (("platt", "cv_platt"), ("isotonic", "cv_iso")):
        add(df, tag, *cv_calibrate(df, kind))
    # Plackett-Luce from the raw scores. tau is a SENSITIVITY sweep, not a tuned choice.
    for tag, wfun in (("pl_podium_odds", lambda g: g.p_pod / (1 - np.minimum(g.p_pod, 1 - 1e-3))),
                      ("pl_win_score", lambda g: np.maximum(g.p_win, 1e-3)),
                      ("pl_win_score_sqrt", lambda g: np.sqrt(np.maximum(g.p_win, 1e-3)))):
        add(df, tag, *per_race_apply(df, lambda g, wf=wfun: pl_probs(wf(g).values)))
    add(df, "base_rate", df.base_win, df.base_pod)
    add(df, "prior_standings", df.prior_win_standings, df.prior_pod_standings)
    add(df, "prior_grid", df.prior_win_grid, df.prior_pod_grid)
    conds[cond] = df

# fresh-feature hybrid (b): master row features entering the race + predicted grid
b = conds["b_predicted_quali"]
pg = b.set_index(["raceId", "driverRef"])["grid"]
m = master[master.raceId.isin(b.raceId)].merge(b[["raceId", "driverRef"]], on=["raceId", "driverRef"]).copy()
m["grid"] = [pg[(r, d)] for r, d in zip(m.raceId, m.driverRef)]
pod = prod_pod.predict_proba(m[FEATURES])[:, 1]
win = np.minimum(prod_win.predict_proba(m[FEATURES])[:, 1], pod)
hy = m[["raceId", "driverRef"]].assign(h_w=win, h_p=pod)
b = b.merge(hy, on=["raceId", "driverRef"], how="left")
b["fresh_features__w"], b["fresh_features__p"] = b.h_w, b.h_p
conds["b_predicted_quali"] = b


# ── evaluation with bootstrap by race ────────────────────────────
def components(df, name, races):
    """per-race additive components (rows = races): n, se_w, se_p, ll_w, ll_p, sum_w, sum_p, 10-bin (n,sp,sy) x2."""
    rows = []
    for rid in races:
        g = df[df.raceId == rid]
        pw, pp = g[f"{name}__w"].values.astype(float), g[f"{name}__p"].values.astype(float)
        yw, yp = g.win.values, g.pod.values
        row = [len(g), ((pw - yw) ** 2).sum(), ((pp - yp) ** 2).sum(),
               -(yw * np.log(clip(pw)) + (1 - yw) * np.log(1 - clip(pw))).sum(),
               -(yp * np.log(clip(pp)) + (1 - yp) * np.log(1 - clip(pp))).sum(), pw.sum(), pp.sum()]
        for p_, y_ in ((pw, yw), (pp, yp)):
            bi = np.clip((p_ * 10).astype(int), 0, 9)
            for k in range(10):
                mk = bi == k
                row += [mk.sum(), p_[mk].sum(), y_[mk].sum()]
        rows.append(row)
    return np.array(rows, float)


def metrics(C):
    s = C.sum(0)
    n = s[0]

    def ece(off):
        bins = s[off:off + 30].reshape(10, 3)
        return float(np.abs(bins[:, 1] - bins[:, 2]).sum() / n)
    return dict(brier_win=s[1] / n, brier_pod=s[2] / n, ll_win=s[3] / n, ll_pod=s[4] / n,
                sum_win=s[5] / len(C), sum_pod=s[6] / len(C), ece_win=ece(7), ece_pod=ece(37))


def evaluate(df, names, races):
    comp = {nm: components(df, nm, races) for nm in names}
    idxs = [rng.integers(0, len(races), len(races)) for _ in range(B)]
    est = {nm: metrics(comp[nm]) for nm in names}
    draws = {nm: pd.DataFrame([metrics(comp[nm][ix]) for ix in idxs]) for nm in names}
    ci = {nm: {k: (float(draws[nm][k].quantile(.025)), float(draws[nm][k].quantile(.975))) for k in est[nm]} for nm in names}
    diff = {}
    for nm in names:
        if nm == "raw":
            continue
        diff[nm] = {k: (est[nm][k] - est["raw"][k], float((draws[nm][k] - draws["raw"][k]).quantile(.025)),
                        float((draws[nm][k] - draws["raw"][k]).quantile(.975)))
                    for k in ("brier_win", "brier_pod", "ece_win", "ece_pod")}
    # paired differences against the two simple probabilistic baselines (same race resamples)
    vs = {}
    for ref in ("prior_grid", "prior_standings"):
        vs[ref] = {}
        for nm in names:
            if nm == ref:
                continue
            vs[ref][nm] = {k: (est[nm][k] - est[ref][k], float((draws[nm][k] - draws[ref][k]).quantile(.025)),
                               float((draws[nm][k] - draws[ref][k]).quantile(.975))) for k in ("brier_win", "brier_pod")}
    return est, ci, diff, vs


results = {}
NAMES_ALL = ["raw", "norm", "platt23", "iso23", "platt23+norm", "iso23+norm", "pl_podium_odds", "pl_win_score",
             "pl_win_score_sqrt", "base_rate", "prior_standings", "prior_grid"]
for cond, df in conds.items():
    names_all = NAMES_ALL + (["fresh_features"] if cond.startswith("b_") else [])
    all_races = [r for r in RACE_ORDER if r in set(df.raceId)]
    late = all_races[BURN:]
    for scope, races, names in (("ALL_43", all_races, names_all), ("LATE_31", late, names_all + ["cv_platt", "cv_iso"])):
        est, ci, diff, vs = evaluate(df, names, races)
        results[f"{cond}|{scope}"] = dict(n_races=len(races), n_rows=int(sum((df.raceId == r).sum() for r in races)),
                                          est=est, ci=ci, diff_vs_raw=diff, diff_vs_baselines=vs)
        print(f"{cond} {scope}: races={len(races)} done")

json.dump(results, open(os.path.join(OUT, "experiments_results.json"), "w"), indent=1, default=float)
print("wrote analysis/out/experiments_results.json")
