#!/usr/bin/env python3
"""Write the snapshot workflow's run summary: which path the run took and
whether anything was written. Always runs (even after a failure), so every run
leaves an unambiguous record -- a run that took the "nothing due" path while
looking like a dry run that computed something is exactly what this prevents.

Inputs come from the environment (set by the workflow); output is Markdown on
stdout, appended to $GITHUB_STEP_SUMMARY by the caller.
"""
import os


def classify(env):
    event, race_id = env.get("EVENT", ""), env.get("INPUT_RACE_ID", "")
    dry = env.get("INPUT_DRY_RUN", "") == "true"
    action = env.get("ACTION", "")
    if event == "workflow_dispatch" and race_id:
        path = f"FORCED race_id={race_id} (snapshot window ignored; cutoff still derived from Jolpica)"
    elif event == "workflow_dispatch" and dry:
        path = "DRY RUN on the next upcoming race (snapshot window ignored)"
    elif action == "write":
        path = "DUE: inside the snapshot window"
    elif action == "missed":
        path = "MISSED: cutoff is <2h away or has passed and no snapshot exists"
    elif action == "none":
        path = "NOTHING DUE: no race is inside the snapshot window"
    else:
        path = "NO PATH RESOLVED: a step before target resolution failed"
    return path, dry


def wrote(env, dry, log):
    if dry:
        return "NO - dry run (computed and printed only)"
    if env.get("SNAP_OUTCOME") != "success":
        return f"NO - snapshot step did not run to success (outcome: {env.get('SNAP_OUTCOME') or 'not run'})"
    if "INSERTED" in log or "OVERWRITTEN" in log:
        return "YES - a row was written to model_snapshots"
    if "SKIPPED" in log:
        return "NO - a snapshot for this race already exists (left untouched)"
    return "NO - the step succeeded but reported no insert"


def render(env, log):
    path, dry = classify(env)
    lines = [
        f"## Snapshot run - {env.get('EVENT') or 'unknown event'}",
        "",
        f"- **Path:** {path}",
        f"- **Mode:** {'DRY RUN' if dry else 'LIVE (writes enabled)'}",
        f"- **Race:** {env.get('RACE_NAME') or '-'} (raceId {env.get('RACE_ID') or '-'})",
        f"- **Cutoff:** `{env.get('CUTOFF') or '-'}` ({env.get('SESSION') or '-'})",
        f"- **Wrote to production Supabase:** {wrote(env, dry, log)}",
    ]
    if log.strip():
        lines += ["", "```", log.rstrip(), "```"]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    path = os.environ.get("SNAP_LOG", "snap.log")
    log = open(path, encoding="utf-8", errors="replace").read() if os.path.exists(path) else ""
    print(render(os.environ, log))
