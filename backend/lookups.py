"""Shared data preparation + derived-lookup computation for the F1 Predictor.

Imported by both:
  - main.py          (runtime: fallback compute if the cache is missing/stale)
  - build_lookups.py (build-time: precompute the dicts into lookups.pkl)

Keeping the logic here (single source of truth) guarantees the cached lookups
are byte-for-byte what the app would have computed itself.
"""
import pandas as pd


def prepare_df(df):
    """Clean/sort the master frame and (re)compute the rolling last-5 points
    column, so it's always current even if the CSV predates the feature."""
    df["grid"]   = pd.to_numeric(df["grid"],   errors="coerce").fillna(0).astype(int)
    df["points"] = pd.to_numeric(df["points"], errors="coerce").fillna(0)
    df = df.sort_values(["year", "round", "positionOrder"]).reset_index(drop=True)
    df["driver_last5_points"] = (
        df.groupby("driverRef")["points"]
        .transform(lambda x: x.shift(1).rolling(5, min_periods=1).sum())
    ).fillna(0)
    return df


def _decayed_circuit_lookup(df, value_col, next_yr, decay=0.75):
    """(driverRef, circuitRef) -> decay-weighted mean of value_col entering
    next_yr. Mirrors the decay used during training so live predictions stay
    consistent."""
    yr_cir = df.groupby(["driverRef", "circuitRef", "year"])[value_col].mean().reset_index()
    cr = yr_cir[yr_cir["year"] < next_yr].copy()
    cr["_w"]  = decay ** (next_yr - cr["year"])
    cr["_wp"] = cr[value_col] * cr["_w"]
    agg = (
        cr.groupby(["driverRef", "circuitRef"])
        .apply(lambda g: g["_wp"].sum() / g["_w"].sum(), include_groups=False)
        .reset_index(name="v")
    )
    return dict(zip(zip(agg["driverRef"], agg["circuitRef"]), agg["v"]))


def compute_lookups(df):
    """Build every derived lookup dict the prediction endpoints rely on.
    `df` must already have been through prepare_df()."""
    next_yr = int(df["year"].max()) + 1

    driver_last5_lookup = (
        df.sort_values(["year", "round"])
        .groupby("driverRef")["driver_last5_points"]
        .last()
        .to_dict()
    )

    def last_value_lookup(col, key):
        # f1_master already carries each quali feature per-row (leakage-safe,
        # "entering that race"); reuse each key's most recent non-null value.
        return (
            df.sort_values(["year", "round"])
            .dropna(subset=[col])
            .groupby(key)[col]
            .last()
            .to_dict()
        )

    return {
        "next_yr": next_yr,
        "driver_last5_lookup": driver_last5_lookup,
        "driver_circuit_dcpr": _decayed_circuit_lookup(df, "podium", next_yr),
        "driver_circuit_quali_avg_lookup": _decayed_circuit_lookup(df, "quali_position", next_yr),
        "quali_constructor_season_avg": last_value_lookup("constructor_season_quali_avg", "constructorRef"),
        "quali_driver_season_avg":      last_value_lookup("driver_season_quali_avg", "driverRef"),
        "quali_driver_last3_avg":       last_value_lookup("driver_last3_quali_avg", "driverRef"),
        "quali_driver_champ_pos":       last_value_lookup("driver_championship_position", "driverRef"),
        "quali_constructor_champ_pos":  last_value_lookup("constructor_championship_position", "constructorRef"),
    }


# ══════════════════════════════════════════════════════════════
# Roll-forward features: the state entering the NEXT race
# ══════════════════════════════════════════════════════════════
# Both models were trained on features "entering" a race (everything up to the previous race, f1_master.csv). /whatif used to take each
# driver's latest STORED row instead, which is the state entering that driver's LAST race: one race stale, so a result that has just been
# ingested (Brazil -> Las Vegas) was invisible to the forecast. roll_forward_features() builds, for each entrant, the values the notebook
# would store on the NEXT race's row, with the notebook's own formulas (shift(1) then cumsum / rolling / expanding), from the rows
# through the last completed race. Parity with the master's own row-N values is asserted by backend/scripts/test_roll_forward.py.

ROLLED_FEATURES = (
    "driver_season_points", "constructor_season_points", "driver_recent_form", "constructor_recent_form",
    "driver_dnf_rate", "constructor_dnf_rate", "driver_last5_points",
    "constructor_season_quali_avg", "driver_season_quali_avg", "driver_last3_quali_avg",
    "driver_championship_position", "constructor_championship_position",
)

