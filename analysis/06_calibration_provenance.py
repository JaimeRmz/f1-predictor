#!/usr/bin/env python3
"""Does it matter WHICH predictions a calibrator is fit on?

The production models were trained on year <= 2024, so their predictions for 2023-24
are IN-SAMPLE (the model saw those outcomes) and cannot be used to fit a calibrator
honestly. The audit instead fit calibrators on predictions of throwaway models trained
only through 2022, for 2023-24 (a temporal holdout: out of sample for THAT model; not
cross-validation, not in-sample). This script quantifies how much that choice matters
by fitting calibrators three ways and scoring each on the SAME 2025-26 real-grid
production scores (condition a, 43 races, 897 driver-races):

  V1 holdout23_24    models trained <= 2022, predicting 2023-24      (what 03_experiments.py used)
  V2 insample23_24   PRODUCTION models predicting 2023-24             (in-sample: the leaky shortcut)
  V3 rolling_origin  for each year Y in 2015..2024: models trained on years < Y predicting Y
                     (10 seasons of honestly out-of-sample predictions, every row held out
                     with respect to the model that scored it; expanding-window time-series CV)

Reads analysis/out/backtest_rows.csv; writes analysis/out/calibration_provenance.json.
Nothing is written to backend/ or data/.   Run: python analysis/06_calibration_provenance.py
"""
import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BACKEND, OUT = os.path.join(REPO, "backend"), os.path.join(REPO, "analysis", "out")
EPS, B = 1e-4, 3000
rng = np.random.default_rng(20261105)

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
FEATURES = joblib.load(os.path.join(BACKEND, "features.pkl"))
prod_pod = joblib.load(os.path.join(BACKEND, "podium_model.pkl"))
prod_win = joblib.load(os.path.join(BACKEND, "winner_model.pkl"))
P = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))
A = P[P.cond == "a_real_grid"].reset_index(drop=True)
master["win"] = (master.positionOrder == 1).astype(int)
master["pod"] = (master.positionOrder <= 3).astype(int)


def train_predict(train_mask, pred_mask, tag):
    """Fit podium+winner models (production hyperparameters) on train_mask rows,
    return predictions for pred_mask rows. Asserts no overlap in time."""
    tr, te = master[train_mask], master[pred_mask]
    assert tr.year.max() < te.year.min(), f"{tag}: training years must precede predicted years"
    pp = {k: v for k, v in prod_pod.get_params().items() if k != "missing"}
    wp = {k: v for k, v in prod_win.get_params().items() if k != "missing"}
    wp["scale_pos_weight"] = int((len(tr) - tr.win.sum()) / tr.win.sum())
    mp = XGBClassifier(**pp).fit(tr[FEATURES], tr.pod)
    mw = XGBClassifier(**wp).fit(tr[FEATURES], tr.win)
    out = te[["year", "raceId", "win", "pod"]].copy()
    out["p_pod"] = mp.predict_proba(te[FEATURES])[:, 1]
    out["p_win"] = np.minimum(mw.predict_proba(te[FEATURES])[:, 1], out.p_pod)
    return out


cal_sets = {}
cal_sets["V1 holdout 2023-24 (models <=2022)"] = train_predict(master.year <= 2022, master.year.between(2023, 2024), "V1")
# V2: the PRODUCTION models scoring years they were trained on
v2 = master[master.year.between(2023, 2024)][["year", "raceId", "win", "pod"]].copy()
v2["p_pod"] = prod_pod.predict_proba(master.loc[v2.index, FEATURES])[:, 1]
v2["p_win"] = np.minimum(prod_win.predict_proba(master.loc[v2.index, FEATURES])[:, 1], v2.p_pod)
cal_sets["V2 in-sample 2023-24 (production models)"] = v2
parts = [train_predict(master.year < y, master.year == y, f"V3-{y}") for y in range(2015, 2025)]
cal_sets["V3 rolling-origin 2015-2024"] = pd.concat(parts)
for k, v in cal_sets.items():
    print(f"{k}: {len(v)} rows / {v.raceId.nunique()} races; mean podium score {v.p_pod.mean():.3f} vs podium rate {v.pod.mean():.3f}")


