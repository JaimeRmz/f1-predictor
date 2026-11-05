import { useMemo, useState } from "react";
import Panel from "./DashPanel.jsx";
import ReplayPlayer from "./ReplayPlayer.jsx";
import { SkeletonList } from "../shared.jsx";
import { useRaceRows } from "../lib/useRaceRows.js";
import { usePackIndex, usePack, useProjectedRace } from "../lib/useProjectedRace.js";
import { randomSeed, PROJECTED_LABEL } from "../lib/projectedRace.js";
import "../pages/replay.css";

const Unavailable = ({ title = "Projected race not available", children }) => (
  <Panel title={title} caption="The illustration needs the circuit files and the model scores.">
    <p className="hm-note">{children}</p>
  </Panel>
);

// One illustrative race for an upcoming round, drawn in the browser from the model's existing scores and replayed by the same player as
// the recorded races. Nothing here is a forecast and no score or share on the site is changed by it.
const ProjectedRace = ({ race }) => {
  const [seed, setSeed] = useState(() => randomSeed());
  const index = usePackIndex();
  const entry = index.status === "ready" ? index.circuits[race.circuitRef] || null : null;
  const packState = usePack(entry);
  const raceList = useMemo(() => [race], [race]);
  const { res, slow, retry } = useRaceRows(raceList);
  const rowsState = res[race.raceId];
  const { rep, error } = useProjectedRace(packState.pack, rowsState?.status === "ready" ? rowsState.rows : null, seed);

  if (index.status === "loading") return <SkeletonList rows={4} metrics={1} />;
  if (index.status === "unavailable") return <Unavailable>The circuit files are not available on this deployment (no replay location is configured, or it could not be reached). Nothing else is affected.</Unavailable>;
  if (!entry || !entry.pit) return <Unavailable>Projected race not available for this circuit.</Unavailable>;
  if (packState.status === "unavailable") return <Unavailable>The circuit file for {race.circuit} could not be loaded. Pick another race above.</Unavailable>;
  if (rowsState?.status === "error") {
    return (
      <Unavailable title="Waiting for the model">
        The model scores for this race could not be loaded ({rowsState.http || "no response"}). <button type="button" className="rp-btn" onClick={retry}>RETRY</button>
      </Unavailable>
    );
  }
  if (packState.status !== "ready" || rowsState?.status !== "ready") {
    return (
      <>
        <SkeletonList rows={6} metrics={1} />
        {slow && <p className="hm-note">The model server is waking up; this can take up to a minute.</p>}
      </>
    );
  }
  if (error) return <Unavailable>{error}</Unavailable>;

  return (
    <>
      <div className="pr-notice" role="note">
        <b>ILLUSTRATION</b>
        <p>{PROJECTED_LABEL}</p>
      </div>
      <div className="pr-bar">
        <span className="pr-seed">SEED <b>{seed}</b></span>
        <span className="pr-basis">{race.circuit} · track shape and typical times from the {entry.year} race</span>
        <button type="button" className="rp-btn pr-again" onClick={() => setSeed(randomSeed())}>↻ RUN ANOTHER RACE</button>
      </div>
      <ReplayPlayer key={`${race.raceId}-${seed}`} rep={rep} projected />
      <p className="pr-how">
        The finishing order is drawn at random from the model's win and podium scores, so drivers with higher scores tend to finish higher.
        Cars start from the predicted grid, make one or two stops in the real pit lane and never crash or retire. The same seed always gives the same race.
        The scores and shares shown on the Race page are unchanged.
      </p>
    </>
  );
};

export default ProjectedRace;
