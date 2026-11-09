// Which "Race sim" the Home band shows for the selected race pill. Pure: no React, no network.
//   upcoming round              -> "projected"   (the model's order played out; same generator as the Replay page)
//   completed, replay exists    -> "replay"      (the real recorded race; the big file is only fetched when Play is pressed)
//   completed, no replay file   -> "no-replay"   (Monaco 2026: a one-line note, no player)
//   completed, manifest loading / unreachable -> "loading" / "unavailable"
// `manifest` is { status: "loading" | "ready" | "unavailable", races } as useManifest() returns it (races = entries that have a file).
//   upcoming but the race has already finished (start time + 3 h passed) and results are not in the data yet -> "race-over":
//   no projection, no starting grid, no Play button, only "Race finished. Results are loading."
export const simMode = (race, manifest, raceOver = false) => {
  if (!race) return { mode: "none", entry: null };
  if (race.kind === "upcoming") return { mode: raceOver ? "race-over" : "projected", entry: null };
  if (!manifest || manifest.status === "loading") return { mode: "loading", entry: null };
  if (manifest.status !== "ready") return { mode: "unavailable", entry: null };
  const entry = manifest.races.find((r) => r.raceId === race.raceId && r.file) || null;
  return entry ? { mode: "replay", entry } : { mode: "no-replay", entry: null };
};

// Circuit (circuit-pack name) of each completed 2026 round. constants.js only carries circuitRef for the upcoming rounds; the pack gives the
// track outline and start line for the grid preview shown before the real replay is downloaded.
export const COMPLETED_CIRCUIT = {
  1169: "albert_park", 1170: "shanghai", 1171: "suzuka", 1172: "miami", 1173: "villeneuve", 1174: "monaco", 1175: "catalunya", 1176: "red_bull_ring",
  1177: "silverstone", 1178: "spa", 1179: "hungaroring", 1180: "zandvoort", 1181: "monza", 1182: "madring", 1183: "baku", 1184: "sepang",
  1185: "marina_bay", 1186: "americas", 1187: "rodriguez", 1188: "interlagos",
};
export const circuitRefOf = (race) => race.circuitRef || COMPLETED_CIRCUIT[race.raceId] || null;

/** The Replay page chip id for a race: completed rounds use the raceId, upcoming ones "p<raceId>". */
export const replayTargetFor = (race) => (race.kind === "upcoming" ? `p${race.raceId}` : race.raceId);

export const RACE_OVER_NOTE = "Race finished. Results are loading.";
export const NO_REPLAY_NOTE = "No replay available for this race.";

export const PROJECTED_NOTICE = "The model's ranking played out as a race. It shows the order the model expects, not a forecast of the exact finishing order or of events such as pit stops, safety cars or incidents.";
