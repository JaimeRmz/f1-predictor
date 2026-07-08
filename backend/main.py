import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import joblib
import pandas as pd
import numpy as np
import requests as http_requests
from datetime import datetime

# Resolve model/data paths relative to THIS file, not the process CWD, so the
# app loads correctly whether Render (or anything else) starts it from the repo
# root or from backend/. Models live beside main.py; the CSVs live in ../data.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")

app = FastAPI(title="F1 Predictor API")

# Allowed browser origins come from FRONTEND_URL (comma-separated, so we can add
# the Vercel deployment URL in Render's dashboard without a code change),
# falling back to the local Vite dev server for development.
_dev_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_env_origins = [o.strip() for o in os.environ.get("FRONTEND_URL", "").split(",") if o.strip()]
allowed_origins = _env_origins or _dev_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

podium_model = joblib.load(os.path.join(BASE_DIR, "podium_model.pkl"))
winner_model = joblib.load(os.path.join(BASE_DIR, "winner_model.pkl"))
features = joblib.load(os.path.join(BASE_DIR, "features.pkl"))
quali_model = joblib.load(os.path.join(BASE_DIR, "quali_model.pkl"))
quali_features = joblib.load(os.path.join(BASE_DIR, "quali_features.pkl"))
df = pd.read_csv(os.path.join(DATA_DIR, "f1_master.csv"))
df["grid"]   = pd.to_numeric(df["grid"],   errors="coerce").fillna(0).astype(int)
df["points"] = pd.to_numeric(df["points"], errors="coerce").fillna(0)
df = df.sort_values(["year", "round", "positionOrder"]).reset_index(drop=True)
# Recompute driver_last5_points so it's always current (even if CSV predates the feature)
df["driver_last5_points"] = (
    df.groupby("driverRef")["points"]
    .transform(lambda x: x.shift(1).rolling(5, min_periods=1).sum())
).fillna(0)
# Per-driver lookup: last5 points heading into the NEXT (unseen) race
driver_last5_lookup = (
    df.sort_values(["year", "round"])
    .groupby("driverRef")["driver_last5_points"]
    .last()
    .to_dict()
)
# Decayed circuit podium rate lookup: (driverRef, circuitRef) → rate entering next year
# Mirrors the decay=0.75 used during training so /canada/predict stays consistent.
_next_yr = int(df["year"].max()) + 1
_yr_cir  = df.groupby(["driverRef", "circuitRef", "year"])["podium"].mean().reset_index()
_cr      = _yr_cir[_yr_cir["year"] < _next_yr].copy()
_cr["_w"]  = 0.75 ** (_next_yr - _cr["year"])
_cr["_wp"] = _cr["podium"] * _cr["_w"]
_cr_agg  = (
    _cr.groupby(["driverRef", "circuitRef"])
    .apply(lambda g: g["_wp"].sum() / g["_w"].sum(), include_groups=False)
    .reset_index(name="rate")
)
driver_circuit_dcpr = dict(zip(
    zip(_cr_agg["driverRef"], _cr_agg["circuitRef"]),
    _cr_agg["rate"]
))

# ── Qualifying model feature lookups ──
# f1_master.csv already carries every quali feature per-row (computed during
# training with shift(1)/expanding()/rolling() to avoid leakage - i.e. each
# row holds the value "entering that race"). For live predictions we reuse
# each driver/constructor's most recent row's value, same convention already
# used above for driver_last5_lookup - one race stale, but consistent.
def _last_value_lookup(col, key):
    return (
        df.sort_values(["year", "round"])
        .dropna(subset=[col])
        .groupby(key)[col]
        .last()
        .to_dict()
    )

quali_constructor_season_avg = _last_value_lookup("constructor_season_quali_avg", "constructorRef")
quali_driver_season_avg      = _last_value_lookup("driver_season_quali_avg", "driverRef")
quali_driver_last3_avg       = _last_value_lookup("driver_last3_quali_avg", "driverRef")
quali_driver_champ_pos       = _last_value_lookup("driver_championship_position", "driverRef")
quali_constructor_champ_pos  = _last_value_lookup("constructor_championship_position", "constructorRef")

