import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel.jsx";
import Panel from "../components/DashPanel.jsx";
import RaceStrip from "../components/RaceStrip.jsx";
import ReplayPlayer from "../components/ReplayPlayer.jsx";
import ProjectedRace from "../components/ProjectedRace.jsx";
import { SkeletonList } from "../shared.jsx";
import { useManifest, useReplayRace } from "../lib/useReplayData.js";
import { titleParts, CALENDAR } from "../lib/homeModel.js";
import "./home.css";
import "./replay.css";

// ── RACE · REPLAY ──────────────────────────────────────────────
// Real recorded positions of a completed race, replayed on the track outline. The files are produced offline by
// scripts/build_replay.py from OpenF1 historical data and served from VITE_REPLAY_BASE_URL (a public storage bucket) or, in
// development, /replay-dev/. When the base URL or a race file is missing, this page says so and the rest of the site is unaffected.
const CREDIT = "Position data: OpenF1 (CC BY-NC-SA 4.0). Replay is interpolated from ~3.8 Hz samples and is not official timing.";

const Unavailable = ({ children }) => (
  <Panel title="Replay not available" caption="Replays need the replay files, which are not set up for this view.">
    <p className="hm-note">{children}</p>
  </Panel>
);

const UPCOMING = CALENDAR.filter((r) => r.kind === "upcoming");

const ReplayPage = () => {
  const manifest = useManifest();
  const [picked, setPicked] = useState(null);
  const races = manifest.races;
  // Upcoming rounds sit at the end of the strip (id "p<raceId>") and open the Projected race instead of a recorded replay.
  const projectedRace = typeof picked === "string" ? UPCOMING.find((r) => `p${r.raceId}` === picked) || null : null;
  const entry = projectedRace ? null : races.find((r) => r.raceId === picked) || races[races.length - 1] || null;
  const data = useReplayRace(manifest.status === "ready" ? entry : null);
  const items = [
    ...races.map((r) => ({ id: r.raceId, tag: `${r.year} R${r.round}`, label: r.name.replace(/\s+(Grand Prix|GP)\b/, "") })),
    ...UPCOMING.map((r) => ({ id: `p${r.raceId}`, tag: `R${r.round} · PROJECTED`, label: r.short, upcoming: true })),
  ];
  const shown = projectedRace || entry;
  const { base, suffix } = shown ? titleParts(shown.name) : { base: "", suffix: "" };

  return (
    <div className="hm">
      {manifest.status === "ready" && shown && <RaceStrip items={items} selectedId={projectedRace ? `p${projectedRace.raceId}` : entry.raceId} onSelect={setPicked} />}

      <header className="hm-title">
        <div>
          <div className="hm-eyebrow">{projectedRace ? `PROJECTED RACE · ILLUSTRATION · 2026 · ROUND ${projectedRace.round}` : `REPLAY · REAL RECORDED POSITIONS${entry ? ` · ${entry.year} · ROUND ${entry.round}` : ""}`}</div>
          <h1 className="wordfit">{shown ? <>{base} <em>Grand Prix</em>{suffix && <span> {suffix}</span>}</> : <>Race <em>replay</em></>}</h1>
        </div>
      </header>

      {manifest.status === "loading" && <SkeletonList rows={4} metrics={1} />}
      {manifest.status === "unavailable" && <Unavailable>The replay files are not available on this deployment (no replay location is configured, or it could not be reached). Nothing else is affected.</Unavailable>}
      {manifest.status === "ready" && !shown && <Unavailable>No race has a replay yet.</Unavailable>}

      {projectedRace && manifest.status === "ready" && <ProjectedRace key={projectedRace.raceId} race={projectedRace} />}

      {entry && manifest.status === "ready" && data.status === "loading" && <SkeletonList rows={6} metrics={1} />}
      {entry && manifest.status === "ready" && data.status === "unavailable" && <Unavailable>Replay not available for this race. Pick another race above.</Unavailable>}
      {entry && data.status === "ready" && (
        <>
          <ReplayPlayer key={entry.raceId} rep={data.rep} />
          {entry.flags?.length > 0 && (
            <GlassPanel className="hm-panel" tilt={false}>
              <div className="hm-panel-h"><h2>Data notes for this race</h2><p>Where the recording is incomplete or approximated.</p></div>
              <div className="hm-panel-b"><p className="hm-note">{entry.flags.map((f) => FLAG_TEXT[f] || f).join(" ")}</p></div>
            </GlassPanel>
          )}
        </>
      )}

      {manifest.status === "ready" && (
        <p className="rp-credit">
          {projectedRace
            ? <>Projected race: an illustration, not a forecast and not a replay of real events.<br />Circuit shapes and typical times derived from OpenF1 position data (CC BY-NC-SA 4.0).</>
            : <>Replay of real recorded positions, interpolated; not official timing.<br />{manifest.license || CREDIT}</>}
        </p>
      )}
    </div>
  );
};

const FLAG_TEXT = {
  leader_match_below_95: "The computed order disagreed with the official feed more than usual, so treat the dots near the front with care.",
  order_within_one_below_93: "The order computed from the dots often differs from the official order by more than one place; the board uses the official order, so trust it over the dots in close fights.",
  dropped_drivers: "One or more cars had no usable position data and are missing.",
  location_gap_over_60s: "At least one car stopped sending positions for over a minute; its dot is hidden or frozen during that time.",
  pit_lane_not_drawn: "No clean pit lane could be derived for this circuit; pit stops are tagged PIT on the board only.",
  cars_fewer_than_classified: "Fewer cars have position data than were classified in the race; the missing cars are not drawn.",
};

export default ReplayPage;
