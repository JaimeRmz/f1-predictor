#!/usr/bin/env python3
"""Chronological out-of-sample replay of the production models.

Races: all 2025 (24) and 2026 rounds 1-19 (19) = 43 races. The production models
were trained on year <= 2024, so every one of these is out of sample.

Two conditions per race, both running the REPO'S OWN prediction code in-process
(backend/main.py imported; no HTTP, no production access):
  (a) real grid   -> main.predict_race(raceId): features = the master row, which
                     01_pit_check.py verified is computable from prior races only.
  (b) predicted   -> main.whatif_predict(..., auto_quali=True): the path the
      quali          snapshot job uses. Run with df and lookups REBUILT FROM ONLY
                     THE RACES BEFORE EACH RACE (point-in-time), exactly as the
                     deployed service would have had them.

Baselines (see docs/stage1/02-model-backtest.md for definitions): pre-race
standings, grid order, constructor strength, constant base rate. The first three
also get a probabilistic form ("rank prior": historical win/podium frequency by
rank in 2010-2024) so Brier is comparable.

Run:  python analysis/02_backtest.py     (writes analysis/out/*)
READ-ONLY with respect to app code, data and model artifacts.
"""
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BACKEND = os.path.join(REPO, "backend")
OUT = os.path.join(REPO, "analysis", "out")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, BACKEND)
NA = chr(92) + "N"
EPS = 1e-4
B = 5000
rng = np.random.default_rng(20261102)

import lookups  # noqa: E402
import main  # noqa: E402  (imports FastAPI app object only; no model load until lifespan)

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
master["t"] = master["year"] * 100 + master["round"]

# DATA DEFECT (found by this audit): results.csv has grid = NULL for every driver of
# raceId 1167 (2025 Qatar GP), which prepare_df turns into grid 0 (= "pit lane") for
# all 20. Jolpica has the real grid. The data file is NOT modified (audit is read-only);
# the grid is patched IN MEMORY here from a cached Jolpica response so condition (a) is
# a fair test. Set PATCH_QATAR_GRID=0 to reproduce the unpatched numbers.
if os.environ.get("PATCH_QATAR_GRID", "1") == "1":
    cache = json.load(open(os.path.join(REPO, "analysis", "cache", "jolpica_2025_r23_results.json")))
    got = {x["Driver"]["driverId"]: int(x["grid"]) for x in cache["MRData"]["RaceTable"]["Races"][0]["Results"]}
    m1167 = master.raceId == 1167
    assert m1167.sum() == len(got) == 20 and set(master[m1167].driverRef) == set(got), "Qatar patch does not match the master's driver set"
    master.loc[m1167, "grid"] = master[m1167].driverRef.map(got)
    print("patched in memory: raceId 1167 grid from Jolpica cache (data file untouched)")
FULL = lookups.prepare_df(master.copy())

main.pd = pd
main.podium_model = joblib.load(os.path.join(BACKEND, "podium_model.pkl"))
main.winner_model = joblib.load(os.path.join(BACKEND, "winner_model.pkl"))
main.quali_model = joblib.load(os.path.join(BACKEND, "quali_model.pkl"))
main.features = joblib.load(os.path.join(BACKEND, "features.pkl"))
main.quali_features = joblib.load(os.path.join(BACKEND, "quali_features.pkl"))
main.STATE["models_ready"] = True


def install(df):
    """Point the production module's globals at `df` and lookups built from it."""
    L = lookups.compute_lookups(df)
    main.df = df
    main.driver_last5_lookup = L["driver_last5_lookup"]
    main.driver_circuit_dcpr = L["driver_circuit_dcpr"]
    main.driver_circuit_quali_avg_lookup = L["driver_circuit_quali_avg_lookup"]
    main.quali_constructor_season_avg = L["quali_constructor_season_avg"]
    main.quali_driver_season_avg = L["quali_driver_season_avg"]
    main.quali_driver_last3_avg = L["quali_driver_last3_avg"]
    main.quali_driver_champ_pos = L["quali_driver_champ_pos"]
    main.quali_constructor_champ_pos = L["quali_constructor_champ_pos"]


races = (master[(master.year == 2025) | ((master.year == 2026))][["raceId", "year", "round", "t", "circuitRef", "name_race"]]
         .drop_duplicates().sort_values("t"))
print(f"races to replay: {len(races)} ({(races.year == 2025).sum()} in 2025, {(races.year == 2026).sum()} in 2026)")

