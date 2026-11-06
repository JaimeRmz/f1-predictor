import { useState } from "react";
import ReplayPlayer from "./ReplayPlayer.jsx";
import { SkeletonList } from "../shared.jsx";
import { usePackIndex, usePack, useProjectedRace } from "../lib/useProjectedRace.js";
import { useManifest, useReplayRace, REPLAY_CREDIT } from "../lib/useReplayData.js";
import { DEFAULT_SEED } from "../lib/projectedRace.js";
import { STINTS_CREDIT } from "../lib/stints.js";
import { simMode, replayTargetFor, circuitRefOf, PROJECTED_NOTICE } from "../lib/raceSim.js";
import "../pages/replay.css";

// Home "Race sim" band: the same player and generator as the Replay page, in a compact layout.
//   upcoming round  -> the projected race (model order). Needs only the circuit pack (about 4 KB) and the rows Home already has.
//   completed round -> the real replay. Before Play it shows the starting grid (drawn from the circuit pack, no big file); the 360 KB replay
//                      file is requested only when the visitor presses Play or moves keyboard focus into the band's controls.
//   Monaco 2026 (no replay file) -> one line, no player.
// Nothing here autoplays.
const Note = ({ children }) => <p className="rs-note">{children}</p>;

const OpenFull = ({ race, onOpenFull }) => (
  <a className="rp-btn rs-full" href="#replay" onClick={(e) => { e.preventDefault(); onOpenFull?.(replayTargetFor(race)); }}>OPEN FULL VIEW ↗</a>
);

const Frame = ({ race, kind, children, credit = null }) => (
  <section className="rs" aria-labelledby="hm-sim">
    <div className="hm-sec">
      <h2 id="hm-sim">Race sim</h2>
      {kind === "projected" && <span className="rs-chip proj">PROJECTED · ILLUSTRATION</span>}
      {kind === "replay" && <span className="rs-chip real">REPLAY · REAL RECORDED POSITIONS</span>}
    </div>
    {kind === "projected" && <div className="pr-notice" role="note"><b>ILLUSTRATION</b><p>{PROJECTED_NOTICE}</p></div>}
    <div className="rs-body" data-race={race.raceId}>{children}</div>
    {credit && <p className="rp-credit">{credit}</p>}
  </section>
);

const Projected = ({ race, rows, onOpenFull }) => {
  const index = usePackIndex();
  const entry = index.status === "ready" ? index.circuits[race.circuitRef] || null : null;
  const packState = usePack(entry);
  const { rep, error } = useProjectedRace(packState.pack, rows, DEFAULT_SEED);
  let body;
  if (index.status === "loading" || (entry && packState.status === "loading") || (packState.status === "ready" && !rep && !error)) body = <SkeletonList rows={4} metrics={1} />;
  else if (index.status === "unavailable" || !entry || !entry.pit || packState.status === "unavailable" || error) body = <Note>Projected race not available for this circuit.</Note>;
  else body = <ReplayPlayer rep={rep} projected compact openFull={<OpenFull race={race} onOpenFull={onOpenFull} />} />;
  return <Frame race={race} kind="projected">{body}</Frame>;
};

const Replay = ({ race, rows, entry, license, onOpenFull }) => {
  const index = usePackIndex();
  const pe = index.status === "ready" ? index.circuits[circuitRefOf(race)] || null : null;
  const packState = usePack(pe);
  const preview = useProjectedRace(packState.pack, rows, DEFAULT_SEED);    // the grid before the start: no replay file needed
  const [armed, setArmed] = useState(false);                               // Play pressed or focus moved into the controls
  const [wantPlay, setWantPlay] = useState(false);                         // Play pressed (not only focus)
  const data = useReplayRace(armed ? entry : null);
  const arm = () => setArmed(true);
  const press = () => { setArmed(true); setWantPlay(true); };
  const full = <OpenFull race={race} onOpenFull={onOpenFull} />;
  let body;
  if (armed && data.status === "ready") body = <ReplayPlayer key="real" rep={data.rep} compact autoPlay={wantPlay} openFull={full} />;
  else if (armed && data.status === "unavailable") body = <Note>Replay unavailable right now. Nothing else is affected.</Note>;
  else if (preview.rep) body = <ReplayPlayer key="grid" rep={preview.rep} projected preview compact deferPlay loading={armed && wantPlay} onPlayRequest={press} openFull={full} />;
  else body = (
    <div className="rs-hold">
      <button type="button" className="rp-btn rp-play" onClick={press} disabled={armed && wantPlay} aria-busy={(armed && wantPlay) || undefined}>{armed && wantPlay ? "LOADING…" : "▶ PLAY REPLAY"}</button>
      {full}
    </div>
  );
  return (
    <Frame race={race} kind="replay" credit={`${license || REPLAY_CREDIT} ${STINTS_CREDIT}`}>
      <div onFocusCapture={arm}>{body}</div>
    </Frame>
  );
};

const Completed = ({ race, rows, onOpenFull }) => {
  const manifest = useManifest();
  const { mode, entry } = simMode(race, manifest);
  if (mode === "loading") return <Frame race={race} kind="none"><SkeletonList rows={3} metrics={1} /></Frame>;
  if (mode === "no-replay") return <Frame race={race} kind="none"><Note>No replay available for this race.</Note></Frame>;
  if (mode === "unavailable") return <Frame race={race} kind="none"><Note>Replays are not available on this deployment.</Note></Frame>;
  return <Replay race={race} rows={rows} entry={entry} license={manifest.license} onOpenFull={onOpenFull} />;
};

/** `rows`: the model rows Home already fetched for this race (predicted grid for upcoming rounds, real grid for completed ones). */
const RaceSimBand = ({ race, rows, onOpenFull }) => (
  race.kind === "upcoming" ? <Projected race={race} rows={rows} onOpenFull={onOpenFull} /> : <Completed race={race} rows={rows} onOpenFull={onOpenFull} />
);

export default RaceSimBand;