# Decayed circuit qualifying-average lookup: (driverRef, circuitRef) → avg
# quali position entering next year. Mirrors driver_circuit_dcpr exactly,
# swapped to quali_position mean instead of podium mean.
_yr_cir_q = df.groupby(["driverRef", "circuitRef", "year"])["quali_position"].mean().reset_index()
_cr_q     = _yr_cir_q[_yr_cir_q["year"] < _next_yr].copy()
_cr_q["_w"]  = 0.75 ** (_next_yr - _cr_q["year"])
_cr_q["_wp"] = _cr_q["quali_position"] * _cr_q["_w"]
_cr_q_agg = (
    _cr_q.groupby(["driverRef", "circuitRef"])
    .apply(lambda g: g["_wp"].sum() / g["_w"].sum(), include_groups=False)
    .reset_index(name="avg")
)
driver_circuit_quali_avg_lookup = dict(zip(
    zip(_cr_q_agg["driverRef"], _cr_q_agg["circuitRef"]),
    _cr_q_agg["avg"]
))

def get_quali_features_for_driver(driver_ref: str, circuit_ref: str = ""):
    """Builds a QUALI_FEATURES-ordered feature row + that driver's most recent
    race row (for name/team lookup), or None if the driver has no history at all."""
    driver_data = df[df["driverRef"] == driver_ref]
    if driver_data.empty:
        return None
    latest = driver_data.sort_values(["year", "round"]).iloc[-1]
    constructor_ref = latest["constructorRef"]
    feat = {
        "constructor_season_quali_avg": quali_constructor_season_avg.get(constructor_ref, 11.0),
        "driver_circuit_quali_avg": driver_circuit_quali_avg_lookup.get((driver_ref, circuit_ref), 11.0),
        "driver_season_quali_avg": quali_driver_season_avg.get(driver_ref, 11.0),
        "driver_last3_quali_avg": quali_driver_last3_avg.get(driver_ref, 11.0),
        "driver_recent_form": latest["driver_recent_form"],
        "driver_last5_points": driver_last5_lookup.get(driver_ref, 0),
        "driver_dnf_rate": latest["driver_dnf_rate"],
        "driver_championship_position": quali_driver_champ_pos.get(driver_ref, 11),
        "constructor_championship_position": quali_constructor_champ_pos.get(constructor_ref, 6),
    }
    return feat, latest

@app.get("/")
def root():
    return {"message": "F1 Predictor API is running"}

@app.get("/drivers")
def get_drivers():
    meta = (
        df.groupby(['driverRef', 'driver_name'])
        .agg(max_year=('year', 'max'), min_year=('year', 'min'))
        .reset_index()
    )
    pts_2026 = (
        df[df['year'] == 2026]
        .groupby('driverRef')['points'].sum()
        .reset_index().rename(columns={'points': 'pts_2026'})
    )
    meta = meta.merge(pts_2026, on='driverRef', how='left')
    meta['pts_2026'] = meta['pts_2026'].fillna(0)
    meta['sort_group'] = meta['max_year'].apply(
        lambda y: 0 if y == 2026 else (1 if y == 2025 else 2)
    )
    meta = meta.sort_values(
        ['sort_group', 'pts_2026', 'driver_name'],
        ascending=[True, False, True]
    )
    return meta[['driverRef', 'driver_name', 'max_year', 'min_year']].to_dict(orient='records')

@app.get("/driver/{driver_ref}")
def get_driver_stats(driver_ref: str):
    d = df[df['driverRef'] == driver_ref].copy()
    if d.empty:
        return {"error": "Driver not found"}
    career = {
        "name": d['driver_name'].iloc[0],
        "races": len(d),
        "podiums": int(d['podium'].sum()),
        "wins": int((d['positionOrder'] == 1).sum()),
        "podium_rate": round(d['podium'].mean() * 100, 1),
        "avg_grid": round(d['grid'].mean(), 1),
        "avg_finish": round(d['positionOrder'].mean(), 1),
    }
    by_year = d.groupby('year').agg(
        races=('raceId', 'count'),
        podiums=('podium', 'sum'),
        wins=('positionOrder', lambda x: (x == 1).sum())
    ).reset_index()
    circuit_stats = d.groupby('circuitRef').agg(
        races=('raceId', 'count'),
        podiums=('podium', 'sum'),
        podium_rate=('podium', 'mean')
    ).reset_index().sort_values('podium_rate', ascending=False).head(10)
    return {
        "career": career,
        "by_year": by_year.to_dict(orient="records"),
        "circuit_stats": circuit_stats.to_dict(orient="records")
    }

