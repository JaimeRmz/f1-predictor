import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel.jsx";
import { TeamMark } from "../components/TeamMark.jsx";
import { TelemetryTraces } from "../components/TelemetryTraces.jsx";
import RaceStrip from "../components/RaceStrip.jsx";
import TitleRow from "../components/RaceTitle.jsx";
import Forecast from "../components/ForecastTable.jsx";
import Panel from "../components/DashPanel.jsx";
import SharePredictionCard from "../components/SharePredictionCard.jsx";
import { useRaceRows } from "../lib/useRaceRows.js";
import { dayTime, tz } from "../lib/timeFmt.js";
import { BackendPanel, WakingPanel, SkeletonList } from "../shared.jsx";
import { NEXT_RACE, SITE_URL, flagUrl } from "../constants.js";
import { TEAMS } from "../teams.js";
import { useShareCard } from "../useShareCard.js";
import { defaultRound, raceByRound, phaseOf, rankRows, teamColor, pctLabel, raceNote } from "../lib/homeModel.js";
import "./home.css";

// ── RACE PAGE ──────────────────────────────────────────────────
// Same language as Home: race strip, title row, shares of the field, team logos. Every earlier feature is kept:
// predicted qualifying order, pre-race prediction for every driver, the weekend schedule, the share-image button and the
// context note. Rows come from the same sources as before: /whatif (predicted grid) for upcoming rounds, /predict
// (real grid) for completed ones. Scores are shown as shares of this race's field; raw scores are in the tooltips.
const RacePage = () => {
  const [round, setRound] = useState(defaultRound);
  const race = raceByRound(round) || raceByRound(defaultRound());
  const isNext = race.raceId === NEXT_RACE.raceId;
  const upcoming = race.kind === "upcoming";
  const phase = phaseOf(race);
  const { res, slow, retry } = useRaceRows([race]);
  const cur = res[race.raceId];
  const ranked = cur?.status === "ready" ? rankRows(cur.rows) : [];
  const byGrid = [...ranked].sort((a, b) => (a.grid ?? 99) - (b.grid ?? 99));

  // ── Shareable prediction card (next race only: its date comes from NEXT_RACE) ──
  const { cardRef, shareState, share } = useShareCard(`${NEXT_RACE.circuitRef}-gp-prediction.png`, "Model prediction before qualifying.");
  const canShare = isNext && ranked.length >= 3;
  const sharePicks = ranked.slice(0, 3).map((r) => ({
    driver_name: r.driver_name,
    team: TEAMS[r.teamId]?.name || "Team unknown",
    color: teamColor(r.teamId),
    win_share_label: pctLabel(r.winPct, r.winShare),
    podium_share_label: pctLabel(r.podiumPct, r.podiumShare),
  }));
  const shareRace = {
    flagUrl: flagUrl(NEXT_RACE.circuitRef), name: NEXT_RACE.name, round: NEXT_RACE.round,
    date: new Date(NEXT_RACE.raceISO).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }),
  };

  const gridTitle = upcoming ? "Predicted starting grid" : "Starting grid";
  const gridCaption = upcoming
    ? "Order from the qualifying model (XGBoost regressor). It updates after real qualifying."
    : "The real starting grid for this race.";
  const forecastCaption = upcoming
    ? "Pre-qualifying prediction: it uses the predicted grid on the right and this circuit's history. Relative strength inside this race's field, not a calibrated chance. Win shares add up to 100%. Tap or hover a figure for the raw model score."
    : "Replay with the real grid, so it is not a forecast made before the race. Relative strength inside this race's field, not a calibrated chance. Win shares add up to 100%. Tap or hover a figure for the raw model score.";

  return (
    <div className="hm">
      <RaceStrip round={race.round} onSelect={setRound} />
      <div className="hm-herotrace">
        <TelemetryTraces color="#ffffff" opacity={0.1} />
        <TitleRow race={race} phase={phase} />
      </div>

      <div className="hm-grid">
        <div className="hm-main">
          {!cur && (slow ? <WakingPanel /> : <SkeletonList rows={8} metrics={2} />)}
          {cur?.status === "error" && (cur.http
            ? (
              <GlassPanel style={{ borderColor: "var(--border-red)", padding: "2rem", textAlign: "center" }}>
                <div className="hm-eyebrow red">FORECAST UNAVAILABLE</div>
                <p className="hm-note">The server is up but could not compute this forecast ({String(cur.http)}). Nothing is shown rather than possibly-wrong scores.</p>
                <button type="button" className="hm-link" onClick={retry}>Retry</button>
              </GlassPanel>
            )
            : <BackendPanel detail={`The ${race.name} prediction request failed.`} onRetry={retry} />)}
          {ranked.length > 0 && (
            <Forecast ranked={ranked} defaultAll note={raceNote(race.raceId)} title={upcoming ? "Pre-race prediction" : "Model replay"} caption={forecastCaption} />
          )}
        </div>

        <aside className="hm-side">
          {ranked.length > 0 && (
            <Panel title={gridTitle} caption={gridCaption}>
              <ol className="hm-grid-list">
                {byGrid.map((r) => (
                  <li key={r.driverRef} style={{ "--team": teamColor(r.teamId) }}>
                    <b>P{r.grid}</b><i className="hm-bar" /><TeamMark team={r.teamId} size={20} />
                    <span>{r.code}</span><em>{r.driver_name}</em>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel title="Race weekend schedule" caption={`Your local time (${tz}).`}>
            {isNext ? (
              <ul className="hm-sched">{NEXT_RACE.sessions.map((s) => (
                <li key={s.session} className={s.featured ? "race" : ""}>
                  <span><i aria-hidden="true">{s.emoji}</i> {s.session}</span>
                  <time dateTime={s.iso}>{dayTime.format(new Date(s.iso))}</time>
                </li>
              ))}</ul>
            ) : <p className="hm-note">{race.kind === "completed" ? "This round is complete." : "Session times for this round are not in the app yet."}</p>}
          </Panel>

          <Panel title="Share this prediction" caption="Saves an image of the model's top 3 for the next race.">
            {canShare ? (
              <button type="button" className="hm-more" style={{ margin: 0, width: "100%" }} onClick={share} disabled={shareState === "working"}>
                {shareState === "working" ? "GENERATING…" : "📸 SHARE PREDICTION"}
              </button>
            ) : <p className="hm-note">{isNext ? "Available once the prediction has loaded." : "Sharing is available for the next race only."}</p>}
          </Panel>

          {isNext && (
            <Panel title="About this prediction" caption="What the model is and is not using right now.">
              <p className="hm-note">
                Standard race weekend: three practice sessions. The grid is auto-predicted by the qualifying model and updates after real qualifying.
                Circuit podium rate uses exponential decay (0.75 per year) to weight recent {NEXT_RACE.circuit} history more heavily.
              </p>
            </Panel>
          )}
        </aside>
      </div>

      {/* Off-screen capture target for the share card: laid out (not display:none) but pushed off-viewport so
          html-to-image can snapshot it. */}
      {canShare && (
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
          <SharePredictionCard ref={cardRef} race={shareRace} picks={sharePicks} siteUrl={SITE_URL} />
        </div>
      )}
    </div>
  );
};

export default RacePage;
