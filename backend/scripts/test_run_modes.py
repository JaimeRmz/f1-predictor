#!/usr/bin/env python3
"""Tests for the snapshot workflow's run modes (dry run vs write).

    python backend/scripts/test_run_modes.py

Part 1 (offline): the dry-run rule, as a truth table.
Part 2 (offline): the workflow file itself -- the raw `dry_run` input is read in
         exactly the two places that feed resolve_run.py, and the snapshot step's
         --dry-run flag comes from the resolved mode.
Part 3 (needs network: the live model API and Jolpica; Supabase is a LOCAL MOCK,
         production is never contacted): the real chain
         resolve_run -> due_snapshot -> snapshot_model_pick, for each event type,
         asserting whether an INSERT reaches Supabase. The headline case is a
         SCHEDULE event with EMPTY inputs and a due race: it must WRITE.
"""
import json
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
WORKFLOW = os.path.join(REPO, ".github", "workflows", "snapshot-model-pick.yml")
LIVE_API = os.environ.get("API_BASE", "https://f1-predictor-api-m75n.onrender.com")
DUE_NOW = "2026-11-06T12:00:00Z"  # 30h before the Brazil cutoff: inside the 48h..2h window

sys.path.insert(0, HERE)
from resolve_run import resolve  # noqa: E402

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
    ("schedule",          "true",  "1188",  "false", "false"),
    ("workflow_dispatch", "true",  "",      "true",  "false"),  # dispatch default
    ("workflow_dispatch", "false", "",      "false", "false"),  # dispatch, unticked
    ("workflow_dispatch", "true",  "1188",  "true",  "true"),   # forced + default dry
    ("workflow_dispatch", "false", "1188",  "false", "true"),   # forced, unticked -> real write
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


srv = HTTPServer(("127.0.0.1", 0), MockSupabase)
threading.Thread(target=srv.serve_forever, daemon=True).start()
ENV = dict(os.environ, SUPABASE_URL=f"http://127.0.0.1:{srv.server_port}", SUPABASE_SECRET_KEY="sb_secret_dummy",
           SUPABASE_PUBLISHABLE_KEY="sb_publishable_dummy", GUARD_BACKOFF_S="1,2,4", PYTHONIOENCODING="utf8")


def py(script, *args, env=None):
    return subprocess.run([sys.executable, os.path.join(HERE, script), *args], env=env or ENV,
                          capture_output=True, text=True, timeout=300)


def kv(text):
    return dict(p.split("=", 1) for line in text.splitlines() for p in line.split(" ") if "=" in p)


def simulate(event, dry_input, race_input):
    """Run the workflow's chain for one event; return (resolved, due, inserts, snapshot_rc)."""
    MockSupabase.inserts.clear()
    mode = kv(py("resolve_run.py", env=dict(ENV, EVENT=event, INPUT_DRY_RUN=dry_input, INPUT_RACE_ID=race_input)).stdout)
    if race_input:
        due_args = ["--season", "2026", "--race-id", race_input, "--now", DUE_NOW]
    else:
        due_args = ["--season", "2026", "--now", DUE_NOW] + (["--next"] if mode["dry"] == "true" else [])
    due = kv(py("due_snapshot.py", *due_args).stdout)
    rc = None
    if due.get("action") == "write":  # exactly the workflow's Snapshot step
        snap_args = ["--race-id", due["race_id"], "--api-base", LIVE_API]
        if due.get("cutoff"):
            snap_args += ["--cutoff", due["cutoff"]]
        if mode["dry"] == "true":
            snap_args += ["--dry-run"]
        rc = py("snapshot_model_pick.py", *snap_args).returncode
    return mode, due, list(MockSupabase.inserts), rc


print("\nPart 3: end-to-end chain (live model API + Jolpica; Supabase = local mock)")

mode, due, ins, rc = simulate("schedule", "", "")
check("SCHEDULE, empty inputs, due race: resolves dry=false", mode["dry"] == "false")
check("SCHEDULE, empty inputs, due race: decide step says write for raceId 1188",
      due.get("action") == "write" and due.get("race_id") == "1188", str(due))
check("SCHEDULE, empty inputs, due race: snapshot step exits 0", rc == 0, f"rc={rc}")
check("SCHEDULE, empty inputs, due race: WRITES exactly one row to model_snapshots", len(ins) == 1, f"{len(ins)} inserts")
if ins:
    row = ins[0]
    check("  ...the row is raceId 1188 with the pick and provenance",
          row.get("race_id") == 1188 and row.get("predicted_p1") and row.get("model_version")
          and row.get("cutoff_at") == "2026-11-07T18:00:00Z" and row.get("source") == "whatif_auto_quali", str(row))

mode, due, ins, rc = simulate("workflow_dispatch", "true", "")
check("DISPATCH default (dry_run=true): computes (rc 0) and writes NOTHING", rc == 0 and len(ins) == 0, f"rc={rc} inserts={len(ins)}")

mode, due, ins, rc = simulate("workflow_dispatch", "false", "")
check("DISPATCH unticked, race inside the window: WRITES one row", rc == 0 and len(ins) == 1, f"rc={rc} inserts={len(ins)}")

mode, due, ins, rc = simulate("workflow_dispatch", "true", "1188")
check("DISPATCH race_id=1188 + dry_run (default): computes, carries the cutoff, writes NOTHING",
      rc == 0 and len(ins) == 0 and due.get("cutoff") == "2026-11-07T18:00:00Z", f"rc={rc} inserts={len(ins)} due={due}")

mode, due, ins, rc = simulate("workflow_dispatch", "false", "1188")
check("DISPATCH race_id=1188, dry_run unticked: WRITES one row with cutoff_at",
      rc == 0 and len(ins) == 1 and ins[0].get("cutoff_at") == "2026-11-07T18:00:00Z", f"rc={rc} inserts={len(ins)}")

print()
if failures:
    print(f"{len(failures)} FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL PASSED")
