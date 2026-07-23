#!/usr/bin/env python3
"""Freeze the model's top-3 podium pick for a race into Supabase's
`model_snapshots` table, so the My Picks results view can compare a user's pick
against what the model predicted — captured at snapshot time, not recomputed
later with hindsight.

Modes (exactly one required):

  --backfill        Snapshot every COMPLETED 2026 race (rounds 1-10, raceIds
                    1169-1178) via the /predict/{race_id} endpoint — the same
                    pre-race-feature source the 2026 Season accuracy tracker
                    uses. Existing snapshot rows are left untouched (never
                    overwritten silently).

  --race-id N       Snapshot a single race. If N has no result rows yet (an
                    UPCOMING race such as Hungary 1179), the model's current
                    pick comes from the /whatif auto-quali prediction instead
                    of /predict. Refuses to overwrite an existing snapshot
                    unless --force is given — this is the mode with a real
                    fairness deadline (before qualifying), so an accidental
                    double-run or a late overwrite actually matters.

Flags:
  --force           (--race-id only) overwrite an existing snapshot row.
  --dry-run         Compute and print the picks but write nothing to Supabase.
                    Needs no secret key — use it to preview what would be saved.
  --api-base URL    Model API base (default $MODEL_API_URL or 127.0.0.1:8000).

Environment:
  SUPABASE_SECRET_KEY   required for writes; the service-role secret key
                        (bypasses RLS). Never hardcode it.
  SUPABASE_URL          optional; defaults to the project URL below.
  MODEL_API_URL         optional; default model API base.
"""
import argparse
import os
import sys
import time

import requests

DEFAULT_SUPABASE_URL = "https://ykpkieabxvipkyyynypr.supabase.co"
DEFAULT_API_BASE = os.environ.get("MODEL_API_URL", "http://127.0.0.1:8000")

# Completed 2026 rounds (mirror of the frontend's COMPLETED_2026). Ordered by
# round; names are for the readable table only.
COMPLETED_2026 = [
    (1169, 1,  "Australian GP"),
    (1170, 2,  "Chinese GP"),
    (1171, 3,  "Japanese GP"),
    (1172, 4,  "Miami GP"),
    (1173, 5,  "Canadian GP"),
    (1174, 6,  "Monaco GP"),
    (1175, 7,  "Spanish GP (Barcelona)"),
    (1176, 8,  "Austrian GP"),
    (1177, 9,  "British GP"),
    (1178, 10, "Belgian GP"),
]
COMPLETED_IDS = {rid for rid, _, _ in COMPLETED_2026}
RACE_NAME = {rid: name for rid, _, name in COMPLETED_2026}
RACE_ROUND = {rid: rnd for rid, rnd, _ in COMPLETED_2026}

# Upcoming races → circuitRef, for the /whatif path (mirror of UPCOMING_RACES_2026).
UPCOMING_CIRCUIT = {
    1179: "hungaroring", 1180: "zandvoort", 1181: "monza", 1182: "madrid",
    1183: "baku", 1184: "marina_bay", 1185: "americas", 1186: "rodriguez",
    1187: "interlagos", 1188: "las_vegas", 1189: "losail", 1190: "yas_marina",
}
UPCOMING_NAME = {
    1179: "Hungarian GP", 1180: "Dutch GP", 1181: "Italian GP", 1182: "Spanish GP (Madrid)",
    1183: "Azerbaijan GP", 1184: "Singapore GP", 1185: "United States GP", 1186: "Mexico City GP",
    1187: "Brazilian GP", 1188: "Las Vegas GP", 1189: "Qatar GP", 1190: "Abu Dhabi GP",
}

# Driver roster for /whatif (mirror of STANDINGS_GRID_2026): driverRef + a
# starting grid guess. auto_quali=true means the qualifying model re-predicts
# the grid, so these grid values are only a fallback seed.
ROSTER = [
    ("antonelli", 1), ("hamilton", 2), ("russell", 3), ("leclerc", 4),
    ("norris", 5), ("piastri", 6), ("max_verstappen", 7), ("hadjar", 8),
    ("gasly", 9), ("lawson", 10), ("lindblad", 11), ("colapinto", 12),
    ("bearman", 13), ("bortoleto", 14), ("sainz", 15), ("albon", 16),
    ("ocon", 17), ("alonso", 18), ("hulkenberg", 19), ("bottas", 20),
    ("perez", 21), ("stroll", 22),
]


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