# ── replay ───────────────────────────────────────────────────────
rows, dropped = [], []
install(FULL)  # for condition (a)
for r in races.itertuples():
    rd_ = FULL[FULL.raceId == r.raceId]
    # (a) real grid: the production /predict code path
    a = main.predict_race(r.raceId)
    for x in a:
        rows.append(dict(cond="a_real_grid", raceId=r.raceId, year=r.year, round=r.round, driverRef=x["driverRef"],
                         grid=x["grid"], p_win=x["win_probability"], p_pod=x["podium_probability"]))
    # (b) predicted quali, point-in-time lookups: the production /whatif auto_quali code path
    install(lookups.prepare_df(master[master.t < r.t].copy()))
    entrants = [{"driverRef": d, "grid": int(g)} for d, g in zip(rd_["driverRef"], rd_["grid"])]
    b = main.whatif_predict(entrants, circuitRef=r.circuitRef, auto_quali=True)
    got = {x["driverRef"] for x in b}
    dropped += [dict(raceId=r.raceId, year=r.year, round=r.round, driverRef=d["driverRef"]) for d in entrants if d["driverRef"] not in got]
    for x in b:
        rows.append(dict(cond="b_predicted_quali", raceId=r.raceId, year=r.year, round=r.round, driverRef=x["driverRef"],
                         grid=x["grid"], p_win=x["win_probability"], p_pod=x["podium_probability"]))
    install(FULL)

pred = pd.DataFrame(rows)
act = FULL[["raceId", "driverRef", "constructorRef", "positionOrder", "grid"]].rename(columns={"grid": "real_grid"})
pred = pred.merge(act, on=["raceId", "driverRef"], how="left")
pred["win"] = (pred.positionOrder == 1).astype(int)
pred["pod"] = (pred.positionOrder <= 3).astype(int)
print(f"prediction rows: {len(pred)}  (a: {(pred.cond == 'a_real_grid').sum()}, b: {(pred.cond == 'b_predicted_quali').sum()});"
      f" drivers the (b) path could not predict (no history): {len(dropped)}")

# ── baselines: pre-race standings, constructor strength, grid ──────
dstand = pd.read_csv(os.path.join(REPO, "data", "driver_standings.csv"), na_values=[NA], keep_default_na=False)
cstand = pd.read_csv(os.path.join(REPO, "data", "constructor_standings.csv"), na_values=[NA], keep_default_na=False)
rc = pd.read_csv(os.path.join(REPO, "data", "races.csv"))
race_order = rc[["raceId", "year", "round"]].sort_values(["year", "round"]).reset_index(drop=True)
prev_race = {}
for i in range(1, len(race_order)):
    prev_race[race_order.raceId[i]] = race_order.raceId[i - 1]  # previous race overall: crosses season boundary at round 1


def prestanding_ranks(race_id, drivers_constructors):
    """driverRef -> (driver_rank, constructor_rank) from the standings published
    after the PREVIOUS race (previous season's final standings at round 1)."""
    prev = prev_race.get(race_id)
    d = dstand[dstand.raceId == prev].copy()
    c = cstand[cstand.raceId == prev].copy()
    d["points"] = pd.to_numeric(d["points"]); c["points"] = pd.to_numeric(c["points"])
    d["rk"] = d["points"].rank(ascending=False, method="min")
    c["rk"] = c["points"].rank(ascending=False, method="min")
    drank = dict(zip(d.driverId, d.rk)); crank = dict(zip(c.constructorId, c.rk))
    return drank, crank


ids = FULL[["raceId", "driverRef", "driverId", "constructorId"]]
FULLM = FULL.merge(rc[["raceId"]], on="raceId")


def rank_features(sub_master):
    """For every (race, driver) in sub_master: pre-race standings rank, constructor
    rank (ties broken by driver rank), real-grid rank. Ranks are over the full field."""
    out = []
    for rid, g in sub_master.groupby("raceId"):
        drank, crank = prestanding_ranks(rid, None)
        g = g.copy()
        g["d_rk"] = g["driverId"].map(drank).fillna(99.0)
        g["c_rk"] = g["constructorId"].map(crank).fillna(99.0)
        g["standings_rank"] = g["d_rk"].rank(method="first")
        g["constructor_rank"] = (g["c_rk"] * 1000 + g["d_rk"]).rank(method="first")
        gg = g["grid"].replace(0, 99)  # pit-lane start sorts last
        g["grid_rank"] = (gg * 1000 + g["d_rk"]).rank(method="first")
        out.append(g[["raceId", "driverRef", "standings_rank", "constructor_rank", "grid_rank"]])
    return pd.concat(out)


