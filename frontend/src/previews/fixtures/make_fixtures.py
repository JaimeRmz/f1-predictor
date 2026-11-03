#!/usr/bin/env python3
"""Generate the committed JSON fixtures for the Stage 2 design previews.

Everything is built LOCALLY: data/*.csv, the committed model artifacts run in-process (no API,
no Supabase, no network), and the Stage 1 analysis outputs in analysis/out/ (untracked on this
branch; they come from the docs/stage1-audit branch). The previews import these JSON files and
call nothing.

Run from the repo root:  python frontend/src/previews/fixtures/make_fixtures.py
"""
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, "backend"))
sys.path.insert(0, os.path.join(REPO, "backend", "scripts"))
AN = os.path.join(REPO, "analysis", "out")
NA = chr(92) + "N"

import lookups  # noqa: E402
import main  # noqa: E402
import championship  # noqa: E402
import season_data  # noqa: E402

COLORS = {"mercedes": "#00d2be", "ferrari": "#e10600", "mclaren": "#ff8000", "red_bull": "#3671c6", "alpine": "#0093cc",
          "rb": "#6692ff", "haas": "#b6babd", "williams": "#37bedd", "audi": "#b7babd", "aston_martin": "#358c75", "cadillac": "#c8102e"}
TEAM_NAME = {"mercedes": "Mercedes", "ferrari": "Ferrari", "mclaren": "McLaren", "red_bull": "Red Bull", "alpine": "Alpine", "rb": "Racing Bulls",
             "haas": "Haas", "williams": "Williams", "audi": "Audi", "aston_martin": "Aston Martin", "cadillac": "Cadillac"}

master = pd.read_csv(os.path.join(REPO, "data", "f1_master.csv"))
master["t"] = master.year * 100 + master["round"]
FULL = lookups.prepare_df(master.copy())
drivers = pd.read_csv(os.path.join(REPO, "data", "drivers.csv"))
constructors = pd.read_csv(os.path.join(REPO, "data", "constructors.csv"))
races = pd.read_csv(os.path.join(REPO, "data", "races.csv"))
results = pd.read_csv(os.path.join(REPO, "data", "results.csv"), na_values=[NA], keep_default_na=False)
dstand = pd.read_csv(os.path.join(REPO, "data", "driver_standings.csv"), na_values=[NA], keep_default_na=False)
code_of = dict(zip(drivers.driverRef, drivers.code))
name_of = {r.driverRef: f"{r.forename} {r.surname}" for r in drivers.itertuples()}
surname_of = {r.driverRef: r.surname for r in drivers.itertuples()}
ref_of_id = dict(zip(drivers.driverId, drivers.driverRef))
cref_of_id = dict(zip(constructors.constructorId, constructors.constructorRef))


def dump(name, obj):
    json.dump(obj, open(os.path.join(OUT, name), "w", encoding="utf8"), indent=1, ensure_ascii=False)
    print("wrote", name, os.path.getsize(os.path.join(OUT, name)), "bytes")


def scale_to_sum(p, total):
    p = np.asarray(p, float)
    lo, hi = 0.0, 1e6
    for _ in range(80):
        c = (lo + hi) / 2
        if np.minimum(1.0, c * p).sum() < total:
            lo = c
        else:
            hi = c
    return np.minimum(1.0, hi * p)


# ── models, in-process ────────────────────────────────────────────
B = os.path.join(REPO, "backend")
main.pd = pd
for n, f in (("podium_model", "podium_model.pkl"), ("winner_model", "winner_model.pkl"), ("quali_model", "quali_model.pkl"), ("features", "features.pkl"), ("quali_features", "quali_features.pkl")):
    setattr(main, n, joblib.load(os.path.join(B, f)))
main.STATE["models_ready"] = True
main.STATE["model_version"] = "m-a6621e96c549"


def install(df):
    L = lookups.compute_lookups(df)
    main.df = df
    for k in ("driver_last5_lookup", "driver_circuit_dcpr", "driver_circuit_quali_avg_lookup", "quali_constructor_season_avg", "quali_driver_season_avg",
              "quali_driver_last3_avg", "quali_driver_champ_pos", "quali_constructor_champ_pos"):
        setattr(main, k, L[k])


def team_color_for(ref, constructor_ref=None):
    if constructor_ref is None:
        constructor_ref = cref_of_id[FULL[FULL.driverRef == ref].sort_values("t").iloc[-1].constructorId]
    return constructor_ref, COLORS.get(constructor_ref, "#8a8a95"), TEAM_NAME.get(constructor_ref, constructor_ref)


