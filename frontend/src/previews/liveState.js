// The LIVE / DELAYED / FINAL rule from docs/stage1/04-data-sources-and-live.md section 4.3, as a pure function
// so it can be tested. Stale data is NEVER shown as LIVE.
//
//   age = server_ts - source_ts, both supplied by the server; the visitor's clock is never used.
//
//   LIVE          session in progress AND age <= 10 s AND the feed is not a deliberately delayed feed
//   DELAYED       session in progress AND (the feed is deliberately delayed OR 10 s < age <= 90 s)
//   NO_LIVE_DATA  session in progress AND (age > 90 s OR age unknown): last-known time, never the word LIVE
//   FINAL         session ended AND official results ingested and validated
//   PROVISIONAL   session ended, results not yet ingested ("provisional, last update HH:MM")
//   PRE           before the session
export const LIVE_MAX_AGE_S = 10;
export const DELAYED_MAX_AGE_S = 90;

export function liveBadge({ inProgress, ended, resultsIngested, ageS, delayedFeed }) {
  if (ended) return resultsIngested ? { key: "FINAL", label: "FINAL" } : { key: "PROVISIONAL", label: "PROVISIONAL" };
  if (!inProgress) return { key: "PRE", label: "NOT STARTED" };
  if (ageS == null || Number.isNaN(ageS) || ageS > DELAYED_MAX_AGE_S) return { key: "NO_LIVE_DATA", label: "NO LIVE DATA" };
  if (delayedFeed || ageS > LIVE_MAX_AGE_S) return { key: "DELAYED", label: "DELAYED" };
  return { key: "LIVE", label: "LIVE" };
}