@app.get("/races")
def get_races():
    races = df[['raceId', 'year', 'round', 'name_race', 'circuitRef']].drop_duplicates()
    races = races.sort_values(['year', 'round'], ascending=False)
    return races.head(200).to_dict(orient="records")

@app.get("/season/{year}")
def get_season(year: int):
    season = df[df['year'] == year].copy()
    if season.empty:
        return {"error": "Season not found"}
    standings = season.groupby(['driverRef', 'driver_name']).agg(
        podiums=('podium', 'sum'),
        wins=('positionOrder', lambda x: (x == 1).sum()),
        races=('raceId', 'count'),
        points=('points', 'sum')
    ).reset_index().sort_values('points', ascending=False)
    return standings.head(20).to_dict(orient="records")

@app.get("/predict/{race_id}")
def predict_race(race_id: int):
    race_data = df[df['raceId'] == race_id].copy()
    if race_data.empty:
        return {"error": "Race not found"}
    X = race_data[features]
    race_data['podium_probability'] = podium_model.predict_proba(X)[:, 1]
    race_data['win_probability'] = winner_model.predict_proba(X)[:, 1]
    # A win is a subset of a podium, so win% can never exceed podium%.
    race_data['win_probability'] = race_data[['win_probability', 'podium_probability']].min(axis=1)
    feature_contributions = []
    for _, row in race_data.iterrows():
        contrib = {f: round(float(row[f]), 3) for f in features}
        feature_contributions.append(contrib)
    race_data['feature_contributions'] = feature_contributions
    result = race_data[['driver_name', 'driverRef', 'podium_probability', 'win_probability', 'grid',
                         'positionOrder', 'podium', 'name_constructor',
                         'driver_season_points', 'constructor_season_points',
                         'driver_circuit_podium_rate', 'driver_recent_form',
                         'constructor_recent_form', 'driver_dnf_rate']]
    result = result.sort_values('podium_probability', ascending=False)
    return result.to_dict(orient="records")

@app.get("/predict/qualifying/{race_id}")
def predict_qualifying(race_id: int):
    race_data = df[df['raceId'] == race_id].copy()
    if race_data.empty:
        return {"error": "Race not found"}
    X = race_data[quali_features]
    race_data['predicted_quali_raw'] = quali_model.predict(X)
    race_data['predicted_quali_position'] = race_data['predicted_quali_raw'].rank(method='first').astype(int)
    race_data = race_data.sort_values('predicted_quali_position')
    result = race_data[['driver_name', 'driverRef', 'name_constructor',
                         'predicted_quali_position', 'predicted_quali_raw', 'quali_position']]
    result = result.rename(columns={'name_constructor': 'team', 'quali_position': 'actual_quali_position'})
    result['predicted_quali_raw'] = result['predicted_quali_raw'].round(2)
    return result.to_dict(orient="records")

@app.post("/whatif/qualifying")
def whatif_qualifying(driver_refs: list[str], circuitRef: str = ""):
    rows, valid = [], []
    for ref in driver_refs:
        got = get_quali_features_for_driver(ref, circuitRef)
        if got is None:
            continue
        feat, latest = got
        rows.append(feat)
        valid.append((ref, latest))
    if not rows:
        return []
    X = pd.DataFrame(rows)[quali_features]
    preds = quali_model.predict(X)
    results = [
        {
            "driverRef": ref,
            "driver_name": latest['driver_name'],
            "team": latest['name_constructor'],
            "predicted_quali_raw": round(float(raw), 2),
        }
        for (ref, latest), raw in zip(valid, preds)
    ]
    results.sort(key=lambda r: r['predicted_quali_raw'])
    for i, r in enumerate(results, start=1):
        r['predicted_quali_position'] = i
    return results