# rank priors from the training era (2010-2024): P(win / podium | rank), per ordering
train = FULL[(FULL.year >= 2010) & (FULL.year <= 2024)][["raceId", "driverRef", "driverId", "constructorId", "grid", "positionOrder"]]
tr = rank_features(train).merge(train[["raceId", "driverRef", "positionOrder"]], on=["raceId", "driverRef"])
tr["win"] = (tr.positionOrder == 1).astype(int); tr["pod"] = (tr.positionOrder <= 3).astype(int)
PRIOR = {}
for k in ("standings_rank", "constructor_rank", "grid_rank"):
    g = tr.groupby(k).agg(w=("win", "mean"), p=("pod", "mean"), n=("win", "size"))
    g = g[g.n >= 20]
    PRIOR[k] = (g.w.to_dict(), g.p.to_dict(), int(g.index.max()))

evalm = FULL[FULL.raceId.isin(races.raceId)][["raceId", "driverRef", "driverId", "constructorId", "grid"]]
rf = rank_features(evalm)
pred = pred.merge(rf, on=["raceId", "driverRef"], how="left")
# (b): "grid order" baseline uses the PREDICTED grid (what exists before qualifying)
b = pred.cond == "b_predicted_quali"
pred.loc[b, "grid_rank"] = pred[b].groupby("raceId")["grid"].rank(method="first")


def prior_prob(rank_col, which):
    w, p, mx = PRIOR[rank_col]
    tbl = w if which == "w" else p
    return pred[rank_col].clip(upper=mx).map(lambda k: tbl.get(int(k), tbl[mx]))


for k, tag in (("standings_rank", "standings"), ("constructor_rank", "constructor"), ("grid_rank", "grid")):
    pred[f"prior_win_{tag}"] = prior_prob(k, "w")
    pred[f"prior_pod_{tag}"] = prior_prob(k, "p")
pred["n_field"] = pred.groupby(["cond", "raceId"])["driverRef"].transform("size")
pred["base_win"] = 1.0 / pred["n_field"]
pred["base_pod"] = 3.0 / pred["n_field"]
pred.to_csv(os.path.join(OUT, "backtest_rows.csv"), index=False)
pd.DataFrame(dropped).to_csv(os.path.join(OUT, "backtest_dropped_no_history.csv"), index=False)

# ── per-race metric components ───────────────────────────────────
def clip(p):
    return np.clip(p, EPS, 1 - EPS)


def race_stats(g, pw, pp, order_key):
    """One race's additive components. order_key: lower = predicted better (or None)."""
    y_w, y_p = g.win.values, g.pod.values
    pw, pp = np.asarray(pw, float), np.asarray(pp, float)
    out = dict(n=len(g),
               se_win=((pw - y_w) ** 2).sum(), se_pod=((pp - y_p) ** 2).sum(),
               ll_win=-(y_w * np.log(clip(pw)) + (1 - y_w) * np.log(1 - clip(pw))).sum(),
               ll_pod=-(y_p * np.log(clip(pp)) + (1 - y_p) * np.log(1 - clip(pp))).sum(),
               sum_win=pw.sum(), sum_pod=pp.sum())
    if order_key is not None:
        o = np.asarray(order_key, float)
        top = np.argsort(o, kind="stable")
        out["hit"] = float(y_w[top[0]] == 1)
        out["ov3"] = float(y_p[top[:3]].sum())
        out["spearman"] = spearmanr(o, g.positionOrder.values).correlation  # low predicted rank <-> low finishing position
    return out


def methods_for(g, cond):
    """-> {method: (p_win, p_pod, order_key)} for one race's rows."""
    # model: order by podium prob desc, ties by win prob desc, then grid
    mkey = np.lexsort((g.grid.values, -g.p_win.values, -g.p_pod.values))
    mrank = np.empty(len(g)); mrank[mkey] = np.arange(1, len(g) + 1)
    # winner pick = argmax win_probability (ties: podium prob, then grid)
    wkey = np.lexsort((g.grid.values, -g.p_pod.values, -g.p_win.values))
    wrank = np.empty(len(g)); wrank[wkey] = np.arange(1, len(g) + 1)
    d = {"model": (g.p_win, g.p_pod, mrank),
         "base_rate": (g.base_win, g.base_pod, None),
         "prior_standings": (g.prior_win_standings, g.prior_pod_standings, g.standings_rank),
         "prior_constructor": (g.prior_win_constructor, g.prior_pod_constructor, g.constructor_rank),
         "prior_grid": (g.prior_win_grid, g.prior_pod_grid, g.grid_rank)}
    return d, wrank


per_race = {}
for cond in ("a_real_grid", "b_predicted_quali"):
    comp = {}
    for rid, g in pred[pred.cond == cond].groupby("raceId"):
        d, wrank = methods_for(g.reset_index(drop=True), cond)
        g = g.reset_index(drop=True)
        for m, (pw, pp, ok) in d.items():
            st = race_stats(g, pw, pp, ok)
            if m == "model":  # winner hit is by argmax(win_probability), not by podium order
                st["hit"] = float(g.win.values[np.argmin(wrank)] == 1)
            st["raceId"] = rid; st["year"] = int(g.year.iloc[0])
            comp.setdefault(m, []).append(st)
    per_race[cond] = {m: pd.DataFrame(v).set_index("raceId") for m, v in comp.items()}