# ── 1. next race: Brazil, with the model's pre-weekend scores ──────
install(FULL)
brazil = races[races.raceId == 1188].iloc[0]
roster = season_data.roster(2026)
raw = main.whatif_predict([{"driverRef": r, "grid": g} for r, g in roster], circuitRef="interlagos", auto_quali=True)
win = scale_to_sum([x["win_probability"] for x in raw], 1)
pod = scale_to_sum([x["podium_probability"] for x in raw], 3)
entries = []
for x, w, p in zip(raw, win, pod):
    cref, color, team = team_color_for(x["driverRef"])
    entries.append({"driverRef": x["driverRef"], "code": code_of[x["driverRef"]], "name": x["driver_name"], "team": team, "color": color,
                    "predicted_grid": int(x["grid"]), "win_score_raw": x["win_probability"], "podium_score_raw": x["podium_probability"],
                    "win_score": round(float(w), 4), "podium_score": round(float(p), 4)})
entries.sort(key=lambda e: (-e["podium_score"], -e["win_score"]))
for i, e in enumerate(entries, 1):
    e["rank"] = i
sessions = []
for k, label in (("fp1", "Practice 1"), ("fp2", "Practice 2"), ("fp3", "Practice 3"), ("quali", "Qualifying"), ("", "Race")):
    if k:
        d, t = brazil[f"{k}_date"], brazil[f"{k}_time"]
    else:
        d, t = brazil["date"], brazil["time"]
    sessions.append({"name": label, "utc": f"{d}T{t}Z"})
dump("next_race.json", {
    "raceId": 1188, "round": int(brazil["round"]), "name": brazil["name"], "circuit": "Interlagos", "location": "Sao Paulo, Brazil",
    "sessions": sessions, "forecast_kind": "pre_weekend", "as_of_round": 19, "model_version": "m-a6621e96c549",
    "score_note": "Model scores, rescaled per race so the win scores sum to 1 and the podium scores to 3. They are rankings, not calibrated probabilities.",
    "raw_sums": {"win": round(float(sum(x["win_probability"] for x in raw)), 3), "podium": round(float(sum(x["podium_probability"] for x in raw)), 3)},
    "entries": entries})

# ── 2. championship ────────────────────────────────────────────────
status = championship.championship_status(os.path.join(REPO, "data"), 2026)
d26 = master[master.year == 2026]
last_race = int(d26.raceId.max())
wins = dstand[dstand.raceId == last_race].set_index("driverId")["wins"].to_dict()
id_of_ref = dict(zip(drivers.driverRef, drivers.driverId))
cons = []
for c in status["drivers"]["contenders"]:
    ref = ref_of_id[int(c["id"])]
    cref, color, team = team_color_for(ref)
    cons.append({**c, "driverRef": ref, "code": code_of[ref], "color": color, "team": team, "wins": int(wins.get(int(c["id"]), 0))})
ccons = []
cname_to_ref = {r.name: r.constructorRef for r in constructors.itertuples()}
for c in status["constructors"]["contenders"]:
    cref = cref_of_id[int(c["id"])]
    ccons.append({**c, "constructorRef": cref, "color": COLORS.get(cref, "#8a8a95"), "team": TEAM_NAME.get(cref, c["name"])})
rid_by_round = races[races.year == 2026].set_index("round").raceId.to_dict()
top6 = [c["driverRef"] for c in cons[:6]]
history = {r: [] for r in top6}
rounds = sorted(r for r, rid in rid_by_round.items() if rid <= last_race)
for rnd in rounds:
    st = dstand[dstand.raceId == rid_by_round[rnd]].set_index("driverId").points.to_dict()
    for r in top6:
        history[r].append(float(st.get(id_of_ref[r], 0)))
dump("championship.json", {"as_of": status["as_of"], "total_rounds": status["total_rounds"], "rules": status["rules"],
                           "drivers": {**{k: v for k, v in status["drivers"].items() if k != "contenders"}, "contenders": cons},
                           "constructors": {**{k: v for k, v in status["constructors"].items() if k != "contenders"}, "contenders": ccons},
                           "history": {"rounds": rounds, "points": history}})

# ── 3. scorecard: the 14 snapshots, derived locally and cross-checked ──
STORED = {  # the 14 stored picks, as read from model_snapshots on 2026-11-02 (used ONLY to cross-check the local derivation)
    1169: "antonelli russell leclerc", 1170: "antonelli russell piastri", 1171: "antonelli russell leclerc", 1172: "antonelli leclerc russell",
    1173: "antonelli russell norris", 1174: "antonelli hamilton max_verstappen", 1175: "russell hamilton antonelli", 1176: "russell hamilton leclerc",
    1177: "antonelli hamilton leclerc", 1178: "antonelli max_verstappen russell", 1179: "antonelli russell hamilton", 1181: "russell antonelli norris",
    1182: "russell antonelli norris", 1183: "antonelli russell norris"}
GENUINE, BORDERLINE = {1179, 1181, 1183}, {1182}
bt = pd.read_csv(os.path.join(AN, "backtest_rows.csv"))


