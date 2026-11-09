#!/usr/bin/env python3
"""Freeze the model's P1/P2/P3 pick for a race into Supabase's
`model_snapshots` table, so the My Picks results view can compare a user's pick
against what the model predicted — captured at snapshot time, not recomputed
later with hindsight.

predicted_p1 is the model's WIN-probability favorite across the whole field;
predicted_p2/p3 are the next two highest by PODIUM probability, excluding
whoever is p1. (Before 2026-10-19 all three slots were picked purely by
podium probability, which could make predicted_p1 someone other than the
model's actual highest-confidence winner call -- see the
fix/snapshot-winner-semantics commit.)

Modes (exactly one required):

  --backfill        Snapshot every COMPLETED 2026 race listed in COMPLETED_2026
                    (rounds 1-11, 13, 14 and 15, raceIds 1169-1179, 1181-1183;
                    see the notes there on why rounds 12, 16 and 17 are
                    excluded) via the /predict/{race_id} endpoint — the same
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

import season_data

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
    (1179, 11, "Hungarian GP"),
    # NOTE: the Dutch GP (1180, round 12) is COMPLETED but is deliberately NOT
    # listed here. Its pre-race snapshot was never taken before the Aug 21
    # deadline, and --backfill would insert one derived from /predict with the
    # REAL grid -- i.e. a hindsight pick presented as the model's call. Jaime
    # decided on 2026-08-27 to leave that race's Model column empty instead.
    # Adding 1180 to this list would silently undo that decision.
    (1181, 13, "Italian GP"),
    # 1182 (Spanish GP, round 14) has a model_snapshots row, but it was taken
    # 2026-09-12T23:42Z -- AFTER that race's real quali cutoff (2026-09-12T14:00Z),
    # not before it. No hindsight leak occurred (results.csv/qualifying.csv had
    # no 1182 rows yet at snapshot time, so it went via /whatif auto-quali, not
    # the real grid) but it is not a genuine pre-cutoff foresight pick either.
    # Listed here because it IS completed and DOES have a snapshot; the
    # Accuracy Tracker's own qualiISO check is what actually flags the timing.
    (1182, 14, "Spanish GP (Madrid)"),
    # 1183 (Azerbaijan GP, round 15) has a model_snapshots row taken
    # 2026-09-23T20:36Z, BEFORE its real quali cutoff (2026-09-25T12:00Z) --
    # a genuine pre-race foresight pick.
    (1183, 15, "Azerbaijan GP"),
    # NOTE: Bahrain GP in Malaysia (1184, round 16) and the Singapore GP
    # (1185, round 17) are COMPLETED but are deliberately NOT listed here,
    # same reasoning as the Dutch GP (1180) above: no pre-race snapshot was
    # ever taken for either (the snapshot-model-pick workflow has never
    # successfully run -- see the 2026-10-18 Actions audit), and --backfill
    # would insert a hindsight pick derived from /predict on the real grid.
    # Their Model column stays empty. Adding them here would silently undo
    # that decision.
    #
    # NOTE: the United States GP (1186, round 18) and Mexico City GP (1187,
    # round 19) are likewise COMPLETED and deliberately NOT listed. The
    # workflow reached its write step inside both snapshot windows and failed
    # there on every 3-hourly attempt (Actions history; MISSED-cutoff issues
    # #1 and #2), so both cutoffs (2026-10-24T21:00Z, 2026-10-31T21:00Z) passed
    # with no snapshot. --backfill would insert a hindsight pick from the real
    # grid. Their Model column stays empty -- never backfill.
    #
    # 1188 (Brazilian GP, round 20) is COMPLETED and DOES have a genuine pre-race
    # snapshot (frozen 2026-11-05T19:38Z, before the 2026-11-07T18:00Z cutoff;
    # source whatif_auto_quali, inputs_as_of_race_id 1187). Listing it here only
    # mirrors the frontend's COMPLETED_2026; --backfill never overwrites, so the
    # stored row stays exactly as frozen (it is reported as SKIPPED).
    (1188, 20, "Brazilian GP"),
]
COMPLETED_IDS = {rid for rid, _, _ in COMPLETED_2026}
RACE_NAME = {rid: name for rid, _, name in COMPLETED_2026}
RACE_ROUND = {rid: rnd for rid, rnd, _ in COMPLETED_2026}

# Upcoming races and the entry list are DERIVED from the committed CSVs
# (season_data.py), not kept in dicts that need editing after every race. A race
# with result rows (1180, 1184-1187 included) is not "upcoming", so it can never
# be snapshotted through the /whatif path -- which is also what keeps a late
# hindsight pick for a missed race out of the table.
SEASON = 2026


def upcoming_by_id():
    return {r["raceId"]: r for r in season_data.upcoming_races(SEASON)}


# Written alongside the picks when the model_snapshots table has the columns
# (supabase/migrations/00007_snapshot_provenance.sql). If the migration has not
# been applied yet the insert is retried without them -- losing the provenance
# is better than losing the snapshot to a schema lag.
PROVENANCE_KEYS = ("model_version", "git_commit", "inputs_as_of_race_id", "cutoff_at", "source")
PROVENANCE = {}


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
    """Winner-first pick: P1 is whoever the WIN model ranks highest across the
    whole field (not necessarily the podium favorite -- a win is a subset of a
    podium, so they're related but different questions). P2/P3 are the next
    two highest by podium_probability, excluding whoever was already picked
    as P1. Also returns podium_refs, the OLD pure-podium-probability top 3
    (unaffected by this change), so that information isn't lost now that P1
    no longer means "most likely to podium" -- see snapshot_one().

    Returns (refs, names, probs, wins, podium_refs)."""
    if len(records) < 3:
        die(f"expected >=3 drivers in prediction, got {len(records)}")

    by_podium = sorted(records, key=lambda d: d.get("podium_probability", 0), reverse=True)
    podium_refs = [d["driverRef"] for d in by_podium[:3]]

    by_win = sorted(records, key=lambda d: d.get("win_probability", 0), reverse=True)
    winner_ref = by_win[0]["driverRef"]
    next_two_by_podium = [d["driverRef"] for d in by_podium if d["driverRef"] != winner_ref][:2]
    refs = [winner_ref] + next_two_by_podium

    names = {d["driverRef"]: d.get("driver_name", d["driverRef"]) for d in records}
    probs = {d["driverRef"]: d.get("podium_probability", 0) for d in records}
    wins = {d["driverRef"]: d.get("win_probability", 0) for d in records}
    return refs, names, probs, wins, podium_refs


def predict_completed(api_base, race_id):
    """Model pick for a race that already has result rows (uses /predict)."""
    r = requests.get(f"{api_base}/predict/{race_id}", timeout=30)
    if r.status_code != 200:
        die(f"/predict/{race_id} returned HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        die(f"/predict/{race_id}: {data['error']}")
    PROVENANCE["source"] = "predict_real_grid"
    return top3_from_records(data)


def predict_upcoming(api_base, race_id):
    """Model pick for an upcoming race with no result rows yet (uses /whatif
    with auto_quali, so the grid is the model's own predicted qualifying)."""
    race = upcoming_by_id().get(race_id)
    if not race:
        die(f"raceId {race_id} isn't an upcoming {SEASON} race (it has result rows, or isn't in races.csv)")
    circuit = race["circuitRef"]
    entries = season_data.entry_list(SEASON, race_id=race_id)
    roster = [(ref, grid) for ref, grid, _ in entries]
    if len(roster) < 20:
        die(f"derived roster has only {len(roster)} drivers -- refusing to snapshot on a partial entry list")
    # The forecast must be built from features ENTERING this race (rolled forward from the last completed race). An API that does
    # not say so is an older deploy that would silently use last race's state: refuse rather than write a mislabelled pick.
    m = get_json_with_retry(f"{api_base}/meta", "API /meta")
    entering = m.get("features_entering") or {}
    if m.get("feature_roll") != "rolled_forward" or entering.get("raceId") != race_id:
        die(f"ROLL-FORWARD GUARD: the API says feature_roll={m.get('feature_roll')!r}, features_entering={entering or None}, "
            f"but this snapshot is for raceId {race_id}. The deployed backend predates the roll-forward fix or its data is not "
            "at the race before this one. Refusing to snapshot (nothing was written).")
    print(f"features entering: raceId {entering['raceId']} {entering.get('name')} (rolled forward from the last completed race)")
    PROVENANCE["source"] = "whatif_auto_quali_rolled"
    body = [{"driverRef": ref, "grid": grid, "constructorRef": cref} for ref, grid, cref in entries]
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
    print(f"ENTRY LIST for {race['name']}: {len(roster)} drivers sent ({', '.join(ref for ref, _ in roster)}); "
          f"{len(data)} predicted.")
    missing = season_data.unpredicted(roster, data)
    if missing:
        print(f"WARNING: /whatif returned no prediction for {missing} (no history rows in the model's data). "
              "They are left out of this pick; check the entry list.", file=sys.stderr)
    print_forecast_table(data)
    return top3_from_records(data)


def print_forecast_table(records):
    """The whole field the pick was drawn from, as shares (win shares add up to 100%), with the raw scores."""
    win_sum = sum(r.get("win_probability", 0) for r in records) or 1.0
    pod_sum = sum(r.get("podium_probability", 0) for r in records) or 1.0
    print(f"\n{'driver':<18}{'team':<16}{'pred grid':>9}{'win score':>11}{'win share':>10}{'podium score':>14}{'podium share':>13}")
    for r in sorted(records, key=lambda d: d.get("podium_probability", 0), reverse=True):
        print(f"{r['driverRef']:<18}{str(r.get('team', ''))[:15]:<16}{r.get('grid', ''):>9}{r.get('win_probability', 0):>11.4f}"
              f"{100 * r.get('win_probability', 0) / win_sum:>9.0f}%{r.get('podium_probability', 0):>14.4f}{300 * r.get('podium_probability', 0) / pod_sum:>12.0f}%")
    print()


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

    @staticmethod
    def _missing_column(r):
        return r.status_code == 400 and "PGRST204" in r.text

    def insert(self, row):
        r = requests.post(
            f"{self.base}/model_snapshots",
            headers={**self.h, "Prefer": "return=representation"},
            json=row, timeout=20,
        )
        if self._missing_column(r):
            base = {k: v for k, v in row.items() if k not in PROVENANCE_KEYS}
            print("WARNING: model_snapshots has no provenance columns yet (apply "
                  "supabase/migrations/00007_snapshot_provenance.sql). Inserting the pick WITHOUT "
                  f"model_version/as-of -- dropped: {sorted(set(row) - set(base))}", file=sys.stderr)
            r = requests.post(
                f"{self.base}/model_snapshots",
                headers={**self.h, "Prefer": "return=representation"},
                json=base, timeout=20,
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
        if self._missing_column(r):
            base = {k: v for k, v in row.items() if k not in PROVENANCE_KEYS}
            print("WARNING: model_snapshots has no provenance columns yet; updating without them.", file=sys.stderr)
            r = requests.patch(
                f"{self.base}/model_snapshots",
                params={"race_id": f"eq.{race_id}"},
                headers={**self.h, "Prefer": "return=representation"},
                json=base, timeout=20,
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


def print_row(race_id, rnd, name, refs, names, probs, status, podium_refs=None):
    cells = [fmt_pick(r, names, probs) for r in refs]
    print(f"{race_id:>6}  {str(rnd):>3}  {name:<24}  {cells[0]:<22}{cells[1]:<22}{cells[2]:<22}  {status}")
    # The win-first rule can reorder (or, rarely, swap a driver out of) the
    # old pure-podium-probability top 3. Surfaced here for visibility since
    # it isn't written to Supabase (no new columns -- see snapshot_one).
    if podium_refs is not None and podium_refs != refs:
        old_names = ", ".join(last(names.get(r, r)) for r in podium_refs)
        print(f"{'':>6}  {'':>3}  {'(old podium-rank rule:':<24}  {old_names})")


# ── Modes ────────────────────────────────────────────────────────
def snapshot_one(supa, api_base, race_id, refs, names, probs, wins, rnd, name, *, force, dry_run):
    """Decide insert / update / skip for one race and (unless dry-run) do it.
    Returns the status string.

    predicted_p1 is the win-probability favorite (argmax across the whole
    field, not just among podium favorites); predicted_p2/p3 are the next two
    highest by podium_probability, excluding p1. This is a change in WHAT
    SELECTS each slot, not in the table's columns -- predicted_p1/p2/p3 and
    p1_win/p1_podium/p2_win/p2_podium/p3_win/p3_podium are the same 9 columns
    as before. We don't write the old pure-podium top 3 anywhere (that would
    need new model_snapshots columns, which requires a Supabase migration
    this script has no access to run) -- it's only surfaced in print_row()
    for visibility when it differs from the new pick."""
    row = {
        "race_id": race_id,
        "predicted_p1": refs[0],
        "predicted_p2": refs[1],
        "predicted_p3": refs[2],
        # Frozen probabilities per pick (win + podium), 4dp like the API.
        "p1_win": round(wins[refs[0]], 4), "p1_podium": round(probs[refs[0]], 4),
        "p2_win": round(wins[refs[1]], 4), "p2_podium": round(probs[refs[1]], 4),
        "p3_win": round(wins[refs[2]], 4), "p3_podium": round(probs[refs[2]], 4),
        **{k: v for k, v in PROVENANCE.items() if k in PROVENANCE_KEYS and v is not None},
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
        refs, names, probs, wins, podium_refs = predict_completed(api_base, race_id)
        # Backfill never overwrites (force is meaningless here).
        status = snapshot_one(supa, api_base, race_id, refs, names, probs, wins, rnd, name,
                              force=False, dry_run=args.dry_run)
        print_row(race_id, rnd, name, refs, names, probs, status, podium_refs)
    print()


def run_single(args, supa, api_base):
    race_id = args.race_id
    upcoming = race_id not in COMPLETED_IDS
    if upcoming:
        refs, names, probs, wins, podium_refs = predict_upcoming(api_base, race_id)
        race = upcoming_by_id().get(race_id, {})
        rnd, name = race.get("round", "—"), race.get("name", f"race {race_id}")
        source = "/whatif auto-quali, features rolled forward"
    else:
        refs, names, probs, wins, podium_refs = predict_completed(api_base, race_id)
        rnd, name = RACE_ROUND[race_id], RACE_NAME[race_id]
        source = "/predict"

    print_header(f"SINGLE RACE {race_id} ({name}) — model pick via {source}")
    status = snapshot_one(supa, api_base, race_id, refs, names, probs, wins, rnd, name,
                          force=args.force, dry_run=args.dry_run)
    print_row(race_id, rnd, name, refs, names, probs, status, podium_refs)
    if status.startswith("SKIPPED"):
        print("\nA snapshot already exists for this race. Re-run with --force to overwrite "
              "(only if you genuinely intend to — this race has a fairness deadline).")
    print()


# Jolpica circuitId where it differs from our circuitRef (mirror of
# due_snapshot.CIRCUIT_ALIAS; matching is by circuit, never by round number).
JOLPICA_CIRCUIT_ALIAS = {"madrid": "madring"}


# The guard's two reads (the API's /meta and Jolpica) are retried before the job
# fails: one transient 502 or timeout must not cost a snapshot, but a persistent
# failure must still abort. 3 retries after the first attempt, with backoff.
# GUARD_BACKOFF_S="0,0,0" makes tests instant.
GUARD_BACKOFF_S = tuple(float(x) for x in os.environ.get("GUARD_BACKOFF_S", "3,9,27").split(","))


def get_json_with_retry(url, what):
    """GET url -> parsed JSON. Retries (len(GUARD_BACKOFF_S) times) on network
    errors, 5xx/429 and bad JSON; a definitive 4xx fails at once. Returns the
    payload or raises RuntimeError with the last reason."""
    last = "no attempt made"
    for attempt in range(len(GUARD_BACKOFF_S) + 1):
        if attempt:
            delay = GUARD_BACKOFF_S[attempt - 1]
            print(f"  retry {attempt}/{len(GUARD_BACKOFF_S)} for {what} in {delay:g}s (last: {last})", file=sys.stderr)
            time.sleep(delay)
        try:
            r = requests.get(url, timeout=30)
        except requests.RequestException as e:
            last = f"{type(e).__name__}: {e}"
            continue
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError as e:
                last = f"invalid JSON ({e})"
                continue
        last = f"HTTP {r.status_code}"
        if r.status_code < 500 and r.status_code != 429:
            break  # definitive: retrying will not change it
    raise RuntimeError(last)


def last_completed_race_id():
    """(raceId, name) of the race Jolpica most recently published results for --
    the reference for "how fresh must the backend's data be". Deliberately NOT
    taken from this repo's results.csv: if an ingest was missed, the repo and the
    backend would be stale together and agree with each other."""
    try:
        payload = get_json_with_retry(f"https://api.jolpi.ca/ergast/f1/{SEASON}/last/results.json", "Jolpica last results")
        races = payload["MRData"]["RaceTable"]["Races"]
    except (RuntimeError, KeyError, TypeError) as e:
        die(f"STALE-DATA GUARD: could not read Jolpica's last completed race ({e}), so data freshness "
            "cannot be verified. Refusing to snapshot (nothing was written).")
    if not races:
        die("STALE-DATA GUARD: Jolpica returned no completed 2026 race. Refusing to snapshot.")
    circuit = races[0]["Circuit"]["circuitId"]
    for race in season_data.season_races(SEASON):
        if JOLPICA_CIRCUIT_ALIAS.get(race["circuitRef"], race["circuitRef"]) == circuit:
            return race["raceId"], race["name"]
    die(f"STALE-DATA GUARD: Jolpica's last completed race (circuit {circuit}) is not in races.csv. "
        "Refusing to snapshot (nothing was written).")


def require_fresh_inputs(api_base):
    """Abort -- before anything is computed or written -- unless the backend's
    data horizon (/meta inputs_as_of.raceId) includes the last completed race.

    A snapshot is supposed to be the model's forecast on everything known. If the
    deployed backend has not picked up the latest race (a missed ingest, a Render
    deploy that lagged), a pick would be silently stale AND frozen forever. The
    abort exits non-zero, which opens the 'Snapshot pipeline FAILING' issue.
    Returns the /meta payload. Fails closed: an unreachable /meta also aborts."""
    try:
        m = get_json_with_retry(f"{api_base}/meta", "API /meta")
        horizon = int(m["inputs_as_of"]["raceId"])
        m["model_version"]
    except Exception as e:
        die(f"STALE-DATA GUARD: could not read {api_base}/meta ({e!r}) -- cannot verify the backend's "
            "data horizon. Refusing to snapshot (nothing was written).")
    need_id, need_name = last_completed_race_id()
    if horizon < need_id:
        die(f"STALE-DATA GUARD: backend data ends at raceId {horizon} "
            f"({m['inputs_as_of'].get('name')}) but the last completed race is raceId {need_id} "
            f"({need_name}). The backend is serving stale data: ingest/redeploy first. "
            "Refusing to snapshot (nothing was written).")
    print(f"data horizon OK: backend includes raceId {horizon} (last completed: {need_id} {need_name})")
    return m


def check_access(url, key):
    """READ-ONLY check that the secret is present and is a secret key. Run on
    every scheduled workflow tick, so a missing/wrong SUPABASE_SECRET_KEY is
    found days before a cutoff, not at it (that is how the US and Mexico City
    snapshots were lost: the write step failed on every attempt).

    Sends one GET and nothing else -- it does not touch the table's rows.
      1. the key is set;
      2. its FORMAT is a secret key (sb_secret_..., or a legacy JWT whose role
         claim is service_role). A publishable/anon key passes a plain read of
         this table, so format is what catches it pasted into the wrong slot;
      3. a GET of model_snapshots succeeds (right project, not truncated).
    What it does NOT prove: that the role may INSERT. A write grant cannot be
    probed without writing; that is exercised by the real snapshot (and by the
    dry-run dispatch, which computes but does not write)."""
    if not key:
        die("SUPABASE_SECRET_KEY is empty or unset. Add it under GitHub -> Settings -> "
            "Secrets and variables -> Actions (the service-role secret key, not the publishable one).")
    if key.startswith("sb_publishable_"):
        die("SUPABASE_SECRET_KEY holds a PUBLISHABLE key (sb_publishable_...). Put the secret key "
            "(sb_secret_...) in this slot.")
    if key.count(".") == 2:  # legacy JWT-style key: check its role claim
        import base64, json
        try:
            seg = key.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))).get("role")
        except Exception:
            role = None
        if role != "service_role":
            die(f"SUPABASE_SECRET_KEY is a JWT with role {role!r}, not 'service_role'.")
    elif not key.startswith("sb_secret_"):
        die("SUPABASE_SECRET_KEY has an unrecognized format (expected sb_secret_... or a service_role JWT).")
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = requests.get(f"{url.rstrip('/')}/rest/v1/model_snapshots",
                     params={"select": "race_id", "limit": "1"}, headers=h, timeout=20)
    if r.status_code != 200:
        die(f"SUPABASE_SECRET_KEY cannot read model_snapshots: HTTP {r.status_code} {r.text[:160]} -- "
            "the secret is wrong, truncated, or for a different project")
    print("supabase access OK (read-only check): secret key format valid, model_snapshots readable. "
          "Write grants are not probed.")


def main():
    ap = argparse.ArgumentParser(description="Snapshot the model's top-3 podium pick into Supabase.")
    ap.add_argument("--check-access", action="store_true",
                    help="verify the Supabase secret works (read + write probe, no row created) and exit")
    ap.add_argument("--cutoff", help="the real cutoff (ISO-8601 UTC) this snapshot is frozen against; stored as cutoff_at")
    mode = ap.add_mutually_exclusive_group(required=False)
    mode.add_argument("--backfill", action="store_true", help="snapshot all completed 2026 races")
    mode.add_argument("--race-id", type=int, help="snapshot a single race")
    ap.add_argument("--force", action="store_true", help="(--race-id) overwrite an existing snapshot")
    ap.add_argument("--dry-run", action="store_true", help="print picks but write nothing (no secret needed)")
    ap.add_argument("--api-base", default=DEFAULT_API_BASE, help="model API base URL")
    args = ap.parse_args()

    if args.check_access:
        check_access(os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL),
                     os.environ.get("SUPABASE_SECRET_KEY"))
        return
    if not args.backfill and not args.race_id:
        ap.error("one of --backfill / --race-id (or --check-access) is required")

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

    # Refuse to proceed on stale inputs (aborts + alerts via the workflow's
    # failure issue), then record what produced this pick. /meta is the API's own
    # statement of its model hash, deployed commit and newest input race.
    m = require_fresh_inputs(api_base)
    PROVENANCE.update(model_version=m["model_version"], git_commit=m.get("git_commit"),
                      inputs_as_of_race_id=m["inputs_as_of"]["raceId"])
    if args.cutoff:
        PROVENANCE["cutoff_at"] = args.cutoff

    if args.backfill:
        run_backfill(args, supa, api_base)
    else:
        run_single(args, supa, api_base)


if __name__ == "__main__":
    main()
