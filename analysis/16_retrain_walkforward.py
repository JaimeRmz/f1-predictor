#!/usr/bin/env python3
"""Walk-forward retrain experiment (throwaway models; production artifacts untouched).

Question: the production models are trained once on year <= 2024. Does retraining on more
recent data help on the 43 out-of-sample races (2025 + 2026 R1-19)?

For EACH of the 43 races, models are trained ONLY on races strictly before it (so every
prediction is genuinely out of sample, and the 2026 regulation change is handled the way it
would be in real life: the first new-regime races enter training only as they happen):

  V0  production            trained once on year <= 2024 (the Part 1B rows, not retrained)
  V1  expanding             all races since 2010 before the target race
  V2  recent only           2022 (start of the ground-effect era) onward, before the target race
  V3  expanding, recency    all races since 2010, sample weight 0.5 ** ((target_year - year) / 3)
                            (half-life 3 seasons, DECLARED IN ADVANCE)
      sensitivity (reported, never selected): half-life 1.5 (V3a) and 6 (V3b)

Same hyperparameters as production (read from the committed pickles); the winner model's
scale_pos_weight is recomputed per training set as the notebook did (int(neg/pos)). The qualifying
model is retrained the same way, so the predicted-grid path is retrained end to end.

Both Part 1B conditions, through the repo's own code (backend/main.py in-process):
  (a) real grid     main.predict_race
  (b) predicted     main.whatif_predict(auto_quali=True) with data and lookups rebuilt from only the
      grid          races before the target race

Metrics and intervals as Part 1B (Brier, log loss, ECE, per-race sums, winner hit, top-3 overlap,
Spearman; bootstrap-by-race 95% CIs; differences vs production are PAIRED).

Run: python analysis/16_retrain_walkforward.py    (about 10 minutes; writes analysis/out/retrain_*)
"""
import json
import os
import sys
import time

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from xgboost import XGBClassifier, XGBRegressor

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BACKEND, OUT = os.path.join(REPO, "backend"), os.path.join(REPO, "analysis", "out")
sys.path.insert(0, BACKEND)
EPS, B = 1e-4, 5000
rng = np.random.default_rng(20261108)
import lookups  # noqa: E402
import main  # noqa: E402

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
# same in-memory Qatar patch as Part 1B (the data fix lives on fix/data-qatar-grid, not merged yet)
cache = json.load(open(os.path.join(REPO, "analysis", "cache", "jolpica_2025_r23_results.json"), encoding="utf8"))
got = {x["Driver"]["driverId"]: int(x["grid"]) for x in cache["MRData"]["RaceTable"]["Races"][0]["Results"]}
m1167 = master.raceId == 1167
if master.loc[m1167, "grid"].isna().all():
    master.loc[m1167, "grid"] = master[m1167].driverRef.map(got)
master["t"] = master.year * 100 + master["round"]
FULL = lookups.prepare_df(master.copy())

prod = {n: joblib.load(os.path.join(BACKEND, f)) for n, f in (("podium", "podium_model.pkl"), ("winner", "winner_model.pkl"), ("quali", "quali_model.pkl"))}
FEATURES = joblib.load(os.path.join(BACKEND, "features.pkl"))
QFEATURES = joblib.load(os.path.join(BACKEND, "quali_features.pkl"))
P_POD = {k: v for k, v in prod["podium"].get_params().items() if k != "missing"}
P_WIN = {k: v for k, v in prod["winner"].get_params().items() if k != "missing"}
P_Q = {k: v for k, v in prod["quali"].get_params().items() if k != "missing"}

main.pd = pd
main.features, main.quali_features = FEATURES, QFEATURES
main.STATE["models_ready"] = True


def install_data(df):
    L = lookups.compute_lookups(df)
    main.df = df
    for k in ("driver_last5_lookup", "driver_circuit_dcpr", "driver_circuit_quali_avg_lookup", "quali_constructor_season_avg",
              "quali_driver_season_avg", "quali_driver_last3_avg", "quali_driver_champ_pos", "quali_constructor_champ_pos"):
        setattr(main, k, L[k])


