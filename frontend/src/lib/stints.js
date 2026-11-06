// Tyre stints for the real replay: pure lookups, no React, no network. File format: see scripts/build_stints.py
//   { v: 1, raceId, stints: { "NOR": [["M", 1, 27], ["H", 28, 57]] } }    [compound letter, first lap, last lap], both ends inclusive.

export const STINTS_CREDIT = "Tyre data: OpenF1 /stints (CC BY-NC-SA 4.0).";
export const COMPOUND_NAME = { S: "soft", M: "medium", H: "hard", I: "intermediate", W: "wet" };

/** Validate a parsed stints file into Map(code -> [[letter, a, b], ...]). Anything malformed is dropped; null when nothing usable is left. */
export const decodeStints = (j) => {
  const src = j && typeof j === "object" && j.stints && typeof j.stints === "object" ? j.stints : null;
  if (!src) return null;
  const out = new Map();
  for (const [code, list] of Object.entries(src)) {
    if (!Array.isArray(list)) continue;
    const ok = list.filter((s) => Array.isArray(s) && COMPOUND_NAME[s[0]] && Number.isFinite(s[1]) && Number.isFinite(s[2]) && s[2] >= s[1]);
    if (ok.length) out.set(code, ok.slice().sort((p, q) => p[1] - q[1]));
  }
  return out.size ? out : null;
};

/** The compound letter a car is on during `lap` (a lap exactly on a stop belongs to the stint that ends on it: the in-lap). null when unknown. */
export const compoundAt = (stints, lap) => {
  if (!stints || !Number.isFinite(lap)) return null;
  for (const [letter, a, b] of stints) if (lap >= a && lap <= b) return letter;
  return null;
};

/** The lap a car is on at time t from its own line crossings (`lapStarts`, ascending seconds): 1 before the start, else the number of crossings so far. */
export const carLapAt = (lapStarts, t) => {
  if (!lapStarts || !lapStarts.length) return null;
  let lo = 0, hi = lapStarts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lapStarts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return Math.max(ans + 1, 1);
};

/** { code: letter } for every car that has stint data at time t. Cars without data are simply absent. */
export const tiresAt = (rep, stints, t) => {
  const out = {};
  if (!stints) return out;
  for (const car of rep.cars) {
    const letter = compoundAt(stints.get(car.code), carLapAt(car.lapStarts, t));
    if (letter) out[car.code] = letter;
  }
  return out;
};
