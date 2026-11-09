#!/usr/bin/env python3
"""Complete uncertainty tables for docs/stage1/02-model-backtest.md.

(1) Reliability: for EVERY bin, n, mean predicted, observed rate, a Wilson 95% CI
    (treats driver-races as independent) and a 95% CI from a bootstrap that
    resamples whole RACES (accounts for the 20+ drivers of a race sharing one
    outcome structure; this is the one the document leans on).
(2) Winner-hit: for EVERY method x condition x scope, hits/races, rate, Wilson 95% CI
    and the bootstrap-by-race CI from analysis/out/backtest_results.json.

Reads analysis/out/backtest_rows.csv and backtest_results.json. Writes
analysis/out/reliability_ci.{json,md} and winner_hit_ci.{json,md}.
Run: python analysis/05_report_tables.py
"""
import json
import os

import numpy as np
import pandas as pd

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.environ.get("BACKTEST_OUT") or os.path.join(REPO, "analysis", "out")     # same switch as 02_backtest.py
B = 5000
rng = np.random.default_rng(20261104)
P = pd.read_csv(os.path.join(OUT, "backtest_rows.csv"))
R = json.load(open(os.path.join(OUT, "backtest_results.json")))["results"]


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


# ── (1) reliability ──────────────────────────────────────────────
rel = {}
md = []
for cond, label in (("a_real_grid", "(a) real grid"), ("b_predicted_quali", "(b) predicted quali")):
    g = P[P.cond == cond]
    races = sorted(g.raceId.unique())
    for what, pcol, ycol in (("win", "p_win", "win"), ("podium", "p_pod", "pod")):
        bins = np.clip((g[pcol].values * 10).astype(int), 0, 9)
        gg = g.assign(_bin=bins)
        # per-race, per-bin counts for the race bootstrap
        cnt = np.zeros((len(races), 10)); pos = np.zeros((len(races), 10))
        for i, r in enumerate(races):
            s = gg[gg.raceId == r]
            for b in range(10):
                m = s._bin == b
                cnt[i, b], pos[i, b] = m.sum(), s[ycol][m].sum()
        draws = np.full((B, 10), np.nan)
        for t in range(B):
            ix = rng.integers(0, len(races), len(races))
            n_, k_ = cnt[ix].sum(0), pos[ix].sum(0)
            draws[t] = np.where(n_ > 0, k_ / np.maximum(n_, 1), np.nan)
        rows = []
        for b in range(10):
            m = gg._bin == b
            n, k = int(m.sum()), int(gg[ycol][m].sum())
            wl, wh = wilson(k, n)
            col = draws[:, b][~np.isnan(draws[:, b])]
            rows.append(dict(bin=f"{b/10:.1f}-{(b+1)/10:.1f}", n=n, events=k, races_in_bin=int((cnt[:, b] > 0).sum()),
                             mean_pred=float(gg[pcol][m].mean()) if n else None,
                             observed=k / n if n else None, wilson_lo=wl, wilson_hi=wh,
                             boot_lo=float(np.quantile(col, .025)) if len(col) else None,
                             boot_hi=float(np.quantile(col, .975)) if len(col) else None))
        rel[f"{cond}|{what}"] = rows
        md.append(f"\n**{label}, {what} probability** ({len(g)} driver-races, {len(races)} races)\n")
        md.append("| bin | n | events | races | mean pred | observed | Wilson 95% | by-race bootstrap 95% |")
        md.append("|---|---|---|---|---|---|---|---|")
        for r_ in rows:
            f = lambda x: "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.3f}"
            md.append(f"| {r_['bin']} | {r_['n']} | {r_['events']} | {r_['races_in_bin']} | {f(r_['mean_pred'])} | {f(r_['observed'])} "
                      f"| [{f(r_['wilson_lo'])}, {f(r_['wilson_hi'])}] | [{f(r_['boot_lo'])}, {f(r_['boot_hi'])}] |")
json.dump(rel, open(os.path.join(OUT, "reliability_ci.json"), "w"), indent=1)
open(os.path.join(OUT, "reliability_ci.md"), "w", encoding="utf8").write("\n".join(md) + "\n")

# ── (2) winner-hit ───────────────────────────────────────────────
names = {"model": "model (argmax win_probability)", "prior_standings": "pre-race standings leader",
         "prior_constructor": "best constructor's top driver", "prior_grid": "grid leader (pole)"}
hit = {}
md = ["| condition | scope | method | hits / races | rate | Wilson 95% | by-race bootstrap 95% |", "|---|---|---|---|---|---|---|"]
for cond in ("a_real_grid", "b_predicted_quali"):
    for scope, lab in (("all_43", "all 43"), ("2025_24", "2025 (24)"), ("2026_19", "2026 R1-19 (19)")):
        r = R[f"{cond}|{scope}"]
        n = r["n_races"]
        for m, nm in names.items():
            v = r["metrics"][m]["hit"]
            k = int(round(v["est"] * n))
            wl, wh = wilson(k, n)
            hit[f"{cond}|{scope}|{m}"] = dict(hits=k, races=n, rate=v["est"], wilson=[wl, wh], boot=[v["lo"], v["hi"]])
            md.append(f"| {cond} | {lab} | {nm} | {k} / {n} | {v['est']*100:.1f}% | [{wl*100:.1f}, {wh*100:.1f}] "
                      f"| [{v['lo']*100:.1f}, {v['hi']*100:.1f}] |")
json.dump(hit, open(os.path.join(OUT, "winner_hit_ci.json"), "w"), indent=1)
open(os.path.join(OUT, "winner_hit_ci.md"), "w", encoding="utf8").write("\n".join(md) + "\n")
print("wrote reliability_ci.{json,md}, winner_hit_ci.{json,md}")