@app.get("/compare")
def compare_drivers(driver1: str, driver2: str):
    d1 = df[df['driverRef'] == driver1]
    d2 = df[df['driverRef'] == driver2]
    def stats(d):
        return {
            "name": d['driver_name'].iloc[0] if len(d) > 0 else driver1,
            "races": len(d),
            "podiums": int(d['podium'].sum()),
            "wins": int((d['positionOrder'] == 1).sum()),
            "podium_rate": round(d['podium'].mean() * 100, 1),
            "avg_grid": round(d['grid'].mean(), 1),
            "avg_finish": round(d['positionOrder'].mean(), 1),
            "dnf_rate": round(d['is_dnf'].mean() * 100, 1),
        }
    shared_circuits = set(d1['circuitRef'].unique()) & set(d2['circuitRef'].unique())
    head_to_head = []
    for circuit in list(shared_circuits)[:10]:
        c1 = d1[d1['circuitRef'] == circuit]
        c2 = d2[d2['circuitRef'] == circuit]
        head_to_head.append({
            "circuit": circuit,
            "driver1_podium_rate": round(c1['podium'].mean() * 100, 1) if len(c1) > 0 else 0,
            "driver2_podium_rate": round(c2['podium'].mean() * 100, 1) if len(c2) > 0 else 0,
        })
    return {
        "driver1": stats(d1),
        "driver2": stats(d2),
        "head_to_head": head_to_head
    }

@app.get("/championship/simulate")
def simulate_championship():
    # Post-Silverstone (round 9) standings
    current_standings = [
        {"driver": "Kimi Antonelli",  "driverRef": "antonelli",      "team": "Mercedes",     "points": 179, "color": "#00d2be"},
        {"driver": "George Russell",  "driverRef": "russell",         "team": "Mercedes",     "points": 154, "color": "#00d2be"},
        {"driver": "Lewis Hamilton",  "driverRef": "hamilton",        "team": "Ferrari",      "points": 147, "color": "#e10600"},
        {"driver": "Charles Leclerc", "driverRef": "leclerc",         "team": "Ferrari",      "points": 108, "color": "#e10600"},
        {"driver": "Lando Norris",    "driverRef": "norris",          "team": "McLaren",      "points": 97,  "color": "#ff8000"},
        {"driver": "Oscar Piastri",   "driverRef": "piastri",         "team": "McLaren",      "points": 82,  "color": "#ff8000"},
        {"driver": "Max Verstappen",  "driverRef": "max_verstappen",  "team": "Red Bull",     "points": 76,  "color": "#3671c6"},
    ]
    remaining_races  = 13
    points_available = remaining_races * 26  # 26 = win (25) + fastest lap (1)
    leader_pts       = current_standings[0]["points"]
    simulated = []
    for s in current_standings:
        driver_data = df[df['driverRef'] == s['driverRef']]
        win_rate = float((driver_data['positionOrder'] == 1).mean()) if len(driver_data) > 0 else 0.05
        expected_additional = win_rate * remaining_races * 18 + (1 - win_rate) * remaining_races * 6
        projected_total = s['points'] + expected_additional
        gap = leader_pts - s['points']
        eliminated = (s['points'] + points_available) < leader_pts
        contention_score = 0.0 if eliminated else (1 - gap / points_available) ** 2
        simulated.append({
            **s,
            "projected_total": round(projected_total),
            "points_available": points_available,
            "win_rate": round(win_rate * 100, 1),
            "contention_score": contention_score,
            "gap_to_leader": s['points'] - leader_pts,
        })
    total_score = sum(d["contention_score"] for d in simulated)
    for d in simulated:
        d["title_probability"] = round(d["contention_score"] / total_score * 100, 1) if total_score > 0 else 0
    return sorted(simulated, key=lambda x: x['projected_total'], reverse=True)

@app.get("/canada/schedule")
def get_canada_schedule():
    schedule = [
        {"session": "Practice 1", "day": "Thursday", "date": "2026-05-22", "time": "13:30", "emoji": "🔧"},
        {"session": "Practice 2", "day": "Thursday", "date": "2026-05-22", "time": "17:00", "emoji": "🔧"},
        {"session": "Practice 3", "day": "Saturday", "date": "2026-05-24", "time": "12:30", "emoji": "🔧"},
        {"session": "Qualifying", "day": "Saturday", "date": "2026-05-24", "time": "16:00", "emoji": "⚡"},
        {"session": "Race", "day": "Sunday", "date": "2026-05-25", "time": "14:00", "emoji": "🏁"},
    ]
    now = datetime.now()
    for s in schedule:
        session_dt = datetime.strptime(f"{s['date']} {s['time']}", "%Y-%m-%d %H:%M")
        s['completed'] = session_dt < now
        s['next'] = False
    upcoming = [s for s in schedule if not s['completed']]
    if upcoming:
        upcoming[0]['next'] = True
    return schedule

