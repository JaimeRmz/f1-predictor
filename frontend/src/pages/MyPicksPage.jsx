import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { SectionHeader, StatCard, Spinner, BackendPanel, DriverSelector } from "../shared.jsx";
import {
  API, card, NEXT_RACE, COMPLETED_2026, STANDINGS_GRID_2026,
  TEAM_COLORS, CONSTRUCTOR_OVERRIDES,
} from "../constants.js";
import { useHealth } from "../health.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabaseClient.js";

// ── MY PICKS PAGE ────────────────────────────────────────────────
// Two sections behind one anonymous Supabase identity:
//   1. Picker  — pick P1/P2/P3 for the upcoming race, upserted into the
//                `predictions` table; locked once qualifying starts.
//   2. Results — for each completed race, compares Your Pick vs the Model's
//                snapshot vs the Actual result, with a season-long winner tally.

// driverRef → display last name. STANDINGS_GRID_2026 is the base roster; the
// backend's actual-result rows augment/override it (they carry the correct
// historical names for each race).
const BASE_NAMES = Object.fromEntries(
  STANDINGS_GRID_2026.map(d => [d.driverRef, d.driver_name])
);
const lastName = (full) => (full ? full.split(" ").pop() : full);
const nameOf = (ref) => lastName(BASE_NAMES[ref] || ref);

const teamOf = (ref) => CONSTRUCTOR_OVERRIDES[ref] ||
  STANDINGS_GRID_2026.find(d => d.driverRef === ref)?.team;
const colorOf = (ref) => TEAM_COLORS[teamOf(ref)] || "var(--dimmed)";

// The model's top-3 for a race, as driverRefs. `model_snapshots` stores them
// in predicted_p1/p2/p3, matching how the picker stores its own picks and how
// the backend reports actual results. Returns null when there's no snapshot
// row for the race (handled as an empty Model column downstream).
const snapshotTop3 = (row) =>
  row?.predicted_p1 ? [row.predicted_p1, row.predicted_p2, row.predicted_p3] : null;

const isLocked = () => new Date() >= new Date(NEXT_RACE.qualiCutoffISO);

// ── Picker ───────────────────────────────────────────────────────
const PickTriplet = ({ refs }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    {["P1", "P2", "P3"].map((pos, i) => {
      const ref = refs?.[i];
      return (
        <div key={pos} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", fontWeight: "700", color: "var(--muted)", width: "22px", flexShrink: 0 }}>{pos}</span>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: ref ? colorOf(ref) : "var(--dimmed)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", fontWeight: "600", color: ref ? "var(--text)" : "var(--dimmed)" }}>
            {ref ? nameOf(ref) : "—"}
          </span>
        </div>
      );
    })}
  </div>
);

