#!/usr/bin/env python3
"""Build the compact race-replay files from OpenF1 historical data (free, no credentials).

For each completed 2025-2026 race this writes <raceId>.json.gz (1 Hz positions per driver, delta-encoded) plus an entry in
manifest.json. Everything the player needs is in that one file: track outline, start/finish, pit lane path, per-lap order and
gaps, the official /position order feed, pit stops, retirements and race-control flags.

    python backend/scripts/build_replay.py --race-id 1147          # one race
    python backend/scripts/build_replay.py --all                    # every completed 2025-2026 race (skips finished ones)
    python backend/scripts/build_replay.py --all --force            # rebuild

Position data: OpenF1 (CC BY-NC-SA 4.0). The replay is interpolated from ~3.8 Hz samples and is not official timing.

Rules this script follows
  * at most 25 API calls a minute (OpenF1's free tier states 30/min); responses are cached on disk per call, so an interrupted
    run resumes; with --keep-raw off (the default) a race's raw files are DELETED once its compact file is written. A race's raw
    download is 90-140 MB, so the cache never holds more than one race.
  * the official /position feed is the source of truth for the order board. Positions recomputed from the x/y data are used only
    to measure agreement with it (the quality report).
  * standalone: it only needs numpy and requests, reads data/*.csv for the race list, and never touches the model or Supabase.
"""
import argparse
import bisect
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(REPO, "data")
BASE = "https://api.openf1.org/v1"
MIN_INTERVAL = 2.4            # seconds between network calls => at most 25 a minute
FORMAT_VERSION = 1
LICENSE = "Position data: OpenF1 (CC BY-NC-SA 4.0). Replay is interpolated from ~3.8 Hz samples and is not official timing."


# ───────────────────────────── OpenF1 access (polite, cached per call, deletable) ─────────────────────────────
class Raw:
    def __init__(self, directory):
        self.dir = directory
        os.makedirs(directory, exist_ok=True)
        self.last = 0.0
        self.network = 0
        self.used = []                 # race-specific cache files, deleted after the compact file is written

    def get(self, endpoint, race_specific=True, **params):
        key = hashlib.sha1((f"{BASE}/{endpoint}?" + "&".join(f"{k}={params[k]}" for k in sorted(params))).encode()).hexdigest()
        path = os.path.join(self.dir, f"{endpoint}_{key[:16]}.json")
        if race_specific:
            self.used.append(path)
        if os.path.exists(path):
            with open(path, encoding="utf8") as fh:
                return json.load(fh)
        for attempt in range(6):
            wait = MIN_INTERVAL - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.network += 1
            try:
                r = requests.get(f"{BASE}/{endpoint}", params=params, timeout=90)
            except requests.RequestException:
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code == 200:
                data = r.json()
            elif r.status_code == 404:
                data = []                      # OpenF1 answers 404 {"detail": "No results found."}
            elif r.status_code in (429, 500, 502, 503, 504):
                time.sleep(10 * (attempt + 1))
                continue
            else:
                raise RuntimeError(f"OpenF1 {endpoint} {params}: HTTP {r.status_code}: {r.text[:120]}")
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf8") as fh:
                json.dump(data, fh)
            os.replace(tmp, path)
            return data
        raise RuntimeError(f"OpenF1 {endpoint} {params}: gave up after retries")

    def drop(self):
        n = 0
        for p in set(self.used):
            try:
                os.remove(p)
                n += 1
            except OSError:
                pass
        self.used = []
        return n


def ep(s):
    """ISO-8601 string (with or without fractional seconds) -> epoch seconds."""
    return datetime.fromisoformat(s).astimezone(timezone.utc).timestamp()


# ───────────────────────────── the race list ─────────────────────────────
def completed_races():
    rows = lambda n: list(csv.DictReader(open(os.path.join(DATA, n), encoding="utf8")))
    done = {int(r["raceId"]) for r in rows("results.csv")}
    out = []
    for r in rows("races.csv"):
        if int(r["year"]) >= 2025 and int(r["raceId"]) in done:
            out.append(dict(raceId=int(r["raceId"]), year=int(r["year"]), round=int(r["round"]), name=r["name"], date=r["date"]))
    return sorted(out, key=lambda r: r["raceId"])


def race_session(raw, race):
    for s in raw.get("sessions", race_specific=False, year=race["year"], session_name="Race"):
        if s["date_start"][:10] == race["date"]:
            return s
    return None


# ───────────────────────────── helpers ─────────────────────────────
def delta_encode(a):
    return np.diff(np.round(a).astype(np.int64), prepend=0).tolist()


