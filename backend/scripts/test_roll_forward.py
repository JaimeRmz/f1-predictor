#!/usr/bin/env python3
"""Tests for the roll-forward features (lookups.roll_forward_features) and everything that depends on them.

    python backend/scripts/test_roll_forward.py        (offline; reads data/*.csv and the committed model pickles; no network)

(a) parity     for every race in the 44-race set (2025 + 2026 R1-R20), roll_forward_features(master[t<N]) with the race's own entry list
               equals the master's row-N values on all 12 rolled features, team switches included.
(b) no leakage altering the results of race N or any later race changes nothing (as_of_t); and the same alteration WITHOUT the cutoff
               does change the output, so the test can fail.
(c) edge cases season rollover, a driver with one row (Camara), a driver with no history (dropped), an entry with no constructor
               (rejected), a new constructor, a team switch taken from the entry list, team-name aliases.
(d) end-to-end main.whatif_predict (the real endpoint function) with data only before race N equals the model run on the master's
               own row-N features with the predicted grid, for every race.
(e) provenance /meta says which race the features are entering; the snapshot script tags the pick whatif_auto_quali_rolled, sends the
               constructor, and refuses an API that does not report the roll-forward.
"""
import os
import sys

import joblib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
BACKEND = os.path.join(REPO, "backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, HERE)

import lookups as LK  # noqa: E402
import main  # noqa: E402  (FastAPI app object only; models are loaded below, not through the lifespan)

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        failures.append(name)


data = os.path.join(REPO, "data")
master = pd.read_csv(os.path.join(data, "f1_master.csv"))
master["t"] = master["year"] * 100 + master["round"]
dstand = pd.read_csv(os.path.join(data, "driver_standings.csv"))
cstand = pd.read_csv(os.path.join(data, "constructor_standings.csv"))
races = (master[master["year"] >= 2025][["raceId", "year", "round", "t", "circuitRef", "name_race"]]
         .drop_duplicates().sort_values("t").reset_index(drop=True))
FULL = LK.prepare_df(master.copy())
COLS = list(LK.ROLLED_FEATURES)


def entries_for(race_id):
    r = FULL[FULL["raceId"] == race_id]
    return [{"driverRef": d, "constructorRef": c} for d, c in zip(r["driverRef"], r["constructorRef"])]


def roll(pre, year, entries):
    return LK.roll_forward_features(LK.prepare_df(pre.copy()), year, entries, dstand, cstand)


# ── (a) parity ────────────────────────────────────────────────────────────────────────────────
print("(a) parity with the master's own row-N features")
check("the race set is the 44 races (2025: 24, 2026 R1-R20: 20)", len(races) == 44, f"{len(races)}")
rows_checked = mism = switchers = absent_ok = 0
bad = []
for N in races.itertuples():
    pre = master[master["t"] < N.t]
    got = roll(pre, N.year, entries_for(N.raceId))
    rowsN = FULL[FULL["raceId"] == N.raceId].set_index("driverRef")
    prior = set(pre["driverRef"])
    for d in rowsN.index:
        if d not in prior:
            absent_ok += int(d not in got)            # first-ever race: nothing to roll, the driver is dropped
            continue
        rows_checked += 1
        last_cons = pre[pre["driverRef"] == d].sort_values("t").iloc[-1]["constructorRef"]
        switchers += int(last_cons != rowsN.loc[d, "constructorRef"])
        for c in COLS:
            if abs(float(got[d][c]) - float(rowsN.loc[d, c])) > 1e-9:
                mism += 1
                bad.append((N.raceId, d, c, got[d][c], rowsN.loc[d, c]))
check(f"{rows_checked} driver-rows x 12 features: 0 mismatches", mism == 0, f"{mism}: {bad[:4]}")
check("team switches are in the parity set", switchers >= 10, f"{switchers} driver-races where the team differs from the latest row")
check("drivers with no earlier row are absent, not guessed", absent_ok > 0)
# as_of_t on the full frame is the same as filtering first
N = races.iloc[30]
a = LK.roll_forward_features(FULL, N.year, entries_for(N.raceId), dstand, cstand, as_of_t=N.t)
b = roll(master[master["t"] < N.t], N.year, entries_for(N.raceId))
check("as_of_t on the full frame equals filtering the frame first", all(abs(a[d][c] - b[d][c]) < 1e-12 for d in b for c in COLS) and set(a) == set(b))

# ── (b) no leakage ────────────────────────────────────────────────────────────────────────────
print("(b) no leakage: results of race N or later cannot move the features")
rng = np.random.default_rng(7)
leaks = 0
for i in (2, 13, 25, 33, 40):
    N = races.iloc[i]
    base = LK.roll_forward_features(FULL, N.year, entries_for(N.raceId), dstand, cstand, as_of_t=N.t)
    alt = FULL.copy()
    m = alt["t"] >= N.t
    alt.loc[m, "points"] = rng.integers(0, 40, m.sum())
    alt.loc[m, "positionOrder"] = rng.integers(1, 23, m.sum())
    alt.loc[m, "is_dnf"] = rng.integers(0, 2, m.sum())
    alt.loc[m, "quali_position"] = rng.integers(1, 23, m.sum())
    got = LK.roll_forward_features(alt, N.year, entries_for(N.raceId), dstand, cstand, as_of_t=N.t)
    leaks += sum(1 for d in base for c in COLS if base[d][c] != got[d][c]) + int(set(base) != set(got))
check("altering results of race N and every later race: 0 differences (5 races)", leaks == 0, f"{leaks}")
N = races.iloc[25]
ent = entries_for(N.raceId)
earlier = FULL[FULL["t"] < N.t]
same_race = pd.concat([earlier, alt[alt["raceId"] == N.raceId]])          # alt still holds the altered race N rows from the loop's last i? rebuild
alt2 = FULL.copy(); mm = alt2["t"] == N.t
alt2.loc[mm, "points"] = 50; alt2.loc[mm, "positionOrder"] = 1
without_cutoff = LK.roll_forward_features(alt2[alt2["t"] <= N.t], N.year, ent, dstand, cstand)
with_cutoff = LK.roll_forward_features(alt2, N.year, ent, dstand, cstand, as_of_t=N.t)
check("sensitivity: the same alteration WITHOUT the cutoff does move the features (the test can fail)",
      any(without_cutoff[d][c] != with_cutoff[d][c] for d in with_cutoff for c in COLS))

# ── (c) edge cases ────────────────────────────────────────────────────────────────────────────
print("(c) edge cases")
last_year = int(FULL["year"].max())
ent_now = entries_for(int(FULL.sort_values("t").iloc[-1]["raceId"]))
roll_next_year = LK.roll_forward_features(FULL, last_year + 1, ent_now, dstand, cstand)
check("season rollover: season-scoped features reset (0 points, quali average 11)",
      all(r["driver_season_points"] == 0 and r["constructor_season_points"] == 0 and r["driver_season_quali_avg"] == 11.0
          and r["constructor_season_quali_avg"] == 11.0 for r in roll_next_year.values()))
nor = roll_next_year["norris"]
n_rows = FULL[FULL["driverRef"] == "norris"].sort_values("t")
check("season rollover: recent form still reads the last three races of the old season",
      abs(nor["driver_recent_form"] - n_rows["positionOrder"].tail(3).mean()) < 1e-12)
final_pos = float(pd.to_numeric(dstand[(dstand["raceId"] == n_rows.iloc[-1]["raceId"]) & (dstand["driverId"] == n_rows.iloc[-1]["driverId"])]["position"]).iloc[0])
check("season rollover: championship position is last season's final one", nor["driver_championship_position"] == final_pos)

cam = FULL[FULL["driverRef"] == "rafael_camara"]
check("Camara has exactly one row in the master", len(cam) == 1)
one = LK.roll_forward_features(FULL, last_year, [{"driverRef": "rafael_camara", "constructorRef": "haas"}], dstand, cstand)["rafael_camara"]
c0 = cam.iloc[0]
check("one-row driver: features come from that single row",
      one["driver_recent_form"] == c0["positionOrder"] and one["driver_last5_points"] == c0["points"] and one["driver_dnf_rate"] == c0["is_dnf"]
      and one["driver_last3_quali_avg"] == c0["quali_position"] and one["driver_season_quali_avg"] == c0["quali_position"]
      and one["driver_season_points"] == c0["points"])
check("a driver with no history is dropped (and the rest are still returned)",
      set(LK.roll_forward_features(FULL, last_year, [{"driverRef": "nobody_ever", "constructorRef": "haas"}, {"driverRef": "norris", "constructorRef": "mclaren"}],
                                   dstand, cstand)) == {"norris"})
try:
    LK.roll_forward_features(FULL, last_year, [{"driverRef": "norris"}], dstand, cstand)
    check("an entry without a constructor is rejected", False)
except ValueError:
    check("an entry without a constructor is rejected (never taken from the latest row)", True)
new_team = LK.roll_forward_features(FULL, last_year, [{"driverRef": "norris", "constructorRef": "brand_new_team"}], dstand, cstand)["norris"]
check("a constructor with no rows gets the notebook's fill values",
      (new_team["constructor_season_points"], new_team["constructor_recent_form"], new_team["constructor_dnf_rate"],
       new_team["constructor_season_quali_avg"], new_team["constructor_championship_position"]) == (0.0, 10.0, 0.0, 11.0, 6.0))
N0 = races.iloc[0]                                                  # 2025 R1: Hamilton's first race for Ferrari, last row was Mercedes
pre0 = master[master["t"] < N0.t]
ham_f = roll(pre0, N0.year, [{"driverRef": "hamilton", "constructorRef": "ferrari"}])["hamilton"]
ham_m = roll(pre0, N0.year, [{"driverRef": "hamilton", "constructorRef": "mercedes"}])["hamilton"]
row = FULL[(FULL["raceId"] == N0.raceId) & (FULL["driverRef"] == "hamilton")].iloc[0]
check("team switch: the entry list's constructor is used (Hamilton at Ferrari = the master's row; Mercedes would differ)",
      abs(ham_f["constructor_recent_form"] - row["constructor_recent_form"]) < 1e-9 and ham_f["constructor_recent_form"] != ham_m["constructor_recent_form"])
check("team-name aliases resolve; unknown names do not",
      LK.resolve_constructor_ref("Racing Bulls") == "rb" and LK.resolve_constructor_ref("Haas F1 Team") == "haas" and LK.resolve_constructor_ref("RB F1 Team") == "rb"
      and LK.resolve_constructor_ref("audi", {"audi"}) == "audi" and LK.resolve_constructor_ref("Nonsense") is None and LK.resolve_constructor_ref(None) is None)

# ── (d) end-to-end: /whatif == model on master row N + predicted grid ─────────────────────────
print("(d) end-to-end: main.whatif_predict equals the model run on the master's row-N features with the predicted grid")
pm = joblib.load(os.path.join(BACKEND, "podium_model.pkl"))
wm = joblib.load(os.path.join(BACKEND, "winner_model.pkl"))
qm = joblib.load(os.path.join(BACKEND, "quali_model.pkl"))
F = joblib.load(os.path.join(BACKEND, "features.pkl"))
QF = joblib.load(os.path.join(BACKEND, "quali_features.pkl"))
main.pd = pd
main.podium_model, main.winner_model, main.quali_model, main.features, main.quali_features = pm, wm, qm, F, QF
main.STATE["models_ready"] = True
main.driver_standings, main.constructor_standings = dstand, cstand


def install(df, year, race_id):
    L = LK.compute_lookups(df)
    main.df = df
    main.driver_last5_lookup = L["driver_last5_lookup"]
    main.driver_circuit_dcpr = L["driver_circuit_dcpr"]
    main.driver_circuit_quali_avg_lookup = L["driver_circuit_quali_avg_lookup"]
    main.NEXT_RACE_INFO = {"raceId": int(race_id), "year": int(year), "round": 0, "name": "test"}
    return L


worst = 0.0
grid_mismatch = compared = 0
for N in races.itertuples():
    pre = LK.prepare_df(master[master["t"] < N.t].copy())
    L = install(pre, N.year, N.raceId)
    rowsN = FULL[FULL["raceId"] == N.raceId].set_index("driverRef")
    prior = set(pre["driverRef"])
    refs = [d for d in rowsN.index if d in prior]
    body = [{"driverRef": d, "grid": 1, "constructorRef": rowsN.loc[d, "constructorRef"]} for d in rowsN.index]
    got = {r["driverRef"]: r for r in main.whatif_predict(body, circuitRef=N.circuitRef, auto_quali=True)}
    # expected: the master's own entering-N features
    q = pd.DataFrame([{**{c: rowsN.loc[d, c] for c in QF if c != "driver_circuit_quali_avg"},
                       "driver_circuit_quali_avg": L["driver_circuit_quali_avg_lookup"].get((d, N.circuitRef), 11.0)} for d in refs])[QF]
    order = sorted(zip(refs, qm.predict(q)), key=lambda t: t[1])
    grid = {d: i + 1 for i, (d, _) in enumerate(order)}
    X = pd.DataFrame([{**{c: rowsN.loc[d, c] for c in F if c not in ("grid", "driver_circuit_podium_rate")}, "grid": grid[d],
                       "driver_circuit_podium_rate": L["driver_circuit_dcpr"].get((d, N.circuitRef), 0.0)} for d in refs])[F]
    pod = pm.predict_proba(X)[:, 1]
    win = np.minimum(wm.predict_proba(X)[:, 1], pod)
    if set(got) != set(refs):
        grid_mismatch += 1
        continue
    for d, p, w in zip(refs, pod, win):
        compared += 1
        grid_mismatch += int(got[d]["grid"] != grid[d])
        worst = max(worst, abs(got[d]["podium_probability"] - round(float(p), 4)), abs(got[d]["win_probability"] - round(float(w), 4)))
check(f"{compared} driver predictions over 44 races: same drivers, same predicted grid, probabilities equal to 4 decimals",
      grid_mismatch == 0 and worst < 1e-9, f"grid/driver mismatches {grid_mismatch}, worst diff {worst}")

# an entry with no team is rejected by the endpoint (422), never filled in
from fastapi import HTTPException  # noqa: E402
try:
    main.whatif_predict([{"driverRef": "norris", "grid": 1}], circuitRef="vegas", auto_quali=False)
    check("/whatif rejects an entry with no team (HTTP 422)", False)
except HTTPException as e:
    check("/whatif rejects an entry with no team (HTTP 422)", e.status_code == 422)

# ── (e) provenance ────────────────────────────────────────────────────────────────────────────
print("(e) provenance")
races_csv = pd.read_csv(os.path.join(data, "races.csv"))
last_rid = int(FULL.sort_values("t").iloc[-1]["raceId"])
nxt = main._next_race(races_csv, FULL)
check("_next_race: with data through R20 the features are entering Las Vegas (1189)", nxt and nxt["raceId"] == 1189 and nxt["round"] == 21 and nxt["year"] == 2026, f"{nxt}")
upto = FULL[FULL["raceId"] != last_rid]
check("_next_race: with data through R19 it is the Brazilian GP (1188)", main._next_race(races_csv, upto)["raceId"] == 1188)
check("_next_race: nothing on the calendar after the newest race -> None", main._next_race(races_csv[races_csv["year"] <= 2025], FULL[FULL["year"] <= 2025]) is None)
main.STATE["model_version"] = "m-test"
main.df = FULL
main.NEXT_RACE_INFO = nxt
meta = main.meta()
check("/meta: feature_roll and features_entering are reported next to the data horizon",
      meta["feature_roll"] == "rolled_forward" and meta["features_entering"]["raceId"] == 1189 and meta["inputs_as_of"]["raceId"] == last_rid)

import snapshot_model_pick as S  # noqa: E402

posted = {}


class FakeResp:
    def __init__(self, payload, code=200):
        self._p, self.status_code, self.text = payload, code, ""

    def json(self):
        return self._p


def run_predict_upcoming(meta_payload):
    def fake_get(url, what):
        return meta_payload

    def fake_post(url, params=None, json=None, timeout=None):
        posted["params"], posted["body"] = params, json
        recs = [{"driverRef": e["driverRef"], "driver_name": e["driverRef"], "team": e["constructorRef"], "grid": i + 1,
                 "podium_probability": 0.9 - 0.03 * i, "win_probability": 0.5 - 0.02 * i} for i, e in enumerate(json)]
        return FakeResp(recs)

    S.get_json_with_retry, S.requests.post = fake_get, fake_post
    S.PROVENANCE.clear()
    return S.predict_upcoming("http://api", 1189)


ok_meta = {"feature_roll": "rolled_forward", "features_entering": {"raceId": 1189, "name": "Las Vegas Grand Prix"}, "inputs_as_of": {"raceId": 1188}}
out = run_predict_upcoming(ok_meta)
check("snapshot source tag is whatif_auto_quali_rolled", S.PROVENANCE.get("source") == "whatif_auto_quali_rolled", f"{S.PROVENANCE}")
check("snapshot sends the constructor of every entrant", len(posted["body"]) >= 20 and all(e.get("constructorRef") for e in posted["body"]) and posted["params"]["auto_quali"] == "true")
for meta_payload, label in (({"inputs_as_of": {"raceId": 1188}}, "an older API with no feature_roll"),
                            ({**ok_meta, "features_entering": {"raceId": 1190}}, "features entering a different race")):
    try:
        run_predict_upcoming(meta_payload)
        check(f"snapshot refuses {label}", False)
    except SystemExit:
        check(f"snapshot refuses {label}", True)

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {failures}")
    sys.exit(1)
print("ALL PASSED")