# Team names callers send (the frontend roster, f1_master's name_constructor) -> constructorRef. Matching is case-insensitive.
TEAM_ALIASES = {
    "mercedes": "mercedes", "ferrari": "ferrari", "mclaren": "mclaren", "red bull": "red_bull", "red bull racing": "red_bull",
    "haas": "haas", "haas f1 team": "haas", "racing bulls": "rb", "rb": "rb", "rb f1 team": "rb", "audi": "audi",
    "alpine": "alpine", "alpine f1 team": "alpine", "williams": "williams", "cadillac": "cadillac", "cadilac": "cadillac",
    "aston martin": "aston_martin", "sauber": "sauber", "kick sauber": "sauber",
}


def resolve_constructor_ref(value, known_refs=()):
    """constructorRef for a caller-supplied constructorRef or team name; None when it cannot be told (never guessed)."""
    if not value:
        return None
    v = str(value).strip()
    if v in known_refs:
        return v
    return TEAM_ALIASES.get(v.lower())


def _num(v, default):
    v = pd.to_numeric(v, errors="coerce")
    return default if pd.isna(v) else float(v)


def roll_forward_features(df, next_year, entry_list, driver_standings=None, constructor_standings=None, as_of_t=None):
    """{driverRef: {feature: value}} for every entrant who has history: the 12 ROLLED_FEATURES entering the next race.

    df                    prepared master frame (lookups.prepare_df) with is_dnf and quali_position. Every row in it counts as completed,
                          unless `as_of_t` (year*100 + round) is given: then only rows strictly before it are used.
    next_year             the season of the race being predicted (resets the season-scoped features at a rollover).
    entry_list            [{"driverRef": ..., "constructorRef": ...}]. The constructor comes from HERE, never from the driver's latest
                          row, so a team switch is in force from the first race for the new team. Missing constructorRef -> ValueError.
    driver/constructor_standings  DataFrames of the standings CSVs (raceId, driverId|constructorId, position); without them the
                          championship positions fall back to the notebook's fill values (11 / 6).
    A driver with no rows is left out of the result (the model cannot score him), exactly as /whatif always did. A driver with one
    row (a debutant's second race) gets features from that single row.
    """
    d = df if as_of_t is None else df[(df["year"] * 100 + df["round"]) < as_of_t]
    d = d.sort_values(["year", "round", "positionOrder"])
    crace = (d.groupby(["constructorRef", "raceId", "year", "round"], sort=False)
              .agg(pts=("points", "sum"), pos=("positionOrder", "mean"), dnf=("is_dnf", "mean"), q=("quali_position", "mean"),
                   cid=("constructorId", "first"))
              .reset_index().sort_values(["year", "round"]))
    cons = {ref: g for ref, g in crace.groupby("constructorRef")}
    drivers = {ref: g for ref, g in d.groupby("driverRef")}
    dst = {}
    if driver_standings is not None:
        for r in driver_standings.itertuples(index=False):
            dst[(int(r.raceId), int(r.driverId))] = pd.to_numeric(r.position, errors="coerce")
    cst = {}
    if constructor_standings is not None:
        for r in constructor_standings.itertuples(index=False):
            cst[(int(r.raceId), int(r.constructorId))] = pd.to_numeric(r.position, errors="coerce")
    out = {}
    for e in entry_list:
        ref = e["driverRef"]
        cref = e.get("constructorRef")
        if not cref:
            raise ValueError(f"entry for {ref} has no constructorRef: the constructor must come from the entry list")
        r = drivers.get(ref)
        if r is None or r.empty:
            continue
        last = r.iloc[-1]
        c = cons.get(cref)
        cy = c[c["year"] == next_year] if c is not None else None
        ry = r[r["year"] == next_year]
        has_c = c is not None and len(c) > 0
        out[ref] = {
            "driver_season_points": float(ry["points"].sum()),
            "constructor_season_points": float(cy["pts"].sum()) if has_c else 0.0,
            "driver_recent_form": float(r["positionOrder"].tail(3).mean()),
            "constructor_recent_form": float(c["pos"].tail(3).mean()) if has_c else 10.0,
            "driver_dnf_rate": float(r["is_dnf"].tail(10).mean()),
            "constructor_dnf_rate": float(c["dnf"].tail(10).mean()) if has_c else 0.0,
            "driver_last5_points": float(r["points"].tail(5).sum()),
            "constructor_season_quali_avg": float(cy["q"].mean()) if has_c and len(cy) else 11.0,
            "driver_season_quali_avg": float(ry["quali_position"].mean()) if len(ry) else 11.0,
            "driver_last3_quali_avg": float(r["quali_position"].tail(3).mean()),
            "driver_championship_position": _num(dst.get((int(last["raceId"]), int(last["driverId"]))), 11.0),
            "constructor_championship_position": (_num(cst.get((int(c.iloc[-1]["raceId"]), int(c.iloc[-1]["cid"]))), 6.0) if has_c else 6.0),
        }
    return out