def unwrap_progress(seq, length):
    """Turn a path-position series along a closed loop (0..length) into a monotone distance: a jump of more than half a lap is a line crossing."""
    seq = seq.copy()
    for i in range(1, len(seq)):
        d = seq[i] - seq[i - 1]
        if d < -length / 2:
            seq[i:] += length
        elif d > length / 2:
            seq[i:] -= length
    return seq


def nearest_vertex(points, vertices, chunk=4000):
    """Index of the nearest vertex and the distance, for each point (brute force; the outline has only a few hundred vertices)."""
    idx = np.empty(len(points), int)
    dist = np.empty(len(points))
    for i in range(0, len(points), chunk):
        d = np.hypot(points[i:i + chunk, None, 0] - vertices[None, :, 0], points[i:i + chunk, None, 1] - vertices[None, :, 1])
        idx[i:i + chunk] = d.argmin(1)
        dist[i:i + chunk] = d.min(1)
    return idx, dist


def runs(mask):
    """[(start, end_inclusive)] of True runs."""
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1)); start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


# ───────────────────────────── one race ─────────────────────────────
def build_race(raw, race, n_results=None, log=print, dbg=None):
    sess = race_session(raw, race)
    if not sess:
        raise RuntimeError("no OpenF1 race session matches this date")
    sk = sess["session_key"]
    drivers = {d["driver_number"]: d for d in raw.get("drivers", session_key=sk)}
    laps = raw.get("laps", session_key=sk)
    pit = raw.get("pit", session_key=sk)
    rcm = raw.get("race_control", session_key=sk)
    posfeed = raw.get("position", session_key=sk)
    intervals = raw.get("intervals", session_key=sk)
    result = {r["driver_number"]: r for r in raw.get("session_result", session_key=sk)}
    nums = sorted(drivers)
    code = {n: drivers[n]["name_acronym"] for n in nums}

    # timeline: lights-out ~ lap 1 start; chequered flag ends the race
    q = dict(longest_gap_s=0.0, zero_filled_cars=[], dropped_drivers=[], approximated=[])
    lap1 = [ep(l["date_start"]) for l in laps if l["lap_number"] == 1 and l.get("date_start")]
    if lap1:
        lights_out = min(lap1)
    else:
        # some races have no lap-1 timing: fall back to race control's SESSION STARTED, else to lap 2 minus a typical lap
        started = [ep(m["date"]) for m in rcm if "SESSION STARTED" in (m.get("message") or "").upper()]
        lap2 = [(ep(l["date_start"]), l.get("lap_duration")) for l in laps if l["lap_number"] == 2 and l.get("date_start")]
        if started:
            lights_out = min(started)
            q["approximated"].append("lights-out taken from race control (SESSION STARTED): no lap-1 timing in the data")
        elif lap2:
            durs = [d for _, d in lap2 if d]
            lights_out = min(t for t, _ in lap2) - (float(np.median(durs)) if durs else 100.0)
            q["approximated"].append("lights-out estimated as lap 2 minus a typical lap: no lap-1 timing in the data")
        else:
            raise RuntimeError("no lap-1 start times and no fallback")
    cheq = [ep(m["date"]) for m in rcm if m.get("flag") == "CHEQUERED"]
    ends = [ep(l["date_start"]) + (l.get("lap_duration") or 0) for l in laps if l.get("date_start")]
    race_end = max(cheq) if cheq else max(ends)
    W0, W1 = lights_out - 90, race_end + 45
    T = np.arange(math.ceil(W0), math.floor(W1) + 1, 1.0)
    T0 = float(T[0])
    N = len(T)

    # location -> 1 Hz series per car (invalid = the all-zero samples OpenF1 emits when a car is not transmitting)
    series = {}
    for n in nums:
        L = raw.get("location", session_key=sk, driver_number=n)
        if not L:
            q["dropped_drivers"].append(code[n]); continue
        t = np.array([ep(r["date"]) for r in L]); x = np.array([r["x"] for r in L], float); y = np.array([r["y"] for r in L], float); z = np.array([r["z"] for r in L], float)
        inwin = (t >= W0 - 5) & (t <= W1 + 5)
        valid = inwin & ~((x == 0) & (y == 0) & (z == 0))
        zeros = int((inwin & ~valid).sum())
        tv, xv, yv = t[valid], x[valid], y[valid]
        if len(tv) < 100:
            q["dropped_drivers"].append(code[n]); continue
        xi, yi = np.interp(T, tv, xv), np.interp(T, tv, yv)
        # a second is trustworthy only if real samples sit within 3 s on both sides
        j = np.clip(np.searchsorted(tv, T), 1, len(tv) - 1)
        ok = (np.maximum(T - tv[j - 1], tv[j] - T) <= 3.0) & (T >= tv[0]) & (T <= tv[-1])
        gaps = [[int(a), int(b)] for a, b in runs(~ok) if b - a >= 3]
        if zeros > 50:
            q["zero_filled_cars"].append(code[n])
        q["longest_gap_s"] = max(q["longest_gap_s"], max([b - a + 1 for a, b in gaps], default=0))
        series[n] = dict(x=xi, y=yi, ok=ok, gaps=gaps, tv=tv, xv=xv, yv=yv)
    nums = [n for n in nums if n in series]
    if len(nums) < 10:
        raise RuntimeError(f"only {len(nums)} cars have usable location data")
    i0, i1 = int(lights_out - T0), int(race_end - T0)
    coverage = float(np.median([series[n]["ok"][i0:i1].mean() for n in nums]))
    q["coverage"] = round(coverage, 3)
    if coverage < 0.6:                       # OpenF1 itself has no usable positions for most of this race: do not publish a misleading replay
        raise RuntimeError(f"OpenF1 location data covers only {coverage:.0%} of the race (median car); no replay published")

    # classification flags
    status = {}
    for n in nums:
        rr = result.get(n, {})
        status[n] = "dsq" if rr.get("dsq") else "dns" if rr.get("dns") else "dnf" if rr.get("dnf") else None

    # when a retiree stopped moving (data-driven): last second with speed > 3 m/s (30 dm/s); frozen there afterwards
    out_t = {}
    for n in nums:
        if status[n] in ("dnf", "dns"):
            s = series[n]
            sp = np.hypot(np.diff(s["x"]), np.diff(s["y"]))
            moving = np.where((sp > 30) & s["ok"][1:] & s["ok"][:-1])[0]
            out_t[n] = 0 if status[n] == "dns" or not len(moving) else int(moving[-1]) + 1
            for k in ("x", "y"):
                s[k] = s[k].copy(); s[k][out_t[n]:] = s[k][min(out_t[n], N - 1)]
            s["ok"] = s["ok"].copy(); s["ok"][out_t[n]:] = True        # frozen, so not a data hole

    # ── track outline from one clean lap of the winner (or the car with most laps)
    win = next((n for n, r in result.items() if r.get("position") == 1 and n in series), None)
    lapcount = {}
    for l in laps:
        lapcount[l["driver_number"]] = max(lapcount.get(l["driver_number"], 0), l["lap_number"])
    ref = win or max(series, key=lambda n: lapcount.get(n, 0))
    pit_laps = {n: {p["lap_number"] for p in pit if p["driver_number"] == n} for n in nums}
    cand = [l for l in laps if l["driver_number"] == ref and l.get("lap_duration") and l.get("date_start") and not l.get("is_pit_out_lap")
            and l["lap_number"] >= 3 and l["lap_number"] not in pit_laps[ref] and l["lap_number"] - 1 not in pit_laps[ref]]
    if not cand:
        raise RuntimeError("no clean reference lap")
    best = min(l["lap_duration"] for l in cand)
    outline = None
    for l in sorted([l for l in cand if l["lap_duration"] <= best * 1.15], key=lambda l: l["lap_duration"]):      # fastest clean lap with full coverage
        s = series[ref]; a = ep(l["date_start"]); m = (s["tv"] >= a) & (s["tv"] <= a + l["lap_duration"])
        if m.sum() < max(150, 0.85 * 3.0 * l["lap_duration"]):
            continue
        rx, ry = s["xv"][m], s["yv"][m]
        seg = np.hypot(np.diff(rx), np.diff(ry)); S = np.concatenate([[0], np.cumsum(seg)]); Lp = S[-1]
        g = np.linspace(0, Lp, 420)
        px, py = np.interp(g, S, rx), np.interp(g, S, ry)
        gap = np.array([px[-1] - px[0], py[-1] - py[0]])          # the lap does not quite close: spread the gap along the lap
        closure_m = float(np.hypot(*gap) / 10)
        px = px - gap[0] * (g / Lp); py = py - gap[1] * (g / Lp)
        outline = dict(x=px, y=py, lap=int(l["lap_number"]), lap_time=float(l["lap_duration"]), closure_m=closure_m, length_dm=float(Lp))
        break
    if outline is None:
        raise RuntimeError(f"could not build an outline (reference {code[ref]}: {len(cand)} clean laps, longest sample count {max([int(((series[ref]['tv'] >= ep(l['date_start'])) & (series[ref]['tv'] <= ep(l['date_start']) + l['lap_duration'])).sum()) for l in cand] or [0])})")
    OP = np.c_[outline["x"], outline["y"]]
    arc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(np.vstack([OP, OP[:1]]), axis=0).T))])      # arc length at each vertex (closed loop)
    Ltot = float(arc[-1])
    sf = dict(x=int(round(OP[0, 0])), y=int(round(OP[0, 1])), dx=int(round(OP[4, 0] - OP[0, 0])), dy=int(round(OP[4, 1] - OP[0, 1])))

    # ── progress along the outline (quality check only). The nearest outline vertex alone can jump to another part of the lap where
    # the track passes close to itself, so each car is TRACKED: its next vertex is searched only just behind / ahead of the previous
    # one (further ahead after a data hole), which cannot teleport. The path distance is then unwrapped at line crossings.
    V = len(OP)
    prog = {}
    for n in nums:
        s = series[n]; okk = s["ok"]
        idx_seq = np.full(N, -1, int)
        prev, prev_i = None, -10**9
        for i in range(N):
            if not okk[i]:
                continue
            px_, py_ = s["x"][i], s["y"][i]
            if prev is None:
                prev = int(np.argmin(np.hypot(OP[:, 0] - px_, OP[:, 1] - py_)))
            else:
                ahead = int(14 * (i - prev_i)) + 12            # at most ~14 vertices (~1 km/s...) per second, more after a hole
                cand = (prev + np.arange(-6, min(ahead, V // 2))) % V
                prev = int(cand[np.argmin(np.hypot(OP[cand, 0] - px_, OP[cand, 1] - py_))])
            prev_i = i; idx_seq[i] = prev
        frac = np.full(N, np.nan)
        good = idx_seq >= 0
        frac[good] = arc[idx_seq[good]] / Ltot
        # whole laps come from the official lap start times; the fraction of the lap from the tracked position. Within 8 s of a line
        # crossing the two can disagree by one lap, so the fraction is shifted to match the side of the line the lap counter says.
        ls = sorted((ep(l["date_start"]) - T0, l["lap_number"]) for l in laps if l["driver_number"] == n and l.get("date_start"))
        starts = np.array([a_ for a_, _ in ls]); lapnum = np.array([b_ for _, b_ in ls])
        tot = np.full(N, np.nan)
        for i in np.where(good)[0]:
            t_ = float(i)
            j = int(np.searchsorted(starts, t_, side="right"))
            k = int(lapnum[j - 1]) if j > 0 else 0
            f = frac[i]
            if j > 0 and t_ - starts[j - 1] < 8 and f > 0.5:
                f -= 1.0
            elif j < len(starts) and starts[j] - t_ < 8 and f < 0.5:
                f += 1.0
            tot[i] = (k - 1) + f
        prog[n] = tot
    anchored = []

    # ── pit lane. OpenF1's /pit `date` is the moment the car LEAVES the lane (checked against the speed trace: the stop happens
    # about lane_duration/2 earlier), so a stop occupies [date - lane_duration, date]. The lane path is the per-point median of
    # every stop's trajectory resampled by arc length; it is accepted only if the stops agree with each other.
    stops = [p for p in pit if p["driver_number"] in series and p.get("date") and p.get("lane_duration")]
    def stop_window(p):
        d = ep(p["date"]) - T0
        return int(math.floor(d - p["lane_duration"] - 1)), int(math.ceil(d + 1))
    pit_path = None
    trajs = []
    for p in stops:
        a_, b_ = stop_window(p)
        if a_ < 0 or b_ >= N or b_ - a_ < 8:
            continue
        pp = np.c_[series[p["driver_number"]]["x"][a_:b_ + 1], series[p["driver_number"]]["y"][a_:b_ + 1]]
        seg = np.hypot(*np.diff(pp, axis=0).T)
        if seg.sum() < 1500:                      # under 150 m of travel: not a real lane pass
            continue
        S = np.concatenate([[0], np.cumsum(seg)]); g = np.linspace(0, S[-1], 60)
        trajs.append(np.c_[np.interp(g, S, pp[:, 0]), np.interp(g, S, pp[:, 1])])
    if len(trajs) >= 4:
        A = np.array(trajs)                        # stops x 60 points x 2
        med = np.median(A, axis=0)
        spread = float(np.median(np.hypot(*(A - med).transpose(2, 0, 1)).flatten()))      # typical distance of a stop's point from the median path, dm
        length = float(np.hypot(*np.diff(med, axis=0).T).sum())
        _, d_ends = nearest_vertex(med[[0, -1]], OP)
        if spread < 200 and 3000 < length < 20000 and d_ends.max() < 400:
            sm = med.copy(); sm[1:-1] = (med[:-2] + med[1:-1] + med[2:]) / 3
            pit_path = sm
        else:
            q["approximated"].append(f"pit-lane path rejected (stops disagree: spread {spread / 10:.0f} m, length {length / 10:.0f} m)")
    if pit_path is None and not any("rejected" in a for a in q["approximated"]):
        q["approximated"].append("too few usable pit stops to derive a lane path")
    if pit_path is None:
        q["approximated"].append("no clean pit-lane path: pit stops are shown as a PIT tag only")

    # in-pit runs per car are simply the stop windows
    in_pit = {}
    for n in nums:
        r_ = []
        for p in stops:
            if p["driver_number"] == n:
                a_, b_ = stop_window(p)
                r_.append([max(a_, 0), min(b_, N - 1)])
        if r_:
            in_pit[code[n]] = sorted(r_)

    # ── official order (the source of truth): /position as per-driver change lists, clipped to the window
    board = {}
    byd = {}
    for r in posfeed:
        byd.setdefault(r["driver_number"], []).append((ep(r["date"]), r["position"]))
    for n in nums:
        ev = sorted(byd.get(n, []))
        before = [e for e in ev if e[0] <= T0]
        rows = ([[0.0, before[-1][1]]] if before else []) + [[round(e[0] - T0, 1), e[1]] for e in ev if T0 < e[0] <= W1 + 5]
        board[code[n]] = rows

    sorted_ev = {n: sorted(v) for n, v in byd.items()}
    ev_times = {n: [e[0] for e in v] for n, v in sorted_ev.items()}

    def official_order(t_abs):
        o = {}
        for n in nums:
            if n in ev_times:
                i = bisect.bisect_right(ev_times[n], t_abs) - 1
                if i >= 0:
                    o[n] = sorted_ev[n][i][1]
        return o

    # ── quality: computed order vs the official feed, every 15 s of racing
    # a red flag parks the field in the pit lane, where "who is ahead" is meaningless: skip the suspension and 3 minutes of restart
    red_spans, _open = [], None
    for m in sorted(rcm, key=lambda m: m["date"]):
        msg = (m.get("message") or "").upper(); t_abs = ep(m["date"])
        if m.get("flag") == "RED" or re.search(r"\bRED FLAG\b", msg):
            if _open is None:
                _open = t_abs
        elif _open is not None and ("SESSION STARTED" in msg or "GREEN LIGHT" in msg) and t_abs > _open + 60:
            red_spans.append((_open, t_abs + 180)); _open = None
    if _open is not None:
        red_spans.append((_open, race_end))
    if any(b_ > lights_out for _, b_ in red_spans):
        q["approximated"].append("order check skips the red-flag suspension and 3 minutes after the restart")
    checks = []
    P = np.vstack([prog[n] for n in nums])
    pos_of = {n: k for k, n in enumerate(nums)}
    for t_abs in np.arange(lights_out + 120, race_end - 60, 15.0):
        if any(a_ <= t_abs <= b_ for a_, b_ in red_spans):
            continue
        i = int(t_abs - T0)
        col = P[:, i]; live = ~np.isnan(col)
        off = official_order(t_abs)
        racing = [k for k, n in enumerate(nums) if live[k] and not (n in out_t and i >= out_t[n]) and n in off]
        if len(racing) < 8:
            continue
        mine = [nums[k] for k in sorted(racing, key=lambda k: -col[k])]
        theirs = sorted([nums[k] for k in racing], key=lambda n: off[n])
        ra = {n: k for k, n in enumerate(mine)}; rb = {n: k for k, n in enumerate(theirs)}
        # side by side (within ~0.05 lap, about 200 m) the two orders cannot be told apart from 1 Hz positions: count that as a match
        lead_ok = mine[0] == theirs[0] or col[pos_of[theirs[0]]] >= col[pos_of[mine[0]]] - 0.05
        checks.append((lead_ok, set(mine[:3]) == set(theirs[:3]), float(np.mean([ra[n] == rb[n] for n in mine])), float(np.mean([abs(ra[n] - rb[n]) <= 1 for n in mine]))))
    ck = np.array(checks, float) if checks else np.zeros((0, 4))
    order_q = dict(samples=len(ck), leader=round(float(ck[:, 0].mean()), 3) if len(ck) else None, top3=round(float(ck[:, 1].mean()), 3) if len(ck) else None,
                   exact=round(float(ck[:, 2].mean()), 3) if len(ck) else None, within1=round(float(ck[:, 3].mean()), 3) if len(ck) else None)

    # ── laps: leader crossing times, official order and gap to leader at each
    total_laps = max(lapcount.values())
    lap_t = {}
    for l in laps:
        if l.get("date_start"):
            lap_t.setdefault(l["lap_number"], []).append(ep(l["date_start"]))
    iv = {}
    for r in intervals:
        iv.setdefault(r["driver_number"], []).append((ep(r["date"]), r.get("gap_to_leader")))
    for n in iv:
        iv[n].sort(key=lambda e: e[0])
    iv_t = {n: [e[0] for e in v] for n, v in iv.items()}
    lap_rows = []
    for k in range(1, total_laps + 1):
        if k in lap_t:
            t_k = min(lap_t[k])
        elif k == 1:
            t_k = lights_out                     # no lap-1 timing in some races: lap 1 starts at the estimated lights-out
        else:
            continue
        off = official_order(t_k + 1)
        order = [code[n] for n in sorted(off, key=lambda n: off[n]) if n in code]
        gaps = {}
        for n in nums:
            if n in iv_t:
                i = bisect.bisect_right(iv_t[n], t_k + 1) - 1
                if i >= 0 and iv[n][i][1] is not None:
                    g = iv[n][i][1]
                    gaps[code[n]] = round(g, 1) if isinstance(g, (int, float)) else str(g)
        lap_rows.append(dict(lap=k, t=round(t_k - T0, 1), order=order, gap=gaps))
    lap_starts = {code[n]: [round(ep(l["date_start"]) - T0, 1) for l in sorted([l for l in laps if l["driver_number"] == n and l.get("date_start")], key=lambda l: l["lap_number"])] for n in nums}

    # ── events
    flags, bands = [], []
    sc_open = vsc_open = red_open = None
    for m in sorted(rcm, key=lambda m: m["date"]):
        t = round(ep(m["date"]) - T0, 1); msg = (m.get("message") or "").upper(); lap = m.get("lap_number")
        if m.get("category") == "SafetyCar":
            if "VIRTUAL" in msg and "DEPLOYED" in msg:
                flags.append(dict(t=t, lap=lap, kind="VSC", msg="VIRTUAL SAFETY CAR")); vsc_open = t
            elif "VIRTUAL" in msg and "ENDING" in msg:
                flags.append(dict(t=t, lap=lap, kind="VSC_END", msg="VSC ENDING"))
                if vsc_open is not None: bands.append(dict(kind="VSC", a=vsc_open, b=t)); vsc_open = None
            elif "DEPLOYED" in msg:
                flags.append(dict(t=t, lap=lap, kind="SC", msg="SAFETY CAR")); sc_open = t
            elif "IN THIS LAP" in msg:
                flags.append(dict(t=t, lap=lap, kind="SC_END", msg="SAFETY CAR IN THIS LAP"))
                if sc_open is not None: bands.append(dict(kind="SC", a=sc_open, b=t)); sc_open = None
        elif m.get("flag") == "RED" or re.search(r"\bRED FLAG\b", msg):        # word boundary: "CHEQUERED FLAG" must not match
            if red_open is None:
                flags.append(dict(t=t, lap=lap, kind="RED", msg="RED FLAG", before_start=t < (lights_out - T0)))
                red_open = t
        elif red_open is not None and ("SESSION STARTED" in msg or "GREEN LIGHT" in msg) and t > red_open + 60:
            if t > 0 and red_open >= 0:
                bands.append(dict(kind="RED", a=red_open, b=t))
            red_open = None
        elif m.get("flag") == "CHEQUERED":
            flags.append(dict(t=t, lap=lap, kind="CHEQUERED", msg="CHEQUERED FLAG"))
    if red_open is not None and red_open >= 0:
        bands.append(dict(kind="RED", a=red_open, b=round(race_end - T0, 1)))
    for kind, o_ in (("SC", sc_open), ("VSC", vsc_open)):
        if o_ is not None:
            bands.append(dict(kind=kind, a=o_, b=round(race_end - T0, 1)))
    pits = [dict(d=code[p["driver_number"]], lap=p["lap_number"], t=round(ep(p["date"]) - T0, 1), lane_s=p.get("lane_duration"), stop_s=p.get("stop_duration"))
            for p in pit if p["driver_number"] in code and p.get("date")]

    # ── assemble
    dlist = []
    for n in nums:
        d = drivers[n]
        dlist.append(dict(n=n, code=code[n], name=d.get("full_name"), team=d.get("team_name"), colour=d.get("team_colour"), status=status[n],
                          out_t=out_t.get(n), laps=lapcount.get(n, 0)))
    pos = {}
    for n in nums:
        s = series[n]
        # holes (cars not transmitting) hold the last good position and are listed in `gaps` so the player can hide the dot
        x = s["x"].copy(); y = s["y"].copy(); ok = s["ok"]
        last = None
        for i in range(N):
            if ok[i]:
                last = (x[i], y[i])
            elif last is not None:
                x[i], y[i] = last
        first = next((i for i in range(N) if ok[i]), None)
        if first:
            x[:first], y[:first] = x[first], y[first]
        pos[code[n]] = dict(x=delta_encode(x), y=delta_encode(y))
    compact = dict(
        v=FORMAT_VERSION, license=LICENSE,
        race=dict(raceId=race["raceId"], year=race["year"], round=race["round"], name=race["name"], session_key=sk, t0=int(T0), n=N, lights_out=round(lights_out - T0, 1),
                  chequered=round(race_end - T0, 1), laps=total_laps, unit="decimetre, delta-encoded"),
        drivers=dlist,
        track=dict(outline=dict(x=delta_encode(OP[:, 0]), y=delta_encode(OP[:, 1])), sf=sf,
                   pit=None if pit_path is None else dict(x=delta_encode(pit_path[:, 0]), y=delta_encode(pit_path[:, 1])),
                   length_m=round(Ltot / 10), closure_m=round(outline["closure_m"], 1), reference=dict(driver=code[ref], lap=outline["lap"])),
        pos=pos, gaps={code[n]: series[n]["gaps"] for n in nums if series[n]["gaps"]}, in_pit=in_pit,
        lap_starts=lap_starts, laps=lap_rows, board=board, pits=pits, flags=flags, bands=bands)
    quality = dict(order=order_q, longest_gap_s=q["longest_gap_s"], zero_filled_cars=q["zero_filled_cars"], dropped_drivers=q["dropped_drivers"],
                   approximated=q["approximated"], coverage=q.get("coverage"), cars=len(nums), pit_lane=pit_path is not None, retired=[code[n] for n in nums if status[n] == "dnf"],
                   dsq=[code[n] for n in nums if status[n] == "dsq"], dns=[code[n] for n in nums if status[n] == "dns"],
                   outline_closure_m=round(outline["closure_m"], 1), track_length_m=round(Ltot / 10), results_cars=n_results)
    if dbg is not None:                                         # internals for debugging a flagged race
        dbg.update(nums=nums, code=code, T=T, prog=prog, series=series, status=status, out_t=out_t, lights_out=lights_out, race_end=race_end,
                   official_order=official_order, laps=laps, result=result, OP=OP, arc=arc, anchored=anchored, lapcount=lapcount)
    return compact, quality, sess


def quality_flags(quality):
    f = []
    o = quality["order"]
    if o["leader"] is None or o["leader"] < 0.95:
        f.append("leader_match_below_95")
    if o["within1"] is not None and o["within1"] < 0.93:
        f.append("order_within_one_below_93")
    if quality["dropped_drivers"]:
        f.append("dropped_drivers")
    if quality["longest_gap_s"] > 60:
        f.append("location_gap_over_60s")
    if not quality["pit_lane"]:
        f.append("pit_lane_not_drawn")
    if quality.get("results_cars") and quality["cars"] < quality["results_cars"]:
        f.append("cars_fewer_than_classified")
    return f


def write_quality_md(path, race, quality, flags, size_kb):
    o = quality["order"]
    lines = [f"# Replay quality: {race['name']} {race['year']} (raceId {race['raceId']})", "",
             f"- file: {size_kb} KB gzipped; {quality['cars']} cars; track {quality['track_length_m']} m (outline closed from a {quality['outline_closure_m']} m gap)",
             f"- order vs OpenF1 /position ({o['samples']} checks, every 15 s): leader {o['leader']}, top 3 {o['top3']}, exact positions {o['exact']}, within one place {o['within1']}",
             f"- share of the race with usable positions (median car): {quality.get('coverage')}",
             f"- longest location gap: {quality['longest_gap_s']:.0f} s; zero-filled cars: {', '.join(quality['zero_filled_cars']) or 'none'}; dropped drivers: {', '.join(quality['dropped_drivers']) or 'none'}",
             f"- retired: {', '.join(quality['retired']) or 'none'}; disqualified after the race: {', '.join(quality['dsq']) or 'none'}; did not start: {', '.join(quality['dns']) or 'none'}",
             f"- pit lane drawn: {'yes' if quality['pit_lane'] else 'no (PIT tag only)'}",
             f"- approximated: {'; '.join(quality['approximated']) or 'nothing beyond interpolation to 1 Hz and cubic playback'}",
             f"- flags: {', '.join(flags) or 'none'}", "",
             "Position data: OpenF1 (CC BY-NC-SA 4.0). Interpolated from ~3.8 Hz samples; not official timing.", ""]
    with open(path, "w", encoding="utf8") as fh:
        fh.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--race-id", type=int, nargs="*", help="one or more raceIds")
    ap.add_argument("--all", action="store_true", help="every completed 2025-2026 race")
    ap.add_argument("--force", action="store_true", help="rebuild races that already have an output file")
    ap.add_argument("--out", default=os.path.join(REPO, "frontend", "public", "replay-dev"), help="output directory (default: the untracked dev folder)")
    ap.add_argument("--docs", default=os.path.join(REPO, "docs", "replay"), help="where the small quality reports go")
    ap.add_argument("--raw-dir", default=os.path.join(tempfile.gettempdir(), "f1-replay-raw"), help="cache for raw OpenF1 responses")
    ap.add_argument("--keep-raw", action="store_true", help="do not delete a race's raw responses after it is built")
    args = ap.parse_args()
    if not args.all and not args.race_id:
        ap.error("give --race-id or --all")
    os.makedirs(args.out, exist_ok=True); os.makedirs(args.docs, exist_ok=True)
    raw = Raw(args.raw_dir)
    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf8")) if os.path.exists(manifest_path) else dict(v=FORMAT_VERSION, source="OpenF1", license=LICENSE, races=[])
    have = {r["raceId"]: r for r in manifest["races"]}
    races = completed_races()
    results_count = {}
    for r_ in csv.DictReader(open(os.path.join(DATA, "results.csv"), encoding="utf8")):
        results_count[int(r_["raceId"])] = results_count.get(int(r_["raceId"]), 0) + 1
    if args.race_id:
        races = [r for r in races if r["raceId"] in set(args.race_id)]
    for race in races:
        rid = race["raceId"]
        outfile = os.path.join(args.out, f"{rid}.json.gz")
        if rid in have and os.path.exists(outfile) and not args.force:
            print(f"{rid} {race['name']} {race['year']}: already built, skipping"); continue
        t = time.time(); n0 = raw.network
        try:
            compact, quality, sess = build_race(raw, race, n_results=results_count.get(rid))
        except Exception as e:                                   # keep going; record the failure instead of hiding it
            print(f"{rid} {race['name']} {race['year']}: FAILED: {e}")
            if os.path.exists(outfile):
                os.remove(outfile)                               # never leave a stale file from an earlier build
            with open(os.path.join(args.docs, f"quality-{rid}.md"), "w", encoding="utf8") as fh:
                fh.write(f"# Replay quality: {race['name']} {race['year']} (raceId {rid})\n\n**No replay published.** {e}\n\nPosition data: OpenF1 (CC BY-NC-SA 4.0).\n")
            have[rid] = dict(raceId=rid, year=race["year"], round=race["round"], name=race["name"], file=None, error=str(e)[:200], flags=["build_failed"])
            manifest["races"] = sorted(have.values(), key=lambda r: r["raceId"])
            json.dump(manifest, open(manifest_path, "w", encoding="utf8"), indent=1)
            raw.drop()
            continue
        blob = gzip.compress(json.dumps(compact, separators=(",", ":")).encode(), 9)
        with open(outfile + ".tmp", "wb") as fh:
            fh.write(blob)
        os.replace(outfile + ".tmp", outfile)
        flags = quality_flags(quality)
        have[rid] = dict(raceId=rid, year=race["year"], round=race["round"], name=race["name"], date=race["date"], file=f"{rid}.json.gz", bytes=len(blob),
                         seconds=compact["race"]["n"], cars=quality["cars"], laps=compact["race"]["laps"], pit_lane=quality["pit_lane"],
                         quality=dict(leader=quality["order"]["leader"], exact=quality["order"]["exact"], within1=quality["order"]["within1"],
                                      longest_gap_s=quality["longest_gap_s"], retired=quality["retired"]),
                         flags=flags)
        manifest["races"] = sorted(have.values(), key=lambda r: r["raceId"])
        manifest["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        json.dump(manifest, open(manifest_path, "w", encoding="utf8"), indent=1)
        write_quality_md(os.path.join(args.docs, f"quality-{rid}.md"), race, quality, flags, round(len(blob) / 1024))
        dropped = 0 if args.keep_raw else raw.drop()
        print(f"{rid} {race['name']} {race['year']}: {len(blob) // 1024} KB, leader {quality['order']['leader']}, exact {quality['order']['exact']}, "
              f"pit lane {'yes' if quality['pit_lane'] else 'no'}, flags {flags or '-'} | {raw.network - n0} calls, {time.time() - t:.0f} s, {dropped} raw files deleted", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