const Picker = () => {
  const { userId, status: authStatus } = useAuth();
  const locked = isLocked();

  const [picks, setPicks] = useState({ p1: "", p2: "", p3: "" });
  const [saved, setSaved] = useState(null);     // last-saved pick row (refs)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  // Load any existing pick for this race so re-visits/edits start from it.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-load flag; the fetch resolves async
    setLoading(true);
    supabase
      .from("predictions")
      .select("predicted_p1, predicted_p2, predicted_p3")
      .eq("user_id", userId)
      .eq("race_id", NEXT_RACE.raceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (!error && data) {
          setSaved([data.predicted_p1, data.predicted_p2, data.predicted_p3]);
          setPicks({ p1: data.predicted_p1, p2: data.predicted_p2, p3: data.predicted_p3 });
        }
        setLoading(false);
      });
    return () => { alive = false; };
  }, [userId]);

  const chosen = [picks.p1, picks.p2, picks.p3];
  const complete = chosen.every(Boolean);
  const distinct = new Set(chosen.filter(Boolean)).size === chosen.filter(Boolean).length;

  // Each slot excludes drivers already chosen in the other two slots.
  const optionsFor = (slot) => {
    const taken = new Set(chosen.filter((c, i) => c && i !== slot));
    return STANDINGS_GRID_2026.filter(d => !taken.has(d.driverRef));
  };

  const submit = async () => {
    if (!complete || !distinct || !userId) return;
    setSaving(true); setError(null); setJustSaved(false);
    const { error } = await supabase
      .from("predictions")
      .upsert(
        {
          user_id: userId,
          race_id: NEXT_RACE.raceId,
          predicted_p1: picks.p1,
          predicted_p2: picks.p2,
          predicted_p3: picks.p3,
        },
        { onConflict: "user_id,race_id" }
      );
    setSaving(false);
    if (error) { setError(error.message); return; }
    setSaved([picks.p1, picks.p2, picks.p3]);
    setJustSaved(true);
  };

  const quali = new Date(NEXT_RACE.qualiCutoffISO);
  const cutoffLabel = quali.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="chart-enter" style={{ ...card }}>
      <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <span className="section-label">{NEXT_RACE.flag} {NEXT_RACE.name} · Your Podium Pick</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.1em", color: locked ? "var(--red)" : "var(--green)" }}>
          {locked ? "● LOCKED" : "● OPEN"} · {locked ? "quali underway" : `closes ${cutoffLabel}`}
        </span>
      </div>

      <div style={{ padding: "1.25rem" }}>
        {authStatus === "error" ? (
          <p style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: "var(--red)", margin: 0 }}>
            Couldn't start an anonymous session — picks are unavailable. Check your connection and reload.
          </p>
        ) : authStatus !== "ready" || loading ? (
          <Spinner text="LOADING YOUR PICK..." />
        ) : locked ? (
          // Read-only once qualifying has started.
          saved ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <p style={{ fontFamily: "var(--mono)", fontSize: "0.66rem", color: "var(--muted)", margin: 0, lineHeight: 1.7 }}>
                Qualifying has begun, so your pick is locked in. Results appear below once the race is complete.
              </p>
              <PickTriplet refs={saved} />
            </div>
          ) : (
            <p style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", color: "var(--muted)", margin: 0 }}>
              Picks are closed for this race — you didn't submit one before qualifying.
            </p>
          )
        ) : (
          // Editable form.
          <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            {[0, 1, 2].map((slot) => {
              const key = `p${slot + 1}`;
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: "700", color: slot === 0 ? "var(--red)" : "var(--muted)", width: "28px", flexShrink: 0 }}>P{slot + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <DriverSelector
                      drivers={optionsFor(slot)}
                      value={picks[key]}
                      onSelect={(ref) => { setPicks(p => ({ ...p, [key]: ref })); setJustSaved(false); }}
                      placeholder={`Pick P${slot + 1}...`}
                    />
                  </div>
                </div>
              );
            })}

            {!distinct && (
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.64rem", color: "var(--red)" }}>Pick three different drivers.</span>
            )}
            {error && (
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.64rem", color: "var(--red)" }}>Save failed: {error}</span>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <button
                onClick={submit}
                disabled={!complete || !distinct || saving}
                className="btn-ghost"
                style={{
                  background: complete && distinct ? "var(--red)" : "rgba(255,255,255,0.06)",
                  border: "1px solid " + (complete && distinct ? "var(--red)" : "rgba(255,255,255,0.15)"),
                  color: complete && distinct ? "#fff" : "var(--muted)",
                  padding: "0.55rem 1.5rem", fontSize: "0.7rem", fontWeight: "700", letterSpacing: "0.12em",
                  textTransform: "uppercase", cursor: complete && distinct && !saving ? "pointer" : "not-allowed",
                  fontFamily: "var(--mono)",
                }}
              >
                {saving ? "Saving..." : saved ? "Update Pick" : "Submit Pick"}
              </button>
              {justSaved && (
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.66rem", fontWeight: "700", color: "var(--green)", letterSpacing: "0.06em" }}>✓ Saved</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Results / history ────────────────────────────────────────────
const podiumHits = (refs, actualSet) =>
  refs ? refs.filter(r => r && actualSet.has(r)).length : 0;

const PickColumn = ({ title, refs, actualSet, actualWinnerRef, accent }) => {
  const winnerRight = refs && actualWinnerRef && refs[0] === actualWinnerRef;
  const hits = podiumHits(refs, actualSet);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0.75rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.12em", color: accent || "var(--muted)", textTransform: "uppercase" }}>{title}</div>
      {refs ? (
        <>
          {[0, 1, 2].map(i => {
            const ref = refs[i];
            const onPodium = ref && actualSet.has(ref);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", width: "18px" }}>P{i + 1}</span>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: ref ? colorOf(ref) : "var(--dimmed)", flexShrink: 0 }} />
                <span style={{
                  fontFamily: "var(--mono)", fontSize: "0.68rem", fontWeight: "600",
                  color: onPodium ? "var(--green)" : "var(--text)",
                }}>{ref ? nameOf(ref) : "—"}</span>
              </div>
            );
          })}
          {actualWinnerRef && (
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "2px", fontFamily: "var(--mono)", fontSize: "0.6rem" }}>
              <span style={{ color: winnerRight ? "var(--gold)" : "var(--dimmed)", fontWeight: "700" }}>WIN {winnerRight ? "✓" : "✗"}</span>
              <span style={{ color: hits > 0 ? "var(--green)" : "var(--dimmed)", fontWeight: "700" }}>PODIUM {hits}/3</span>
            </div>
          )}
        </>
      ) : (
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.66rem", color: "var(--dimmed)" }}>—</span>
      )}
    </div>
  );
};