def pick(g):
    byp = g.sort_values(["p_pod", "p_win"], ascending=False)
    w = g.sort_values(["p_win", "p_pod"], ascending=False).iloc[0].driverRef
    rest = [d for d in byp.driverRef if d != w][:2]
    return [w] + rest, byp.driverRef.head(3).tolist()


win_of, podium_of = {}, {}
for rid, g in results[results.raceId >= 1169].groupby("raceId"):
    gg = g.sort_values("positionOrder"); podium_of[rid] = [ref_of_id[d] for d in gg.driverId.head(3)]; win_of[rid] = podium_of[rid][0]
card, mism = [], 0
for rid in sorted(set(results[results.raceId >= 1169].raceId)):
    rnd = int(races[races.raceId == rid].iloc[0]["round"]); nm = races[races.raceId == rid].iloc[0]["name"]
    item = {"raceId": int(rid), "round": rnd, "name": nm, "actual_top3": podium_of[rid], "actual_winner": win_of[rid]}
    if rid in STORED:
        cond = "b_predicted_quali" if rid in GENUINE | BORDERLINE else "a_real_grid"   # backfills used the real grid
        g = bt[(bt.cond == cond) & (bt.raceId == rid)]
        derived = " ".join(pick(g)[1])
        stored = STORED[rid].split()
        # stored p1 for backfills is the older podium-slot pick; compare as sets of three
        same = set(stored) == set(derived.split()) or set(stored) == set(pick(g)[0])
        mism += (not same)
        kind = "genuine foresight" if rid in GENUINE else ("after the cutoff" if rid in BORDERLINE else "backfilled after the race")
        item.update({"snapshot": "yes", "kind": kind, "model_top3": stored,
                     "model_winner": ("antonelli" if rid in (1181, 1182) else stored[0]),
                     "winner_hit": (("antonelli" if rid in (1181, 1182) else stored[0]) == win_of[rid]),
                     "podium_hits": len(set(stored) & set(podium_of[rid])), "derived_check_matches": bool(same)})
    else:
        item.update({"snapshot": "none", "kind": "no snapshot (cutoff missed)"})
    card.append(item)
print("scorecard: derived-vs-stored picks that do not match as sets:", mism, "of", len(STORED))
gen = [c for c in card if c.get("kind") == "genuine foresight"]
dump("scorecard.json", {"races": card, "genuine_ids": sorted(GENUINE), "n_snapshots": len(STORED),
                        "genuine_summary": {"n": len(gen), "winner_hits": int(sum(c["winner_hit"] for c in gen)), "podium_hits": [c["podium_hits"] for c in gen]},
                        "all_snapshots_winner_hits": int(sum(c.get("winner_hit", False) for c in card)),
                        "note": "Only 3 of the 14 saved snapshots were frozen before qualifying. Ten were backfilled after their races, one was taken after the cutoff, and five completed races have none."})

# ── 4. reliability: the Stage 1 backtest, condensed ────────────────
bres = json.load(open(os.path.join(AN, "backtest_results.json"), encoding="utf8"))
rel = json.load(open(os.path.join(AN, "reliability_ci.json"), encoding="utf8"))
exp = json.load(open(os.path.join(AN, "experiments_results.json"), encoding="utf8"))
hit = json.load(open(os.path.join(AN, "winner_hit_ci.json"), encoding="utf8"))
gs = json.load(open(os.path.join(AN, "grid_signal_experiment.json"), encoding="utf8"))
def m(cond, k):
    x = bres["results"][f"{cond}|all_43"]["metrics"]["model"]; return {"est": x[k]["est"], "lo": x[k]["lo"], "hi": x[k]["hi"]}
dump("reliability.json", {
    "n_races": 43, "n_rows_a": bres["results"]["a_real_grid|all_43"]["n_rows"], "n_rows_b": bres["results"]["b_predicted_quali|all_43"]["n_rows"],
    "sums": bres["sums"], "chance": bres["chance"],
    "winner_hit": {c: {k: hit[f"{c}|all_43|{k}"] for k in ("model", "prior_standings", "prior_constructor", "prior_grid")} for c in ("a_real_grid", "b_predicted_quali")},
    "brier": {c: {name: {"win": exp[f"{c}|ALL_43"]["est"][name]["brier_win"], "podium": exp[f"{c}|ALL_43"]["est"][name]["brier_pod"]}
                  for name in ("raw", "norm", "platt23+norm", "base_rate", "prior_standings", "prior_grid")} for c in ("a_real_grid", "b_predicted_quali")},
    "reliability_win": {c: rel[f"{c}|win"] for c in ("a_real_grid", "b_predicted_quali")},
    "reliability_podium": {c: rel[f"{c}|podium"] for c in ("a_real_grid", "b_predicted_quali")},
    "grid_quality": {"spearman_vs_real_grid": 0.737, "pole_hits": "7 of 43"},
    "source": "docs/stage1/02-model-backtest.md (43 out-of-sample races, 2025 + 2026 R1-19; intervals are bootstrap-by-race)"})

