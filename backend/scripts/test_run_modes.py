#!/usr/bin/env python3
"""Tests for the snapshot workflow's run modes (dry run vs write).

    python backend/scripts/test_run_modes.py

Part 1 (offline): the dry-run rule, as a truth table.
Part 2 (offline): the workflow file itself -- the raw `dry_run` input is read in
         exactly the two places that feed resolve_run.py, and the snapshot step's
         --dry-run flag comes from the resolved mode.
Part 3 (offline: the model API, Jolpica and Supabase are all LOCAL stand-ins; nothing is
         contacted): the real chain resolve_run -> due_snapshot -> snapshot_model_pick, for each
         event type, asserting whether an INSERT reaches Supabase. The headline case is a
         SCHEDULE event with EMPTY inputs and a due race: it must WRITE.
         Which race is "due", its cutoff and the "now" of the test are DERIVED from data/races.csv
         and results.csv (the next race with no results, 30 h before its qualifying start), so
         the test does not name a race and keeps working after every ingest.
"""
import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
WORKFLOW = os.path.join(REPO, ".github", "workflows", "snapshot-model-pick.yml")

sys.path.insert(0, HERE)
from resolve_run import resolve  # noqa: E402
import season_data as sd  # noqa: E402

# ── the race this test is about, derived from the data ──
SEASON = 2026
_up = sd.upcoming_races(SEASON)
NEXT = _up[0] if _up else None                      # first race with no result rows = the one that is due
NEXT_ID = str(NEXT["raceId"]) if NEXT else "0"
RID = NEXT_ID                                        # any race_id string works in Part 1; use the real one
LAST_DONE = [r for r in sd.season_races(SEASON) if r["raceId"] not in {x["raceId"] for x in _up}][-1]


def _races_row(race_id):
    for r in sd._rows("races.csv"):
        if int(r["raceId"]) == race_id:
            return r