@app.get("/canada/predict")
def predict_canada():
    canada_drivers = [
        {"driverRef": "russell", "grid": 1},
        {"driverRef": "antonelli", "grid": 2},
        {"driverRef": "leclerc", "grid": 3},
        {"driverRef": "norris", "grid": 4},
        {"driverRef": "hamilton", "grid": 5},
        {"driverRef": "piastri", "grid": 6},
        {"driverRef": "verstappen", "grid": 7},
    ]
    results = []
    for d in canada_drivers:
        driver_data = df[df['driverRef'] == d['driverRef']].copy()
        if driver_data.empty:
            continue
        latest = driver_data.sort_values(['year', 'round']).iloc[-1].copy()
        latest['grid'] = d['grid']
        latest['driver_circuit_podium_rate'] = driver_circuit_dcpr.get((d['driverRef'], 'villeneuve'), 0.0)
        latest['driver_last5_points'] = driver_last5_lookup.get(d['driverRef'], 0)
        X = pd.DataFrame([latest[features]])[features]
        prob = float(podium_model.predict_proba(X)[0][1])
        results.append({
            "driver_name": latest['driver_name'],
            "driverRef": d['driverRef'],
            "team": latest['name_constructor'],
            "grid": d['grid'],
            "podium_probability": round(prob, 4),
            "canada_podiums": int(canada_data['podium'].sum()),
            "canada_races": len(canada_data),
            "canada_podium_rate": round(float(canada_data['podium'].mean()) * 100, 1) if len(canada_data) > 0 else 0,
        })
    return sorted(results, key=lambda x: x['podium_probability'], reverse=True)

@app.post("/whatif")
def whatif_predict(drivers: list[dict], circuitRef: str = "", auto_quali: bool = False):
    # For upcoming races, run the qualifying model first and use its
    # predicted order as the grid fed into the race predictor below, instead
    # of trusting each driver dict's caller-supplied 'grid' (which the
    # What-If page's manual drag-and-drop UI still relies on when auto_quali
    # is left off).
    predicted_grid = {}
    if auto_quali:
        quali_rows, quali_refs = [], []
        for d in drivers:
            got = get_quali_features_for_driver(d['driverRef'], circuitRef)
            if got is None:
                continue
            feat, _latest = got
            quali_rows.append(feat)
            quali_refs.append(d['driverRef'])
        if quali_rows:
            Xq = pd.DataFrame(quali_rows)[quali_features]
            quali_preds = quali_model.predict(Xq)
            order = sorted(zip(quali_refs, quali_preds), key=lambda t: t[1])
            predicted_grid = {ref: i + 1 for i, (ref, _) in enumerate(order)}

    results = []
    for d in drivers:
        driver_data = df[df['driverRef'] == d['driverRef']].copy()
        if driver_data.empty:
            continue
        latest = driver_data.sort_values(['year', 'round']).iloc[-1].copy()
        grid_value = predicted_grid.get(d['driverRef'], d['grid']) if auto_quali else d['grid']
        latest['grid'] = grid_value
        latest['driver_circuit_podium_rate'] = driver_circuit_dcpr.get((d['driverRef'], circuitRef), 0.0)
        latest['driver_last5_points'] = driver_last5_lookup.get(d['driverRef'], 0)
        X = pd.DataFrame([latest[features]])[features]
        podium_prob = float(podium_model.predict_proba(X)[0][1])
        win_prob = float(winner_model.predict_proba(X)[0][1])
        # A win is a subset of a podium, so win% can never exceed podium%.
        win_prob = min(win_prob, podium_prob)
        result = {
            "driver_name": latest['driver_name'],
            "driverRef": d['driverRef'],
            "team": latest['name_constructor'],
            "grid": grid_value,
            "podium_probability": round(podium_prob, 4),
            "win_probability": round(win_prob, 4),
        }
        if auto_quali:
            result["predicted_quali_position"] = grid_value
        results.append(result)
    return sorted(results, key=lambda x: x['podium_probability'], reverse=True)


if __name__ == "__main__":
    # Local convenience runner. In production Render invokes uvicorn directly
    # via the start command (see render.yaml) and supplies $PORT itself.
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))