def clip(p):
    return np.clip(np.asarray(p, float), EPS, 1 - EPS)


def lg(p):
    q = clip(p)
    return np.log(q / (1 - q)).reshape(-1, 1)


def fit(kind, p, y):
    if kind == "platt":
        m = LogisticRegression(C=1e6, max_iter=2000).fit(lg(p), y)
        return lambda q: m.predict_proba(lg(q))[:, 1]
    m = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(np.asarray(p, float), y)
    return lambda q: m.predict(np.asarray(q, float))


races = sorted(A.raceId.unique())
idx_by_race = {r: np.where(A.raceId.values == r)[0] for r in races}


def per_race_components(pw, pp):
    rows = []
    for r in races:
        ix = idx_by_race[r]
        yw, yp = A.win.values[ix], A.pod.values[ix]
        w, p = pw[ix], pp[ix]
        rows.append([len(ix), ((w - yw) ** 2).sum(), ((p - yp) ** 2).sum(), w.sum(), p.sum()])
    return np.array(rows, float)


def stats(C):
    s = C.sum(0)
    return dict(brier_win=s[1] / s[0], brier_pod=s[2] / s[0], sum_win=s[3] / len(C), sum_pod=s[4] / len(C))


comps = {"raw (production scores)": per_race_components(A.p_win.values, A.p_pod.values)}
for name, cs in cal_sets.items():
    for kind in ("platt", "isotonic"):
        fw, fp = fit(kind, cs.p_win, cs.win), fit(kind, cs.p_pod, cs.pod)
        comps[f"{name} | {kind}"] = per_race_components(fw(A.p_win.values), fp(A.p_pod.values))

ref = "V1 holdout 2023-24 (models <=2022) | platt"
idxs = [rng.integers(0, len(races), len(races)) for _ in range(B)]
draws = {k: pd.DataFrame([stats(C[ix]) for ix in idxs]) for k, C in comps.items()}
res = {}
print(f"\nscored on 2025-26 real-grid production scores: {len(races)} races, {len(A)} driver-races")
print(f"{'calibration data | method':<62}{'Brier win':>20}{'Brier pod':>20}{'sums':>11}   vs V1-Platt (win / podium)")
for k, C in comps.items():
    e = stats(C)
    d = draws[k]
    lo_w, hi_w = d.brier_win.quantile(.025), d.brier_win.quantile(.975)
    lo_p, hi_p = d.brier_pod.quantile(.025), d.brier_pod.quantile(.975)
    dw = dp = None
    if k != ref:
        dw = (e["brier_win"] - stats(comps[ref])["brier_win"], (d.brier_win - draws[ref].brier_win).quantile(.025), (d.brier_win - draws[ref].brier_win).quantile(.975))
        dp = (e["brier_pod"] - stats(comps[ref])["brier_pod"], (d.brier_pod - draws[ref].brier_pod).quantile(.025), (d.brier_pod - draws[ref].brier_pod).quantile(.975))
    res[k] = dict(est=e, win_ci=[lo_w, hi_w], pod_ci=[lo_p, hi_p], diff_vs_V1_platt=dict(win=dw, pod=dp))
    ds = "" if dw is None else f"{dw[0]:+.4f} [{dw[1]:+.4f},{dw[2]:+.4f}] / {dp[0]:+.4f} [{dp[1]:+.4f},{dp[2]:+.4f}]"
    print(f"{k:<62}{e['brier_win']:.4f} [{lo_w:.4f},{hi_w:.4f}]  {e['brier_pod']:.4f} [{lo_p:.4f},{hi_p:.4f}]  {e['sum_win']:.2f}/{e['sum_pod']:.2f}   {ds}")
res["_calibration_set_sizes"] = {k: dict(rows=int(len(v)), races=int(v.raceId.nunique())) for k, v in cal_sets.items()}
json.dump(res, open(os.path.join(OUT, "calibration_provenance.json"), "w"), indent=1, default=float)