const ActualColumn = ({ orderedRefs }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0.75rem", background: "rgba(225,6,0,0.05)", borderRadius: "8px" }}>
    <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.12em", color: "var(--red)", textTransform: "uppercase" }}>Actual</div>
    {orderedRefs.length ? orderedRefs.map((ref, i) => (
      <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", width: "18px" }}>P{i + 1}</span>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: colorOf(ref), flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", fontWeight: "600", color: "var(--text)" }}>{nameOf(ref)}</span>
      </div>
    )) : <span style={{ fontFamily: "var(--mono)", fontSize: "0.66rem", color: "var(--dimmed)" }}>—</span>}
  </div>
);

const History = () => {
  const { userId, status: authStatus } = useAuth();
  const { wakeEpoch } = useHealth();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [snapshotsMissing, setSnapshotsMissing] = useState(false);

  const load = () => {
    if (!userId) return;
    setLoading(true); setFailed(false);
    const ids = COMPLETED_2026.map(r => r.raceId);

    const predsP = supabase.from("predictions")
      .select("race_id, predicted_p1, predicted_p2, predicted_p3")
      .eq("user_id", userId).in("race_id", ids);
    const snapsP = supabase.from("model_snapshots").select("*").in("race_id", ids);
    const actualsP = Promise.all(COMPLETED_2026.map(r =>
      axios.get(`${API}/predict/${r.raceId}`)
        .then(res => ({ raceId: r.raceId, data: res.data }))
        .catch(() => ({ raceId: r.raceId, __failed: true }))
    ));

    Promise.all([predsP, snapsP, actualsP]).then(([predsRes, snapsRes, actuals]) => {
      const predByRace = {};
      (predsRes.data || []).forEach(p => { predByRace[p.race_id] = [p.predicted_p1, p.predicted_p2, p.predicted_p3]; });
      const snapByRace = {};
      if (snapsRes.error) setSnapshotsMissing(true);
      else (snapsRes.data || []).forEach(s => { snapByRace[s.race_id] = snapshotTop3(s); });

      // Every actual failing → backend down/warming, not real data.
      if (actuals.every(a => a.__failed)) { setFailed(true); setLoading(false); return; }

      const built = COMPLETED_2026.map(race => {
        const a = actuals.find(x => x.raceId === race.raceId);
        let actualWinnerRef = null;
        let actualPodium = [];       // ordered P1..P3 refs
        if (a && !a.__failed) {
          a.data.forEach(d => { BASE_NAMES[d.driverRef] = BASE_NAMES[d.driverRef] || d.driver_name; });
          const winner = a.data.find(d => d.positionOrder === 1);
          actualWinnerRef = winner?.driverRef ?? null;
          actualPodium = a.data
            .filter(d => d.podium === 1)
            .sort((x, y) => x.positionOrder - y.positionOrder)
            .map(d => d.driverRef);
        }
        return {
          ...race,
          userRefs: predByRace[race.raceId] || null,
          modelRefs: snapByRace[race.raceId] || null,
          actualWinnerRef,
          actualPodium,
          actualSet: new Set(actualPodium),
          resultKnown: actualPodium.length > 0,
        };
      });
      setRows(built);
      setLoading(false);
    });
  };

  // Re-run once auth is ready and again whenever the backend wakes. `load` is
  // stable enough for our purposes (reads the latest userId via closure each
  // render); we intentionally key only on userId + wakeEpoch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() flips a loading flag then fetches; standard data-load effect
    if (userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load recreated each render; key on identity + wake only
  }, [userId, wakeEpoch]);

  const tally = useMemo(() => {
    if (!rows) return null;
    const scored = rows.filter(r => r.resultKnown);
    const userWins = scored.filter(r => r.userRefs && r.userRefs[0] === r.actualWinnerRef).length;
    const modelWins = scored.filter(r => r.modelRefs && r.modelRefs[0] === r.actualWinnerRef).length;
    const userPicked = scored.filter(r => r.userRefs).length;
    return { userWins, modelWins, userPicked, scored: scored.length };
  }, [rows]);

  if (authStatus === "error")
    return <p style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: "var(--red)" }}>Session unavailable — can't load your history.</p>;
  if (failed) return <BackendPanel detail="The results backfill request failed." onRetry={load} />;
  if (loading || !rows) return <Spinner text="LOADING RESULTS..." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Season tally */}
      <div className="stat-cards-row" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatCard label="Your Winners"  value={`${tally.userWins} / ${tally.scored}`}  accent="var(--gold)" sub={`from ${tally.userPicked} picked`} />
        <StatCard label="Model Winners" value={`${tally.modelWins} / ${tally.scored}`} accent="var(--red)"  sub="snapshot picks" />
        <StatCard label="Races Scored"  value={String(tally.scored)} sub="completed 2026" />
      </div>

      {snapshotsMissing && (
        <div style={{ ...card, padding: "0.85rem 1rem", borderColor: "rgba(255,176,32,0.35)" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "0.64rem", color: "var(--amber)" }}>
            Model snapshots couldn't be read — the Model column will be empty. (Check `model_snapshots` read access / columns.)
          </span>
        </div>
      )}

      {rows.map((r) => (
        <div key={r.raceId} className="chart-enter" style={{ ...card }}>
          <div style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", fontWeight: "700", color: "var(--muted)" }}>RD {r.round}</span>
            <span style={{ fontSize: "0.95rem" }}>{r.flag}</span>
            <span style={{ fontWeight: "700", fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.name}</span>
            {!r.resultKnown && <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--dimmed)" }}>result pending</span>}
          </div>
          <div style={{ padding: "0.85rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.6rem" }}>
            <PickColumn title="Your Pick" refs={r.userRefs} actualSet={r.actualSet} actualWinnerRef={r.resultKnown ? r.actualWinnerRef : null} accent="var(--gold)" />
            <PickColumn title="Model's Pick" refs={r.modelRefs} actualSet={r.actualSet} actualWinnerRef={r.resultKnown ? r.actualWinnerRef : null} accent="var(--muted)" />
            <ActualColumn orderedRefs={r.actualPodium} />
          </div>
        </div>
      ))}
    </div>
  );
};

const MyPicksPage = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
    <SectionHeader eyebrow="Play Along · Anonymous · Supabase" title="My Picks" />
    <Picker />
    <SectionHeader eyebrow="You vs the Model vs Reality" title="Results & History" />
    <History />
  </div>
);

export default MyPicksPage;