# ── bootstrap by race ────────────────────────────────────────────
def pooled(df, idx, num, den="n"):
    s = df.iloc[idx]
    return s[num].sum() / s[den].sum()


def summarize(df, idx):
    out = {"brier_win": pooled(df, idx, "se_win"), "brier_pod": pooled(df, idx, "se_pod"),
           "ll_win": pooled(df, idx, "ll_win"), "ll_pod": pooled(df, idx, "ll_pod"),
           "sum_win": df.iloc[idx]["sum_win"].mean(), "sum_pod": df.iloc[idx]["sum_pod"].mean()}
    for k in ("hit", "ov3", "spearman"):
        if k in df:
            out[k] = df.iloc[idx][k].mean()
    return out


def boot(df_by_method, methods, n_races, subset=None):
    """-> point estimates + 95% CI per method per metric, and paired diffs vs model."""
    base = np.arange(n_races)
    pts = {m: summarize(df_by_method[m], base) for m in methods}
    draws = {m: [] for m in methods}
    for _ in range(B):
        idx = rng.integers(0, n_races, n_races)
        for m in methods:
            draws[m].append(summarize(df_by_method[m], idx))
    res = {}
    for m in methods:
        dd = pd.DataFrame(draws[m])
        res[m] = {k: dict(est=pts[m][k], lo=float(dd[k].quantile(.025)), hi=float(dd[k].quantile(.975))) for k in pts[m]}
    diffs = {}
    for m in methods:
        if m == "model":
            continue
        dm, dmod = pd.DataFrame(draws[m]), pd.DataFrame(draws["model"])
        diffs[m] = {}
        for k in pts[m]:
            if k in ("sum_win", "sum_pod"):
                continue
            d = dmod[k] - dm[k]  # model minus baseline (same resamples)
            diffs[m][k] = dict(est=pts["model"][k] - pts[m][k], lo=float(d.quantile(.025)), hi=float(d.quantile(.975)))
    return res, diffs


results = {}
METHODS = ["model", "base_rate", "prior_standings", "prior_constructor", "prior_grid"]
for cond in per_race:
    for scope, filt in (("all_43", lambda y: True), ("2025_24", lambda y: y == 2025), ("2026_19", lambda y: y == 2026)):
        dfs = {}
        for m in METHODS:
            d = per_race[cond][m]
            dfs[m] = d[[filt(y) for y in d.year]].sort_index()
        n_races = len(dfs["model"])
        res, diffs = boot(dfs, METHODS, n_races)
        results[f"{cond}|{scope}"] = dict(n_races=n_races, n_rows=int(dfs["model"].n.sum()), metrics=res, paired_vs_model=diffs)

# ── reliability (pooled, 10 equal-width bins) ────────────────────
def reliability(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    rows = []
    for b_ in range(bins):
        m = idx == b_
        n = int(m.sum())
        rows.append(dict(bin=f"{edges[b_]:.1f}-{edges[b_+1]:.1f}", n=n,
                         mean_pred=float(p[m].mean()) if n else None, observed=float(y[m].mean()) if n else None))
    return rows


rel = {}
for cond in ("a_real_grid", "b_predicted_quali"):
    g = pred[pred.cond == cond]
    rel[cond] = {"win": reliability(g.p_win.values, g.win.values), "podium": reliability(g.p_pod.values, g.pod.values)}

# ── per-race probability sums ────────────────────────────────────
sums = {}
for cond in per_race:
    d = per_race[cond]["model"]
    sums[cond] = {"win": dict(mean=d.sum_win.mean(), min=d.sum_win.min(), max=d.sum_win.max()),
                  "podium": dict(mean=d.sum_pod.mean(), min=d.sum_pod.min(), max=d.sum_pod.max()),
                  "n_races": len(d)}
    d[["year", "n", "sum_win", "sum_pod"]].to_csv(os.path.join(OUT, f"backtest_sums_{cond}.csv"))

# expected values of a RANDOM ordering, for reading hit rate / overlap against chance
chance = {}
for cond in per_race:
    nf = per_race[cond]["model"].n
    chance[cond] = dict(hit=float((1.0 / nf).mean()), ov3=float((9.0 / nf).mean()))

json.dump(dict(results=results, reliability=rel, sums=sums, chance=chance,
               n_dropped_no_history=len(dropped), bootstrap_reps=B, eps_logloss=EPS),
          open(os.path.join(OUT, "backtest_results.json"), "w"), indent=1, default=float)
print("done -> analysis/out/backtest_results.json, backtest_rows.csv")
