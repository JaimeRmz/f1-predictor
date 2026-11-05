// Navigation model: five top-level sections plus a MORE menu. Page keys are the existing keys in App.jsx, so no page
// or route is removed -- only how you reach them changes. My Picks is deliberately absent (page kept, not linked).
import { NEXT_RACE } from "./constants.js";

export const PAGES = {
  home: "Home",
  race: `Next Race ${NEXT_RACE.flag}`,
  predictor: "Predictor",
  replay: "Replay",
  champ: "Championship",
  drivers: "Drivers",
  season: "2026 Season",
  live: "Live",
  model: "Model",
  whatif: "What-If 🎮",
  compare: "Compare",
  picks: "My Picks 🎯",
};

export const SECTIONS = [
  { id: "home", label: "HOME", pages: [PAGES.home] },
  { id: "race", label: "RACE", pages: [PAGES.race, PAGES.predictor, PAGES.replay] },
  { id: "champ", label: "CHAMPIONSHIP", pages: [PAGES.champ, PAGES.drivers, PAGES.season] },
  { id: "live", label: "LIVE", pages: [PAGES.live] },
  { id: "model", label: "MODEL", pages: [PAGES.model] },
];

export const MORE = [
  { page: PAGES.whatif, label: "WHAT-IF" },
  { page: PAGES.compare, label: "COMPARE" },
];

// Short label for the in-section tabs.
export const SUB_LABEL = {
  [PAGES.race]: "NEXT RACE", [PAGES.predictor]: "PREDICTOR", [PAGES.replay]: "REPLAY",
  [PAGES.champ]: "STANDINGS", [PAGES.drivers]: "DRIVERS", [PAGES.season]: "2026 SEASON",
};

export const sectionOf = (page) => SECTIONS.find((s) => s.pages.includes(page)) || null;
export const inMore = (page) => MORE.some((m) => m.page === page);