VARIANTS = {  # name -> (min_year, half_life or None)
    "V1 expanding": (2010, None),
    "V2 recent only (2022+)": (2022, None),
    "V3 expanding + recency (half-life 3)": (2010, 3.0),
    "V3a recency half-life 1.5 (sensitivity)": (2010, 1.5),
    "V3b recency half-life 6 (sensitivity)": (2010, 6.0),
}


def fit_models(train, target_year, min_year, half_life):
    tr = train[train.year >= min_year]
    w = None if half_life is None else (0.5 ** ((target_year - tr.year.values) / half_life))
    y_pod = (tr.positionOrder <= 3).astype(int).values
    y_win = (tr.positionOrder == 1).astype(int).values
    pw = dict(P_WIN); pw["scale_pos_weight"] = int((len(y_win) - y_win.sum()) / y_win.sum())
    mp = XGBClassifier(**P_POD).fit(tr[FEATURES], y_pod, sample_weight=w)
    mw = XGBClassifier(**pw).fit(tr[FEATURES], y_win, sample_weight=w)
    mq = XGBRegressor(**P_Q).fit(tr[QFEATURES], tr["quali_position"].values, sample_weight=w)
    return mp, mw, mq, len(tr)


races = master[master.year >= 2025][["raceId", "year", "round", "t", "circuitRef"]].drop_duplicates().sort_values("t")
SMOKE = os.environ.get("SMOKE") == "1"   # 2 races, tiny bootstrap: a wiring check only, writes nothing permanent
if SMOKE:
    races = races.head(2); B = 50
rows, sizes = [], []
t0 = time.time()
install_data(FULL)
for k, r in enumerate(races.itertuples(), 1):
    train = FULL[FULL.t < r.t]
    ent_rows = FULL[FULL.raceId == r.raceId]
    entrants = [{"driverRef": d, "grid": int(g)} for d, g in zip(ent_rows.driverRef, ent_rows.grid)]
    trunc = lookups.prepare_df(master[master.t < r.t].copy())
    for vname, (miny, hl) in VARIANTS.items():
        mp, mw, mq, n_train = fit_models(train, r.year, miny, hl)
        sizes.append(dict(variant=vname, raceId=r.raceId, n_train=n_train))
        main.podium_model, main.winner_model, main.quali_model = mp, mw, mq
        install_data(FULL)
        for x in main.predict_race(r.raceId):
            rows.append(dict(variant=vname, cond="a_real_grid", raceId=r.raceId, year=r.year, driverRef=x["driverRef"], grid=x["grid"], p_win=x["win_probability"], p_pod=x["podium_probability"]))
        install_data(trunc)
        for x in main.whatif_predict(entrants, circuitRef=r.circuitRef, auto_quali=True):
            rows.append(dict(variant=vname, cond="b_predicted_quali", raceId=r.raceId, year=r.year, driverRef=x["driverRef"], grid=x["grid"], p_win=x["win_probability"], p_pod=x["podium_probability"]))
        install_data(FULL)
    if k % 5 == 0:
        print(f"  race {k}/{len(races)} done, {time.time() - t0:.0f}s elapsed", flush=True)

pred = pd.DataFrame(rows)
# production (V0) rows come from the Part 1B backtest, unchanged
gold = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))[["cond", "raceId", "year", "driverRef", "grid", "p_win", "p_pod"]].assign(variant="V0 production (trained once, year <= 2024)")
gold = gold[gold.raceId.isin(races.raceId)]
pred = pd.concat([gold, pred], ignore_index=True)
act = FULL[["raceId", "driverRef", "positionOrder"]]
pred = pred.merge(act, on=["raceId", "driverRef"], how="left")
pred["win"] = (pred.positionOrder == 1).astype(int); pred["pod"] = (pred.positionOrder <= 3).astype(int)
sfx = "_smoke" if SMOKE else ""
pred.to_csv(os.path.join(OUT, f"retrain_rows{sfx}.csv"), index=False)
pd.DataFrame(sizes).to_csv(os.path.join(OUT, f"retrain_training_sizes{sfx}.csv"), index=False)


def clip(p):
    return np.clip(p, EPS, 1 - EPS)


