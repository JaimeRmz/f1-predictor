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
