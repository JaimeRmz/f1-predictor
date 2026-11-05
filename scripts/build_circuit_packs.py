"""Build one small "circuit pack" per circuit from the race replay files (see docs/replay/README.md).

A pack holds what the Projected race generator needs and nothing else: the track outline (oriented along the direction of
travel, vertex 0 at the start/finish line), the pit lane path and where it joins the track, the lap count, a typical green-flag
lap time, a typical pit-stop time loss and how many stops drivers usually made. The numbers come from one real race per circuit
(the 2025 race; the latest replay if there is none). Packs are reference data for an illustration, never a forecast.

Usage (from the repo root):
    python scripts/build_circuit_packs.py                      # reads/writes frontend/public/replay-dev
    python scripts/build_circuit_packs.py --dir path/to/replay  # another folder (same one VITE_REPLAY_BASE_URL serves)

Writes <dir>/pack-<circuitRef>.json (plain JSON, each well under 60 KB) and <dir>/packs.json (the index), and prints a
validation report. Needs numpy only. Reads data/races.csv and data/circuits.csv to map a race to its circuit.
"""
import argparse
import csv
import gzip
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_BYTES = 60 * 1024


def unit(a):
    return a / (np.linalg.norm(a) or 1.0)


def decode(deltas):
    return np.cumsum(np.asarray(deltas, dtype=float))


def delta(a):
    a = np.rint(a).astype(int)
    return [int(a[0])] + [int(v) for v in np.diff(a)]


def load_circuit_map():
    circ = {r["circuitId"]: r["circuitRef"] for r in csv.DictReader(open(os.path.join(ROOT, "data", "circuits.csv"), encoding="utf8"))}
    return {r["raceId"]: circ.get(r["circuitId"]) for r in csv.DictReader(open(os.path.join(ROOT, "data", "races.csv"), encoding="utf8"))}


def arc(xy):
    """Cumulative arc length (decimetres) along a polyline, starting at 0."""
    d = np.hypot(*np.diff(xy, axis=0).T)
    return np.concatenate([[0.0], np.cumsum(d)])


def orient_outline(ox, oy, sf):
    """Roll/flip the outline so vertex 0 is the one nearest the start/finish line and travel follows the sf direction."""
    pts = np.stack([ox, oy], axis=1)
    k = int(np.argmin(np.hypot(pts[:, 0] - sf["x"], pts[:, 1] - sf["y"])))
    n = len(pts)
    tang = pts[(k + 2) % n] - pts[(k - 2) % n]
    if float(np.dot(tang, [sf["dx"], sf["dy"]])) < 0:
        pts = pts[::-1]
        k = n - 1 - k
    return np.roll(pts, -k, axis=0)


def lap_stats(j):
    """Typical green-flag lap time (s), a faster-lap reference, and the time lost per pit stop (s) from one race file.

    Pit loss = (in-lap + out-lap) - 2 x the median green lap, for stops with no SC/VSC/red flag around them. The pit `t` is the moment
    the car leaves the lane, which can fall in either lap around the line, so the two laps that bracket it are summed."""
    bands = [(b["a"], b["b"]) for b in j["bands"]]
    under_band = lambda a, b: any(a < y and b > x for x, y in bands)
    pits = j["pits"]
    green, durs = [], {}
    for code, starts in j["lap_starts"].items():
        st = [s for s in starts if s is not None]
        d = {}
        for i in range(1, len(st) - 1):          # skip lap 1 (standing start) and the last lap
            a, b = st[i], st[i + 1]
            if b > a and not under_band(a - 5, b + 5):
                d[i] = (a, b)
        durs[code] = d
        pit_t = [p["t"] for p in pits if p["d"] == code]
        for i, (a, b) in d.items():
            if not any(a - 40 <= t <= b + 40 for t in pit_t):
                green.append(b - a)
    if len(green) < 20:
        return None
    med = float(np.median(green))
    loss = []
    for p in pits:
        d = durs.get(p["d"], {})
        # local baseline (same driver, +-4 laps, no stop nearby) so a wet start or tyre wear does not inflate the loss
        pit_t = [q["t"] for q in pits if q["d"] == p["d"]]
        for i, (a, b) in d.items():
            if a <= p["t"] <= b and (i - 1) in d and not under_band(p["t"] - 60, p["t"] + 60):
                near = [d[k][1] - d[k][0] for k in range(i - 5, i + 5) if k in d and k not in (i - 1, i) and not any(d[k][0] - 40 <= t <= d[k][1] + 40 for t in pit_t)]
                base = float(np.median(near)) if len(near) >= 3 else med
                v = (b - a) + (d[i - 1][1] - d[i - 1][0]) - 2 * base
                if 5 < v < 60:
                    loss.append(v)
    return med, float(np.percentile(green, 25)), loss


