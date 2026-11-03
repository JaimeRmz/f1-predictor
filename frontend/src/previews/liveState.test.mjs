// node src/previews/liveState.test.mjs
import assert from "node:assert/strict";
import { liveBadge } from "./liveState.js";

let pass = 0;
const t = (name, got, want) => { assert.equal(got, want, name); pass++; console.log("  PASS", name); };
const base = { inProgress: true, ended: false, resultsIngested: false, delayedFeed: false };

t("fresh data (3 s) in a live session is LIVE", liveBadge({ ...base, ageS: 3 }).key, "LIVE");
t("exactly 10 s is still LIVE", liveBadge({ ...base, ageS: 10 }).key, "LIVE");
t("10.1 s is DELAYED", liveBadge({ ...base, ageS: 10.1 }).key, "DELAYED");
t("45 s is DELAYED", liveBadge({ ...base, ageS: 45 }).key, "DELAYED");
t("exactly 90 s is DELAYED", liveBadge({ ...base, ageS: 90 }).key, "DELAYED");
t("90.1 s is NO LIVE DATA", liveBadge({ ...base, ageS: 90.1 }).key, "NO_LIVE_DATA");
t("unknown age is NO LIVE DATA (never LIVE)", liveBadge({ ...base, ageS: null }).key, "NO_LIVE_DATA");
t("NaN age is NO LIVE DATA", liveBadge({ ...base, ageS: NaN }).key, "NO_LIVE_DATA");
t("a deliberately delayed feed is DELAYED even when fresh", liveBadge({ ...base, ageS: 2, delayedFeed: true }).key, "DELAYED");
t("a delayed feed that has gone stale is NO LIVE DATA, not DELAYED", liveBadge({ ...base, ageS: 120, delayedFeed: true }).key, "NO_LIVE_DATA");
t("ended with validated results is FINAL", liveBadge({ ...base, inProgress: false, ended: true, resultsIngested: true, ageS: 500 }).key, "FINAL");
t("ended without ingested results is PROVISIONAL", liveBadge({ ...base, inProgress: false, ended: true, resultsIngested: false, ageS: 5 }).key, "PROVISIONAL");
t("before the session there is no live badge", liveBadge({ ...base, inProgress: false, ageS: 1 }).key, "PRE");

// invariant: no input with age > 10 s or a delayed feed can ever produce LIVE
let bad = 0;
for (const ageS of [10.01, 11, 30, 90, 91, 1e6, null, NaN]) for (const delayedFeed of [false, true]) for (const inProgress of [true, false])
  for (const ended of [true, false]) for (const resultsIngested of [true, false]) {
    if (liveBadge({ inProgress, ended, resultsIngested, ageS, delayedFeed }).key === "LIVE") bad++;
  }
for (const delayedFeed of [true]) for (const ageS of [0, 1, 5, 10]) for (const inProgress of [true, false]) for (const ended of [true, false]) for (const resultsIngested of [true, false])
  if (liveBadge({ inProgress, ended, resultsIngested, ageS, delayedFeed }).key === "LIVE") bad++;
t("invariant: stale or delayed data can never render LIVE", bad, 0);
console.log(`\n${pass} passed, 0 failed`);