if NEXT:
    _q = _races_row(NEXT["raceId"])
    CUTOFF_DT = datetime.fromisoformat(f"{_q['quali_date']}T{_q['quali_time']}+00:00").astimezone(timezone.utc)
    CUTOFF = CUTOFF_DT.strftime("%Y-%m-%dT%H:%M:%SZ")
    DUE_NOW = (CUTOFF_DT - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")   # 30 h before the cutoff: inside the 48 h..2 h window
else:
    CUTOFF = DUE_NOW = ""

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        failures.append(name)


# ── Part 1: the rule ─────────────────────────────────────────────
print("Part 1: dry-run rule (event, dry_run input, race_id input) -> dry, forced")
TABLE = [
    # event,              dry_run, race_id, dry,     forced
    ("schedule",          "",      "",      "false", "false"),  # inputs empty
    ("schedule",          "true",  "",      "false", "false"),  # even if inputs were somehow set
    ("schedule",          "true",  RID,     "false", "false"),
    ("workflow_dispatch", "true",  "",      "true",  "false"),  # dispatch default
    ("workflow_dispatch", "false", "",      "false", "false"),  # dispatch, unticked
    ("workflow_dispatch", "true",  RID,     "true",  "true"),   # forced + default dry
    ("workflow_dispatch", "false", RID,     "false", "true"),   # forced, unticked -> real write
    ("workflow_dispatch", "",      "",      "false", "false"),  # input absent on dispatch
    ("push",              "true",  "",      "false", "false"),  # any other event is never dry
]
for ev, dr, rid, want_dry, want_forced in TABLE:
    got = resolve(ev, dr, rid)
    check(f"{ev:<17} dry_run={dr!r:<7} race_id={rid!r:<7} -> dry={want_dry}, forced={want_forced}",
          got == {"dry": want_dry, "forced": want_forced}, str(got))

# ── Part 2: the workflow file ────────────────────────────────────
print("\nPart 2: workflow file")
wf = open(WORKFLOW, encoding="utf8").read()
raw = re.findall(r"github\.event\.inputs\.dry_run", wf)
check("raw dry_run input referenced exactly twice (Resolve mode + Run summary env)", len(raw) == 2, f"found {len(raw)}")
check("snapshot step derives --dry-run from the resolved mode",
      'if [ "${{ steps.mode.outputs.dry }}" = "true" ]; then DRY="--dry-run"; fi' in wf)
check("decide step derives --next from the resolved mode", 'if [ "$DRY" = "true" ]; then NEXT="--next"; fi' in wf)
check("'frozen' announcement is gated on the resolved mode", "steps.mode.outputs.dry != 'true'" in wf)
check("Resolve mode passes the event name", "EVENT: ${{ github.event_name }}" in wf)


# ── Part 3: the real chain, Supabase mocked ──────────────────────
class MockSupabase(BaseHTTPRequestHandler):
    inserts = []

    def log_message(self, *a):
        pass

    def _reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._reply(200, [])  # no snapshots exist yet

    def do_POST(self):
        row = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        MockSupabase.inserts.append(row)
        self._reply(201, [row])

    do_PATCH = do_DELETE = lambda self: self._reply(500, {"message": "unexpected write"})


class MockWorld(BaseHTTPRequestHandler):
    """Stand-ins for the model API and for Jolpica, built from the repo's own CSVs: no network."""
    posted = []

    def log_message(self, *a):
        pass

    def _reply(self, body, code=200):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        circuits = {r["circuitId"]: r["circuitRef"] for r in sd._rows("circuits.csv")}
        alias = {"madrid": "madring"}                                   # our circuitRef -> Jolpica circuitId, as due_snapshot.CIRCUIT_ALIAS
        jol = lambda race: alias.get(race["circuitRef"], race["circuitRef"])
        if path == "/":
            return self._reply({"message": "mock API", "models_ready": True})
        if path == "/meta":
            return self._reply({"model_version": "m-mock", "git_commit": None,
                                "inputs_as_of": {"raceId": LAST_DONE["raceId"], "year": SEASON, "round": LAST_DONE["round"], "name": LAST_DONE["name"]},
                                "feature_roll": "rolled_forward",
                                "features_entering": {"raceId": NEXT["raceId"], "year": SEASON, "round": NEXT["round"], "name": NEXT["name"]}})
        if path == f"/ergast/f1/{SEASON}/last/results.json":            # Jolpica: the last completed race
            return self._reply({"MRData": {"RaceTable": {"Races": [{"raceName": LAST_DONE["name"], "Circuit": {"circuitId": jol(LAST_DONE)}}]}}})
        if path == f"/ergast/f1/{SEASON}.json":                         # Jolpica: the season schedule with each race's qualifying slot
            races = []
            for r in sd.season_races(SEASON):
                row = _races_row(r["raceId"])
                races.append({"raceName": r["name"], "Circuit": {"circuitId": jol(r)},
                              "Qualifying": {"date": row["quali_date"], "time": row["quali_time"].rstrip("Z") + "Z"}})
            return self._reply({"MRData": {"RaceTable": {"Races": races}}})
        self._reply({"error": f"unexpected GET {self.path}"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.split("?")[0] == "/whatif":
            MockWorld.posted.append((self.path, body))
            recs = [{"driverRef": e["driverRef"], "driver_name": e["driverRef"], "team": e.get("constructorRef"), "grid": i + 1,
                     "podium_probability": round(0.95 - 0.03 * i, 4), "win_probability": round(0.60 - 0.025 * i, 4)} for i, e in enumerate(body)]
            return self._reply(recs)
        self._reply({"error": "unexpected POST"}, 404)


world = HTTPServer(("127.0.0.1", 0), MockWorld)
threading.Thread(target=world.serve_forever, daemon=True).start()
WORLD = f"http://127.0.0.1:{world.server_port}"

srv = HTTPServer(("127.0.0.1", 0), MockSupabase)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ENV = dict(os.environ, SUPABASE_URL=f"http://127.0.0.1:{srv.server_port}", SUPABASE_SECRET_KEY="sb_secret_dummy",
           SUPABASE_PUBLISHABLE_KEY="sb_publishable_dummy", GUARD_BACKOFF_S="0,0,0", PYTHONIOENCODING="utf8",
           JOLPICA_BASE=f"{WORLD}/ergast/f1")


def py(script, *args, env=None):
    return subprocess.run([sys.executable, os.path.join(HERE, script), *args], env=env or ENV,
                          capture_output=True, text=True, timeout=300)


def kv(text):
    return dict(p.split("=", 1) for line in text.splitlines() for p in line.split(" ") if "=" in p)


def simulate(event, dry_input, race_input):
    """Run the workflow's chain for one event; return (resolved, due, inserts, snapshot_rc)."""
    MockSupabase.inserts.clear()
    MockWorld.posted.clear()
    mode = kv(py("resolve_run.py", env=dict(ENV, EVENT=event, INPUT_DRY_RUN=dry_input, INPUT_RACE_ID=race_input)).stdout)
    if race_input:
        due_args = ["--season", "2026", "--race-id", race_input, "--now", DUE_NOW]
    else:
        due_args = ["--season", "2026", "--now", DUE_NOW] + (["--next"] if mode["dry"] == "true" else [])
    due = kv(py("due_snapshot.py", *due_args).stdout)
    rc = None
    if due.get("action") == "write":  # exactly the workflow's Snapshot step
        snap_args = ["--race-id", due["race_id"], "--api-base", WORLD]
        if due.get("cutoff"):
            snap_args += ["--cutoff", due["cutoff"]]
        if mode["dry"] == "true":
            snap_args += ["--dry-run"]
        rc = py("snapshot_model_pick.py", *snap_args).returncode
    return mode, due, list(MockSupabase.inserts), rc


print("\nPart 3: end-to-end chain (model API, Jolpica and Supabase are local stand-ins built from the repo's CSVs)")
if not NEXT:
    print("  SKIPPED: the data has no upcoming race, so no race can be due")
else:
    print(f"  due race derived from the data: raceId {NEXT_ID} ({NEXT['name']}), cutoff {CUTOFF}, test 'now' {DUE_NOW}")

    mode, due, ins, rc = simulate("schedule", "", "")
    check("SCHEDULE, empty inputs, due race: resolves dry=false", mode["dry"] == "false")
    check("SCHEDULE, empty inputs, due race: decide step says write for the due race",
          due.get("action") == "write" and due.get("race_id") == NEXT_ID, str(due))
    check("SCHEDULE, empty inputs, due race: snapshot step exits 0", rc == 0, f"rc={rc}")
    check("SCHEDULE, empty inputs, due race: WRITES exactly one row to model_snapshots", len(ins) == 1, f"{len(ins)} inserts")
    if ins:
        row = ins[0]
        check("  ...the row is the due race with the pick and provenance",
              row.get("race_id") == NEXT["raceId"] and row.get("predicted_p1") and row.get("model_version")
              and row.get("cutoff_at") == CUTOFF and row.get("source") == "whatif_auto_quali_rolled"
              and row.get("inputs_as_of_race_id") == LAST_DONE["raceId"], str(row))
    check("  ...the entry list it sent carries a constructor for every driver",
          len(MockWorld.posted) == 1 and all(e.get("constructorRef") for e in MockWorld.posted[0][1]), str(MockWorld.posted[:1])[:200])

    mode, due, ins, rc = simulate("workflow_dispatch", "true", "")
    check("DISPATCH default (dry_run=true): computes (rc 0) and writes NOTHING", rc == 0 and len(ins) == 0, f"rc={rc} inserts={len(ins)}")

    mode, due, ins, rc = simulate("workflow_dispatch", "false", "")
    check("DISPATCH unticked, race inside the window: WRITES one row", rc == 0 and len(ins) == 1, f"rc={rc} inserts={len(ins)}")

    mode, due, ins, rc = simulate("workflow_dispatch", "true", NEXT_ID)
    check("DISPATCH race_id + dry_run (default): computes, carries the cutoff, writes NOTHING",
          rc == 0 and len(ins) == 0 and due.get("cutoff") == CUTOFF, f"rc={rc} inserts={len(ins)} due={due}")

    mode, due, ins, rc = simulate("workflow_dispatch", "false", NEXT_ID)
    check("DISPATCH race_id, dry_run unticked: WRITES one row with cutoff_at",
          rc == 0 and len(ins) == 1 and ins[0].get("cutoff_at") == CUTOFF, f"rc={rc} inserts={len(ins)}")

    # a race that already has results can never be snapshotted through /whatif (the hindsight guard)
    mode, due, ins, rc = simulate("workflow_dispatch", "false", str(LAST_DONE["raceId"]))
    check("a race that already has results is refused and writes NOTHING (no hindsight snapshot)",
          len(ins) == 0 and rc not in (0, None), f"rc={rc} inserts={len(ins)} due={due}")

print()
if failures:
    print(f"{len(failures)} FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL PASSED")