# ── Model API ────────────────────────────────────────────────────
def wait_for_ready(api_base, timeout=90):
    """Poll the fast health check until the models finish loading."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{api_base}/", timeout=8)
            if r.status_code == 200 and r.json().get("models_ready"):
                return True
            last = f"models_ready=false (HTTP {r.status_code})"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(2)
    die(f"model API at {api_base} never became ready within {timeout}s (last: {last})")


def top3_from_records(records):
    """Given per-driver prediction records, return the 3 driverRefs with the
    highest podium_probability, most-likely first."""
    ranked = sorted(records, key=lambda d: d.get("podium_probability", 0), reverse=True)
    top3 = ranked[:3]
    if len(top3) < 3:
        die(f"expected >=3 drivers in prediction, got {len(top3)}")
    refs = [d["driverRef"] for d in top3]
    names = {d["driverRef"]: d.get("driver_name", d["driverRef"]) for d in ranked}
    probs = {d["driverRef"]: d.get("podium_probability", 0) for d in ranked}
    return refs, names, probs


def predict_completed(api_base, race_id):
    """Model pick for a race that already has result rows (uses /predict)."""
    r = requests.get(f"{api_base}/predict/{race_id}", timeout=30)
    if r.status_code != 200:
        die(f"/predict/{race_id} returned HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        die(f"/predict/{race_id}: {data['error']}")
    return top3_from_records(data)


def predict_upcoming(api_base, race_id):
    """Model pick for an upcoming race with no result rows yet (uses /whatif
    with auto_quali, so the grid is the model's own predicted qualifying)."""
    circuit = UPCOMING_CIRCUIT.get(race_id)
    if not circuit:
        die(f"raceId {race_id} isn't a known upcoming race (no circuitRef mapping)")
    body = [{"driverRef": ref, "grid": grid} for ref, grid in ROSTER]
    r = requests.post(
        f"{api_base}/whatif",
        params={"circuitRef": circuit, "auto_quali": "true"},
        json=body,
        timeout=60,
    )
    if r.status_code != 200:
        die(f"/whatif ({circuit}) returned HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    if not data:
        die(f"/whatif ({circuit}) returned no predictions")
    return top3_from_records(data)


# ── Supabase (service-role) ──────────────────────────────────────
class Supa:
    def __init__(self, url, key):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.h = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def get_snapshot(self, race_id):
        r = requests.get(
            f"{self.base}/model_snapshots",
            params={"race_id": f"eq.{race_id}", "select": "race_id"},
            headers=self.h, timeout=20,
        )
        if r.status_code != 200:
            die(f"reading model_snapshots (race {race_id}) failed: HTTP {r.status_code}: {r.text[:200]}")
        return r.json()

    def insert(self, row):
        r = requests.post(
            f"{self.base}/model_snapshots",
            headers={**self.h, "Prefer": "return=representation"},
            json=row, timeout=20,
        )
        if r.status_code not in (200, 201):
            die(f"insert (race {row['race_id']}) failed: HTTP {r.status_code}: {r.text[:300]}")

    def update(self, race_id, row):
        r = requests.patch(
            f"{self.base}/model_snapshots",
            params={"race_id": f"eq.{race_id}"},
            headers={**self.h, "Prefer": "return=representation"},
            json=row, timeout=20,
        )
        if r.status_code not in (200, 204):
            die(f"update (race {race_id}) failed: HTTP {r.status_code}: {r.text[:300]}")


# ── Presentation ─────────────────────────────────────────────────
def last(name):
    return name.split(" ")[-1] if name else name


def print_header(title):
    print(f"\n{title}")
    print(f"{'RaceId':>6}  {'Rd':>3}  {'Race':<24}  {'P1':<22}{'P2':<22}{'P3':<22}  Status")
    print("-" * 128)


def fmt_pick(ref, names, probs):
    return f"{last(names.get(ref, ref))} {probs.get(ref, 0) * 100:4.1f}%"


def print_row(race_id, rnd, name, refs, names, probs, status):
    cells = [fmt_pick(r, names, probs) for r in refs]
    print(f"{race_id:>6}  {str(rnd):>3}  {name:<24}  {cells[0]:<22}{cells[1]:<22}{cells[2]:<22}  {status}")


# ── Modes ────────────────────────────────────────────────────────
def snapshot_one(supa, api_base, race_id, refs, names, probs, rnd, name, *, force, dry_run):
    """Decide insert / update / skip for one race and (unless dry-run) do it.
    Returns the status string."""
    row = {
        "race_id": race_id,
        "predicted_p1": refs[0],
        "predicted_p2": refs[1],
        "predicted_p3": refs[2],
    }
    if dry_run:
        return "DRY-RUN (no write)"

    existing = supa.get_snapshot(race_id)
    if existing:
        if not force:
            return "SKIPPED (exists)"
        supa.update(race_id, row)
        return "OVERWRITTEN (--force)"
    supa.insert(row)
    return "INSERTED"


def run_backfill(args, supa, api_base):
    print_header("BACKFILL - completed 2026 races (model /predict top-3)")
    for race_id, rnd, name in COMPLETED_2026:
        refs, names, probs = predict_completed(api_base, race_id)
        # Backfill never overwrites (force is meaningless here).
        status = snapshot_one(supa, api_base, race_id, refs, names, probs, rnd, name,
                              force=False, dry_run=args.dry_run)
        print_row(race_id, rnd, name, refs, names, probs, status)
    print()


def run_single(args, supa, api_base):
    race_id = args.race_id
    upcoming = race_id not in COMPLETED_IDS
    if upcoming:
        refs, names, probs = predict_upcoming(api_base, race_id)
        rnd, name = "—", UPCOMING_NAME.get(race_id, f"race {race_id}")
        source = "/whatif auto-quali"
    else:
        refs, names, probs = predict_completed(api_base, race_id)
        rnd, name = RACE_ROUND[race_id], RACE_NAME[race_id]
        source = "/predict"

    print_header(f"SINGLE RACE {race_id} ({name}) — model pick via {source}")
    status = snapshot_one(supa, api_base, race_id, refs, names, probs, rnd, name,
                          force=args.force, dry_run=args.dry_run)
    print_row(race_id, rnd, name, refs, names, probs, status)
    if status.startswith("SKIPPED"):
        print("\nA snapshot already exists for this race. Re-run with --force to overwrite "
              "(only if you genuinely intend to — this race has a fairness deadline).")
    print()


def main():
    ap = argparse.ArgumentParser(description="Snapshot the model's top-3 podium pick into Supabase.")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--backfill", action="store_true", help="snapshot all completed 2026 races")
    mode.add_argument("--race-id", type=int, help="snapshot a single race")
    ap.add_argument("--force", action="store_true", help="(--race-id) overwrite an existing snapshot")
    ap.add_argument("--dry-run", action="store_true", help="print picks but write nothing (no secret needed)")
    ap.add_argument("--api-base", default=DEFAULT_API_BASE, help="model API base URL")
    args = ap.parse_args()

    if args.force and args.backfill:
        die("--force applies only to --race-id, not --backfill")

    api_base = args.api_base.rstrip("/")

    # Supabase client only when we actually write.
    supa = None
    if not args.dry_run:
        key = os.environ.get("SUPABASE_SECRET_KEY")
        if not key:
            die("SUPABASE_SECRET_KEY is not set. Set it (service-role secret) or use --dry-run.")
        supa_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL)
        supa = Supa(supa_url, key)

    wait_for_ready(api_base)

    if args.backfill:
        run_backfill(args, supa, api_base)
    else:
        run_single(args, supa, api_base)


if __name__ == "__main__":
    main()
