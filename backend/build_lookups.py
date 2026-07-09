"""Precompute the derived lookup dicts into lookups.pkl so the server doesn't
have to rebuild them from f1_master.csv on every (cold) boot.

Run after any change to data/f1_master.csv:
    python build_lookups.py

main.py loads lookups.pkl at startup and falls back to computing the dicts
itself if the file is missing or its row-count sentinel no longer matches the
CSV (i.e. the cache is stale) — so a forgotten rebuild degrades speed, never
correctness.
"""
import os
import joblib
import pandas as pd
from lookups import prepare_df, compute_lookups

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")

df = pd.read_csv(os.path.join(DATA_DIR, "f1_master.csv"))
df = prepare_df(df)

lookups = compute_lookups(df)
lookups["_row_count"] = len(df)  # staleness sentinel checked at runtime

out = os.path.join(BASE_DIR, "lookups.pkl")
joblib.dump(lookups, out)
print(f"Wrote {out} ({len(df)} rows, next_yr={lookups['next_yr']})")