# ── 5. a completed race page: round 10, the Belgian GP (the last race with strategy data) ──
rid = 1178
rr = results[results.raceId == rid].sort_values("positionOrder")
strat = json.load(open(os.path.join(REPO, "data", "openf1_strategy", "1178.json"), encoding="utf8"))
brow = bt[bt.raceId == rid]
score_a = {}
for cond in ("a_real_grid", "b_predicted_quali"):
    g = brow[brow.cond == cond]
    w = scale_to_sum(g.p_win.values, 1); p = scale_to_sum(g.p_pod.values, 3)
    score_a[cond] = {d: (round(float(a), 4), round(float(b), 4)) for d, a, b in zip(g.driverRef, w, p)}
cls = []
total_laps = int(rr.laps.max())
for r in rr.itertuples():
    ref = ref_of_id[r.driverId]; cref = cref_of_id[r.constructorId]
    st = strat["drivers"].get(ref, {})
    cls.append({"pos": int(r.positionOrder), "driverRef": ref, "code": code_of[ref], "name": name_of[ref], "surname": surname_of[ref], "team": TEAM_NAME.get(cref, cref),
                "color": COLORS.get(cref, "#8a8a95"), "grid": int(r.grid) if pd.notna(r.grid) else None, "points": float(r.points), "laps": int(r.laps), "status": r.status if hasattr(r, "status") else "",
                "stints": [{"compound": s["compound"], "from": s["lap_start"], "to": s["lap_end"]} for s in st.get("stints", [])],
                "pit_laps": [p["lap"] for p in st.get("pits", [])],
                "model_real_grid": {"win_score": score_a["a_real_grid"].get(ref, [None, None])[0], "podium_score": score_a["a_real_grid"].get(ref, [None, None])[1]},
                "model_predicted_grid": {"win_score": score_a["b_predicted_quali"].get(ref, [None, None])[0], "podium_score": score_a["b_predicted_quali"].get(ref, [None, None])[1]}})
dump("race_1178.json", {"raceId": rid, "round": 10, "name": "Belgian Grand Prix", "date": strat["date"], "total_laps": total_laps, "safety_cars": strat["safety_cars"],
                        "classification": cls,
                        "note": "Round 10 is shown because tyre-strategy data exists only through round 10 (a known gap); model scores are the Part 1B backtest, rescaled per race."})

# ── 6. MOCK live session (deterministic; labelled MOCK in the UI) ──
rng = np.random.default_rng(2026)
order = [e["code"] for e in entries]            # start from the forecast order
meta = {e["code"]: {"name": e["name"], "team": e["team"], "color": e["color"]} for e in entries}
frames = []
cur = list(order)
lap = 1
RC = [(1, "GREEN LIGHT - PIT EXIT OPEN"), (3, "YELLOW IN SECTOR 2"), (4, "CLEAR"), (9, "VIRTUAL SAFETY CAR DEPLOYED"), (10, "VIRTUAL SAFETY CAR ENDING"), (11, "GREEN FLAG - RACING"),
      (14, "TURN 4: INCIDENT NOTED - CAR 14 (NO FURTHER ACTION)"), (18, "DRS ENABLED")]
for i in range(12):
    for _ in range(int(rng.integers(1, 4))):  # a few neighbouring swaps per frame
        j = int(rng.integers(0, len(cur) - 1)); cur[j], cur[j + 1] = cur[j + 1], cur[j]
    lap = 1 + i * 2
    frames.append({"lap": lap, "order": list(cur), "track_c": round(float(31 + 0.25 * i + rng.normal(0, 0.15)), 1), "air_c": round(float(24 + 0.1 * i + rng.normal(0, 0.1)), 1),
                   "humidity": int(round(58 - 0.5 * i)), "wind_ms": round(float(2.1 + rng.normal(0, 0.3)), 1), "rain": False,
                   "race_control": [{"lap": l, "msg": m} for l, m in RC if l <= lap]})
dump("live_mock.json", {"MOCK": True, "label": "MOCK DATA - NOT A REAL SESSION", "session": "Mock Race", "total_laps": 71, "drivers": meta, "frames": frames,
                        "state_rules": {"live_max_age_s": 10, "delayed_max_age_s": 90},
                        "note": "Generated locally with a fixed seed. Shows only positions, race control and weather: no gap timing and no track position dots."})

dump("meta.json", {"generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "data_through_round": 19, "model_version": "m-a6621e96c549",
                   "sources": ["data/*.csv", "committed model artifacts run locally", "docs/stage1 analysis outputs (analysis/out)"],
                   "calls_made_to_any_api": 0})