def stop_summary(j, laps):
    bands = [(b["a"], b["b"]) for b in j["bands"]]
    finishers = {d["code"] for d in j["drivers"] if not d["status"]}
    per = {c: sorted(p["lap"] for p in j["pits"] if p["d"] == c) for c in finishers}
    counts = {}
    first, second = [], []
    for c, ls in per.items():
        counts[len(ls)] = counts.get(len(ls), 0) + 1
        if len(ls) >= 1:
            first.append(ls[0] / laps)
        if len(ls) >= 2:
            second.append(ls[1] / laps)
    q = lambda v: [round(float(np.percentile(v, p)), 3) for p in (10, 50, 90)] if v else None
    return {str(k): v for k, v in sorted(counts.items())}, q(first), q(second)


def build_pack(j, circuit_ref):
    race, tr = j["race"], j["track"]
    ox, oy = decode(tr["outline"]["x"]), decode(tr["outline"]["y"])
    out = orient_outline(ox, oy, tr["sf"])
    n = len(out)
    closure = float(np.hypot(*(out[0] - out[-1])))
    length = float(arc(np.vstack([out, out[:1]]))[-1]) / 10
    ls = lap_stats(j)
    pack = {
        "v": 1, "circuitRef": circuit_ref, "source": {"raceId": race["raceId"], "year": race["year"], "name": race["name"]},
        "laps": race["laps"], "length_m": round(length), "outline": {"x": delta(out[:, 0]), "y": delta(out[:, 1])},
        "sf": {k: tr["sf"][k] for k in ("x", "y", "dx", "dy")}, "pit": None,
        "license": "Position data: OpenF1 (CC BY-NC-SA 4.0). Shapes and typical times only; no race events are carried over.",
    }
    problems = []
    if closure > 0.02 * length * 10:
        problems.append(f"outline does not close ({closure / 10:.0f} m gap)")
    if not 2200 <= length <= 8000:
        problems.append(f"lap length {length:.0f} m looks odd")
    if ls is None:
        problems.append("no clean green-flag laps")
        return None, problems, pack
    lap_s, fast_s, loss = ls
    pack["lap_s"] = round(lap_s, 1)
    pack["lap_fast_s"] = round(fast_s, 1)
    if not 55 <= lap_s <= 130:
        problems.append(f"typical lap {lap_s:.1f} s looks odd")
    if tr["pit"]:
        px, py = decode(tr["pit"]["x"]), decode(tr["pit"]["y"])
        pp = np.stack([px, py], axis=1)
        ent = int(np.argmin(np.hypot(out[:, 0] - pp[0, 0], out[:, 1] - pp[0, 1])))
        ext = int(np.argmin(np.hypot(out[:, 0] - pp[-1, 0], out[:, 1] - pp[-1, 1])))
        cum = arc(np.vstack([out, out[:1]]))
        fwd = (cum[ext] - cum[ent]) % cum[-1]
        pl = float(arc(pp)[-1])
        pack["pit"] = {"x": delta(px), "y": delta(py), "enter": ent, "exit": ext, "length_m": round(pl / 10)}
        if not 0.5 * pl <= fwd <= 1.8 * pl:
            problems.append(f"pit lane ({pl / 10:.0f} m) does not match the track between its ends ({fwd / 10:.0f} m)")
        lane = [p["lane_s"] for p in j["pits"] if p.get("lane_s")]
        stop = [p["stop_s"] for p in j["pits"] if p.get("stop_s")]
        pack["pit"]["lane_s"] = round(float(np.median(lane)), 1) if lane else None
        pack["pit"]["stop_s"] = round(float(np.median(stop)), 1) if stop else 2.5
    else:
        problems.append("no pit lane path (stops would be drawn on track)")
    pack["pit_loss_s"] = round(float(np.median(loss)), 1) if len(loss) >= 3 else None
    pack["pit_loss_n"] = len(loss)
    if pack["pit_loss_s"] is None and pack["pit"] and pack["pit"]["lane_s"]:
        # too few clean stops: time in the lane + stationary time - what the same distance costs at racing speed
        est = pack["pit"]["lane_s"] + pack["pit"]["stop_s"] - (pack["pit"]["length_m"] / (length / lap_s))
        pack["pit_loss_s"], pack["pit_loss_estimated"] = round(float(est), 1), True
        problems.append(f"pit loss estimated from the lane time ({len(loss)} clean stops)")
    if pack["pit_loss_s"] is None or not 12 <= pack["pit_loss_s"] <= 35:
        problems.append(f"pit loss {pack['pit_loss_s']} s from {len(loss)} stops looks odd or thin")
    counts, first, second = stop_summary(j, race["laps"])
    pack["stops"] = {"counts": counts, "first": first, "second": second}
    return pack, problems, pack


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(ROOT, "frontend", "public", "replay-dev"))
    args = ap.parse_args()
    manifest = json.load(open(os.path.join(args.dir, "manifest.json"), encoding="utf8"))
    cmap = load_circuit_map()
    by_circuit = {}
    for r in manifest["races"]:
        if not r.get("file"):
            continue
        ref = cmap.get(str(r["raceId"]))
        if ref:
            by_circuit.setdefault(ref, []).append(r)
    index, report = {}, []
    for ref, races in sorted(by_circuit.items()):
        races.sort(key=lambda r: (r["year"] != 2025, -r["year"], -r["raceId"]))      # 2025 first, else newest
        chosen, pack, problems = None, None, []
        for r in races:
            j = json.load(gzip.open(os.path.join(args.dir, r["file"]), "rt", encoding="utf8"))
            pack, problems, _ = build_pack(j, ref)
            chosen = r
            if pack is not None and not any(p.startswith("outline does not close") for p in problems):
                break
        if pack is None:
            report.append((ref, chosen["year"], None, problems, "NOT BUILT"))
            continue
        path = os.path.join(args.dir, f"pack-{ref}.json")
        text = json.dumps(pack, separators=(",", ":"))
        with open(path, "w", encoding="utf8") as fh:
            fh.write(text)
        size = len(text.encode("utf8"))
        if size > MAX_BYTES:
            problems.append(f"{size} bytes exceeds the {MAX_BYTES} budget")
        index[ref] = {"file": f"pack-{ref}.json", "bytes": size, "raceId": chosen["raceId"], "year": chosen["year"], "name": chosen["name"],
                      "laps": pack["laps"], "lap_s": pack["lap_s"], "pit": pack["pit"] is not None}
        report.append((ref, chosen["year"], pack, problems, "ok" if not problems else "CHECK"))
    with open(os.path.join(args.dir, "packs.json"), "w", encoding="utf8") as fh:
        fh.write(json.dumps({"v": 1, "circuits": index}, separators=(",", ":")))
    print(f"{len(index)} packs written to {args.dir}")
    print(f"{'circuit':14} {'yr':4} {'laps':>4} {'len m':>6} {'lap s':>6} {'pitloss':>7} {'pit m':>5} {'KB':>4}  status")
    for ref, yr, pk, probs, st in report:
        if pk is None:
            print(f"{ref:14} {yr:4}  -- {st}: {'; '.join(probs)}")
            continue
        print(f"{ref:14} {yr:4} {pk['laps']:>4} {pk['length_m']:>6} {pk['lap_s']:>6} {str(pk['pit_loss_s']):>7} {(pk['pit'] or {}).get('length_m', '-'):>5} {index[ref]['bytes'] // 1024:>4}  {st}"
              + ("" if not probs else "  <- " + "; ".join(probs)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
