#!/usr/bin/env python3
"""Old vs new predicted-grid backtest after the roll-forward fix (read-only; writes analysis/out/rolled/old_vs_new.{json,md}).

OLD = the figures published before the fix (analysis/out/history/pre-roll-forward/, copied from analysis/out/ before the re-run).
NEW = analysis/out/rolled/, produced by:
    BACKTEST_OUT=analysis/out/rolled BACKTEST_THROUGH_T=202619 python analysis/02_backtest.py
    BACKTEST_OUT=analysis/out/rolled python analysis/05_report_tables.py
Both cover the same 43 races (2025 + 2026 R1-R19), so the only difference is the code. Nothing here is typed by hand.
Intervals: the winner-hit table's Wilson 95% interval (the one the site shows) and the bootstrap-by-race 95% interval of backtest_results.json.
"""
import json
import os

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OLD = os.path.join(REPO, "analysis", "out", "history", "pre-roll-forward")
NEW = os.path.join(REPO, "analysis", "out", "rolled")
J = lambda d, f: json.load(open(os.path.join(d, f)))
oh, nh = J(OLD, "winner_hit_ci.json"), J(NEW, "winner_hit_ci.json")
orr, nr = J(OLD, "backtest_results.json")["results"], J(NEW, "backtest_results.json")["results"]
out = {"hit_table": {}, "metrics": {}}
lines = ["# Predicted-grid backtest, before and after the roll-forward fix", "",
         "Same 43 races (2025 + 2026 R1-R19); only the code differs. Winner-pick rows use the Wilson 95% interval the site shows; the bootstrap-by-race 95% interval is in brackets for the model rows.", "",
         "## Winner picked (hits / 43)", "", "| method | before | after |", "|---|---|---|"]
LABEL = {"model": "Model", "prior_standings": "Pick the points leader", "prior_constructor": "Pick the best team's lead driver", "prior_grid": "Pick the predicted pole sitter"}
for cond, cl in (("b_predicted_quali", "Before qualifying (predicted grid)"), ("a_real_grid", "After qualifying (real grid)")):
    lines += [f"| **{cl}** | | |"]
    for m, lab in LABEL.items():
        k = f"{cond}|all_43|{m}"
        a, b = oh[k], nh[k]
        out["hit_table"][k] = {"before": a, "after": b}
        f = lambda x: f"{x['hits']}/{x['races']} ({100 * x['rate']:.0f}%), {100 * x['wilson'][0]:.0f}-{100 * x['wilson'][1]:.0f}%"
        lines.append(f"| {lab} | {f(a)} | {f(b)} |")
lines += ["", "## Model quality, predicted-grid path (bootstrap-by-race 95% interval)", "", "| metric | before | after | difference |", "|---|---|---|---|"]
for key, lab, fmt in (("hit", "winner picked", "{:.3f}"), ("ov3", "top-3 overlap (of 3)", "{:.2f}"), ("brier_win", "Brier, win (lower is better)", "{:.4f}"),
                      ("brier_pod", "Brier, podium", "{:.4f}"), ("spearman", "rank correlation of the order", "{:.3f}")):
    a, b = orr["b_predicted_quali|all_43"]["metrics"]["model"][key], nr["b_predicted_quali|all_43"]["metrics"]["model"][key]
    out["metrics"][key] = {"before": a, "after": b}
    fm = lambda x: f"{fmt.format(x['est'])} [{fmt.format(x['lo'])}, {fmt.format(x['hi'])}]"
    lines.append(f"| {lab} | {fm(a)} | {fm(b)} | {fmt.format(b['est'] - a['est'])} |")
pv = nr["b_predicted_quali|all_43"].get("paired_vs_model", {})
open(os.path.join(NEW, "old_vs_new.json"), "w").write(json.dumps(out, indent=1, default=float))
open(os.path.join(NEW, "old_vs_new.md"), "w", encoding="utf8").write("\n".join(lines) + "\n")
print("\n".join(lines))
