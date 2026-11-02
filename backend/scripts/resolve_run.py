#!/usr/bin/env python3
"""Decide, in ONE place, whether a workflow run is a dry run.

The rule is deliberately narrow and explicit:

    dry run  <=>  event is workflow_dispatch  AND  the dry_run input is "true"

A scheduled run is therefore NEVER a dry run, whatever the inputs hold (GitHub
supplies none for schedule events, but the rule does not depend on that). Every
step in snapshot-model-pick.yml reads this script's output instead of testing the
raw input itself, so there is exactly one definition to get wrong.

Environment in:  EVENT (github.event_name), INPUT_DRY_RUN, INPUT_RACE_ID
Output (GITHUB_OUTPUT style, stdout):  dry=true|false  forced=true|false
"""
import os


def resolve(event, input_dry_run, input_race_id):
    dry = event == "workflow_dispatch" and str(input_dry_run).strip().lower() == "true"
    forced = event == "workflow_dispatch" and bool(str(input_race_id).strip())
    return {"dry": "true" if dry else "false", "forced": "true" if forced else "false"}


if __name__ == "__main__":
    out = resolve(os.environ.get("EVENT", ""), os.environ.get("INPUT_DRY_RUN", ""),
                  os.environ.get("INPUT_RACE_ID", ""))
    for k, v in out.items():
        print(f"{k}={v}")
