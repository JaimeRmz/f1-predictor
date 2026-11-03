#!/usr/bin/env python3
"""Polite, caching OpenF1 client for read-only research (Part 1C).

* Every response is cached on disk (analysis/cache/openf1/, NOT committed: it can
  reach tens of MB; rebuild by re-running the scripts) keyed by the full URL, so a
  re-run makes no network calls.
* Rate limit: OpenF1's homepage states 3 requests/second and 30 requests/minute for
  the free tier (the docs page states none). We stay well under both: at most one
  request every MIN_INTERVAL seconds, and we back off on HTTP 429/5xx.
* Historical data only (free, no authentication). No credential of any kind is used.
"""
import hashlib
import json
import os
import time

import requests

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CACHE = os.path.join(REPO, "analysis", "cache", "openf1")
os.makedirs(CACHE, exist_ok=True)
BASE = "https://api.openf1.org/v1"
MIN_INTERVAL = 2.4  # seconds between network calls => at most 25/min, below the stated 30/min
_last = [0.0]
STATS = {"network": 0, "cached": 0}


def get(endpoint, **params):
    url = f"{BASE}/{endpoint}"
    key = hashlib.sha1((url + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))).encode()).hexdigest()
    path = os.path.join(CACHE, f"{endpoint}_{key[:16]}.json")
    if os.path.exists(path):
        STATS["cached"] += 1
        return json.load(open(path, encoding="utf8"))
    for attempt in range(6):
        wait = MIN_INTERVAL - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        STATS["network"] += 1
        try:
            r = requests.get(url, params=params, timeout=60)
        except requests.RequestException as e:
            time.sleep(5 * (attempt + 1)); continue
        if r.status_code == 200:
            data = r.json()
            json.dump(data, open(path, "w", encoding="utf8"))
            return data
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(10 * (attempt + 1)); continue
        if r.status_code == 404:  # OpenF1 returns 404 with {"detail": "No results found."}
            data = []
            json.dump(data, open(path, "w", encoding="utf8"))
            return data
        raise RuntimeError(f"OpenF1 {url} {params} -> HTTP {r.status_code}: {r.text[:120]}")
    raise RuntimeError(f"OpenF1 {url} {params}: gave up after retries")


def get_qs(endpoint, qs):
    """Like get() but with a RAW query string, for OpenF1's comparison filters such as
    `date>=2026-11-01T21:30:00+00:00` that a params dict cannot express."""
    url = f"{BASE}/{endpoint}?{qs}"
    key = hashlib.sha1(url.encode()).hexdigest()
    path = os.path.join(CACHE, f"{endpoint}_raw_{key[:16]}.json")
    if os.path.exists(path):
        STATS["cached"] += 1
        return json.load(open(path, encoding="utf8"))
    for attempt in range(6):
        wait = MIN_INTERVAL - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        STATS["network"] += 1
        try:
            r = requests.get(url, timeout=60)
        except requests.RequestException:
            time.sleep(5 * (attempt + 1)); continue
        if r.status_code == 200:
            data = r.json(); json.dump(data, open(path, "w", encoding="utf8")); return data
        if r.status_code == 404:
            data = []; json.dump(data, open(path, "w", encoding="utf8")); return data
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(10 * (attempt + 1)); continue
        raise RuntimeError(f"OpenF1 {url} -> HTTP {r.status_code}: {r.text[:120]}")
    raise RuntimeError(f"OpenF1 {url}: gave up after retries")
