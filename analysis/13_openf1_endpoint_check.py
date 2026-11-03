#!/usr/bin/env python3
"""What do OpenF1's endpoints actually hold for the MOST RECENT completed session, and for the
next weekend before it starts? (Part 1C live-feed verification)

Limits of this check, stated up front: it tests HISTORICAL availability and ingestion delay with
the free, unauthenticated API. It cannot test LIVE streaming, which needs a paid token (not used)
and a session in progress. Free access is documented as covering data outside the window
[30 min before a session, 30 min after it ends].

Cached and rate-limited via openf1_client. Writes analysis/out/openf1_endpoint_check.json.
Run: python analysis/13_openf1_endpoint_check.py
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import openf1_client as o  # noqa: E402

OUT = os.path.join(HERE, "out")
now = datetime.now(timezone.utc)
sessions = o.get("sessions", year=2026)
done = [s for s in sessions if datetime.fromisoformat(s["date_end"]) < now - timedelta(hours=1) and s["session_name"] == "Race"]
last = max(done, key=lambda s: s["date_end"])
start = datetime.fromisoformat(last["date_start"])
end = datetime.fromisoformat(last["date_end"])
k = last["session_key"]
res = {"checked_at_utc": now.isoformat(), "session": {"name": last["session_name"], "location": last["location"], "key": k,
                                                       "date_start": last["date_start"], "date_end": last["date_end"],
                                                       "hours_since_end": round((now - end).total_seconds() / 3600, 1)}}
drv = o.get("drivers", session_key=k)
dn = drv[0]["driver_number"] if drv else 1
w0 = (start + timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
w1 = (start + timedelta(minutes=40, seconds=30)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
checks = {
    "position": ("position", f"session_key={k}&driver_number={dn}"),
    "intervals": ("intervals", f"session_key={k}&driver_number={dn}"),
    "location (30 s slice)": ("location", f"session_key={k}&driver_number={dn}&date>={w0}&date<{w1}"),
    "car_data (30 s slice)": ("car_data", f"session_key={k}&driver_number={dn}&date>={w0}&date<{w1}"),
    "race_control": ("race_control", f"session_key={k}"),
    "weather": ("weather", f"session_key={k}"),
    "laps": ("laps", f"session_key={k}&driver_number={dn}"),
    "pit": ("pit", f"session_key={k}"),
    "stints": ("stints", f"session_key={k}"),
    "session_result": ("session_result", f"session_key={k}"),
    "starting_grid": ("starting_grid", f"session_key={k}"),
}
res["historical_rows_for_last_completed_race"] = {}
for name, (ep, qs) in checks.items():
    data = o.get_qs(ep, qs)
    first = data[0].get("date") or data[0].get("date_start") if data else None
    last_ = data[-1].get("date") or data[-1].get("date_start") if data else None
    res["historical_rows_for_last_completed_race"][name] = {"rows": len(data), "first_ts": first, "last_ts": last_}
    print(f"{name:<24} rows={len(data):>6}  first={first}  last={last_}")

# next weekend: do session + driver list exist before the weekend starts?
nxt = sorted([s for s in sessions if datetime.fromisoformat(s["date_start"]) > now and s["session_name"] == "Practice 1"], key=lambda s: s["date_start"])
if nxt:
    n = nxt[0]
    d = o.get("drivers", session_key=n["session_key"])
    res["next_weekend"] = {"location": n["location"], "practice1_start": n["date_start"], "session_key": n["session_key"],
                           "drivers_listed_before_start": len(d),
                           "hours_until_start": round((datetime.fromisoformat(n["date_start"]) - now).total_seconds() / 3600, 1)}
    print("next weekend:", res["next_weekend"])
json.dump(res, open(os.path.join(OUT, "openf1_endpoint_check.json"), "w"), indent=1)
print("network calls", o.STATS["network"], "cached", o.STATS["cached"])