def race_vec(g):
    """additive per-race components for one (variant, cond, race)."""
    pw, pp, yw, yp = g.p_win.values.astype(float), g.p_pod.values.astype(float), g.win.values, g.pod.values
    mkey = np.lexsort((g.grid.values, -pw, -pp)); mrank = np.empty(len(g)); mrank[mkey] = np.arange(1, len(g) + 1)
    wkey = np.lexsort((g.grid.values, -pp, -pw))
    v = [len(g), ((pw - yw) ** 2).sum(), ((pp - yp) ** 2).sum(),
         -(yw * np.log(clip(pw)) + (1 - yw) * np.log(1 - clip(pw))).sum(), -(yp * np.log(clip(pp)) + (1 - yp) * np.log(1 - clip(pp))).sum(),
         pw.sum(), pp.sum(), float(yw[wkey[0]] == 1), float(yp[mkey[:3]].sum()), float(spearmanr(mrank, g.positionOrder.values).correlation)]
    for p_, y_ in ((pw, yw), (pp, yp)):
        bi = np.clip((p_ * 10).astype(int), 0, 9)
        for b in range(10):
            mk = bi == b; v += [mk.sum(), p_[mk].sum(), y_[mk].sum()]
    return v


NAMES = ["n", "se_w", "se_p", "ll_w", "ll_p", "sum_w", "sum_p", "hit", "ov3", "rho"]


def summ(C):
    n = C[:, 0].sum()
    def ece(off): s = C[:, off:off + 30].sum(0).reshape(10, 3); return float(np.abs(s[:, 1] - s[:, 2]).sum() / n)
    return dict(brier_win=C[:, 1].sum() / n, brier_pod=C[:, 2].sum() / n, ll_win=C[:, 3].sum() / n, ll_pod=C[:, 4].sum() / n,
                sum_win=C[:, 5].mean(), sum_pod=C[:, 6].mean(), hit=C[:, 7].mean(), ov3=C[:, 8].mean(), rho=C[:, 9].mean(),
                ece_win=ece(10), ece_pod=ece(40))


results = {}
prod_name = "V0 production (trained once, year <= 2024)"
for cond in ("a_real_grid", "b_predicted_quali"):
    comp = {}
    for vname in [prod_name] + list(VARIANTS):
        g = pred[(pred.variant == vname) & (pred.cond == cond)]
        comp[vname] = {rid: race_vec(gr.reset_index(drop=True)) for rid, gr in g.groupby("raceId")}
    all_ids = sorted(comp[prod_name])
    year_of = pred.drop_duplicates("raceId").set_index("raceId").year
    for scope, ids in (("all_43", all_ids), ("2025_24", [i for i in all_ids if year_of[i] == 2025]), ("2026_19", [i for i in all_ids if year_of[i] == 2026])):
        if not ids:
            continue
        arr = {v: np.array([comp[v][i] for i in ids], float) for v in comp}
        idxs = [rng.integers(0, len(ids), len(ids)) for _ in range(B)]
        draws = {v: pd.DataFrame([summ(arr[v][ix]) for ix in idxs]) for v in arr}
        est = {v: summ(arr[v]) for v in arr}
        out = {}
        for v in arr:
            out[v] = {"est": est[v], "ci": {k: (float(draws[v][k].quantile(.025)), float(draws[v][k].quantile(.975))) for k in est[v]}}
            if v != prod_name:
                out[v]["paired_vs_prod"] = {k: (est[v][k] - est[prod_name][k], float((draws[v][k] - draws[prod_name][k]).quantile(.025)), float((draws[v][k] - draws[prod_name][k]).quantile(.975)))
                                            for k in ("brier_win", "brier_pod", "ll_win", "ll_pod", "ece_win", "ece_pod", "hit", "ov3", "rho", "sum_win", "sum_pod")}
        results[f"{cond}|{scope}"] = {"n_races": len(ids), "n_rows": int(arr[prod_name][:, 0].sum()), "variants": out}
json.dump(results, open(os.path.join(OUT, f"retrain_results{sfx}.json"), "w"), indent=1, default=float)
sz = pd.DataFrame(sizes)
print("\ntraining rows per race (min / max):", {v: (int(g.n_train.min()), int(g.n_train.max())) for v, g in sz.groupby("variant")})
print("done in %.0fs -> analysis/out/retrain_results.json" % (time.time() - t0))
