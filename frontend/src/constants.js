// Shared non-component constants and helpers.
// In production (Vercel) the backend URL is injected at build time via
// VITE_API_URL. For local dev we fall back to the same host the app is served
// from on port 8000 — that resolves to http://127.0.0.1:8000 (or localhost),
// and also lets the LAN-exposed dev server (vite host:true) reach the API from
// another device without reconfiguration.
export const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

export const card = {
  background: "rgba(255, 255, 255, 0.04)",
  backdropFilter: "blur(16px) saturate(180%)",
  WebkitBackdropFilter: "blur(16px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "12px",
  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
};

export const cardRed = {
  background: "rgba(225,6,0,0.06)",
  border: "1px solid var(--border-red)",
  borderRadius: "0px",
};

// Live media query (not a one-time snapshot) so toggling the OS setting
// takes effect without a reload.
const reducedMotionQuery = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;
export const prefersReducedMotion = () => !!reducedMotionQuery?.matches;

// DB still has each driver's most recent historical constructor (pre-rebrand/pre-transfer);
// override by driverRef since e.g. "Sauber" maps to Audi for some drivers but Cadillac for others.
export const CONSTRUCTOR_OVERRIDES = {
  bortoleto: "Audi", hulkenberg: "Audi",
  bottas: "Cadillac", perez: "Cadillac",
  colapinto: "Alpine", gasly: "Alpine",
  lawson: "Racing Bulls", lindblad: "Racing Bulls",
  bearman: "Haas", ocon: "Haas",
};


// Team accent colors for the 2026 grid, shared by every page that
// renders per-team color coding.
export const TEAM_COLORS = {
  "Mercedes": "#00d2be", "Ferrari": "#e10600", "McLaren": "#ff8000",
  "Red Bull": "#3671c6", "Alpine": "#0093cc", "Racing Bulls": "#6692ff",
  "Haas": "#b6babd", "Williams": "#37bedd", "Audi": "#b7babd",
  "Aston Martin": "#358c75", "Cadillac": "#c8102e",
};

// ── Constants shared by Predictor + Season2026 pages ───────────
export const UPCOMING_RACES_2026 = [
  { raceId: 1179, round: 11, name: "Hungarian Grand Prix",       circuit: "Hungaroring", circuitRef: "hungaroring",  date: "Jul 26" },
  { raceId: 1180, round: 12, name: "Dutch Grand Prix",           circuit: "Zandvoort",   circuitRef: "zandvoort",    date: "Aug 23" },
  { raceId: 1181, round: 13, name: "Italian Grand Prix",         circuit: "Monza",       circuitRef: "monza",        date: "Sep 6"  },
  { raceId: 1182, round: 14, name: "Spanish Grand Prix",         circuit: "Madrid",      circuitRef: "madrid",       date: "Sep 13" },
  { raceId: 1183, round: 15, name: "Azerbaijan Grand Prix",      circuit: "Baku",        circuitRef: "baku",         date: "Sep 26" },
  { raceId: 1184, round: 16, name: "Singapore Grand Prix",       circuit: "Marina Bay",  circuitRef: "marina_bay",   date: "Oct 11" },
  { raceId: 1185, round: 17, name: "United States Grand Prix",   circuit: "Austin",      circuitRef: "americas",     date: "Oct 25" },
  { raceId: 1186, round: 18, name: "Mexico City Grand Prix",     circuit: "Mexico City", circuitRef: "rodriguez",    date: "Nov 1"  },
  { raceId: 1187, round: 19, name: "Brazilian Grand Prix",       circuit: "São Paulo",   circuitRef: "interlagos",   date: "Nov 8"  },
  { raceId: 1188, round: 20, name: "Las Vegas Grand Prix",       circuit: "Las Vegas",   circuitRef: "las_vegas",    date: "Nov 22" },
  { raceId: 1189, round: 21, name: "Qatar Grand Prix",           circuit: "Lusail",      circuitRef: "losail",       date: "Nov 29" },
  { raceId: 1190, round: 22, name: "Abu Dhabi Grand Prix",       circuit: "Yas Marina",  circuitRef: "yas_marina",   date: "Dec 6"  },
];
export const UPCOMING_IDS = new Set(UPCOMING_RACES_2026.map(r => String(r.raceId)));

// The current upcoming race, as the single source of truth for the countdown,
// the What-If/Next-Race pages, and the prediction picker's lock. `qualiCutoffISO`
// is the machine-readable version of NextRacePage's "Qualifying · Sat Jul 25 ·
// 9:00 AM CDT" schedule row (09:00 CDT = 14:00 UTC): once qualifying starts, the
// picker locks. `raceISO` matches RaceCountdown's target (15:00 CEST = 13:00 UTC).
export const NEXT_RACE = {
  raceId: 1179,
  round: 11,
  name: "Hungarian Grand Prix",
  circuit: "Hungaroring",
  circuitRef: "hungaroring",
  flag: "🇭🇺",
  raceISO: "2026-07-26T13:00:00Z",
  qualiCutoffISO: "2026-07-25T14:00:00Z",
};

// Completed 2026 rounds, shared by the 2026 Season page and the My Picks
// history/results view. Ordered by round.
export const COMPLETED_2026 = [
  { raceId: 1169, round: 1,  name: "Australian GP",         flag: "🇦🇺" },
  { raceId: 1170, round: 2,  name: "Chinese GP",            flag: "🇨🇳" },
  { raceId: 1171, round: 3,  name: "Japanese GP",           flag: "🇯🇵" },
  { raceId: 1172, round: 4,  name: "Miami GP",              flag: "🇺🇸" },
  { raceId: 1173, round: 5,  name: "Canadian GP",           flag: "🇨🇦" },
  { raceId: 1174, round: 6,  name: "Monaco GP",             flag: "🇲🇨" },
  { raceId: 1175, round: 7,  name: "Spanish GP (Barcelona)", flag: "🇪🇸" },
  { raceId: 1176, round: 8,  name: "Austrian GP",           flag: "🇦🇹" },
  { raceId: 1177, round: 9,  name: "British GP",            flag: "🇬🇧" },
  { raceId: 1178, round: 10, name: "Belgian GP",            flag: "🇧🇪" },
];

// Roster ordered by post-Belgium (round 10) championship standings.
export const STANDINGS_GRID_2026 = [
  { driverRef: "antonelli",  driver_name: "Kimi Antonelli",    team: "Mercedes",      grid: 1  },
  { driverRef: "hamilton",   driver_name: "Lewis Hamilton",     team: "Ferrari",       grid: 2  },
  { driverRef: "russell",    driver_name: "George Russell",     team: "Mercedes",      grid: 3  },
  { driverRef: "leclerc",    driver_name: "Charles Leclerc",    team: "Ferrari",       grid: 4  },
  { driverRef: "norris",     driver_name: "Lando Norris",       team: "McLaren",       grid: 5  },
  { driverRef: "piastri",    driver_name: "Oscar Piastri",      team: "McLaren",       grid: 6  },
  { driverRef: "max_verstappen", driver_name: "Max Verstappen",  team: "Red Bull",      grid: 7  },
  { driverRef: "hadjar",     driver_name: "Isack Hadjar",       team: "Red Bull",      grid: 8  },
  { driverRef: "gasly",      driver_name: "Pierre Gasly",       team: "Alpine",        grid: 9  },
  { driverRef: "lawson",     driver_name: "Liam Lawson",        team: "Racing Bulls",  grid: 10 },
  { driverRef: "lindblad",   driver_name: "Arvid Lindblad",     team: "Racing Bulls",  grid: 11 },
  { driverRef: "colapinto",  driver_name: "Franco Colapinto",   team: "Alpine",        grid: 12 },
  { driverRef: "bearman",    driver_name: "Oliver Bearman",     team: "Haas",          grid: 13 },
  { driverRef: "bortoleto",  driver_name: "Gabriel Bortoleto",  team: "Audi",          grid: 14 },
  { driverRef: "sainz",      driver_name: "Carlos Sainz",       team: "Williams",      grid: 15 },
  { driverRef: "albon",      driver_name: "Alex Albon",         team: "Williams",      grid: 16 },
  { driverRef: "ocon",       driver_name: "Esteban Ocon",       team: "Haas",          grid: 17 },
  { driverRef: "alonso",     driver_name: "Fernando Alonso",    team: "Aston Martin",  grid: 18 },
  { driverRef: "hulkenberg", driver_name: "Nico Hulkenberg",    team: "Audi",          grid: 19 },
  { driverRef: "bottas",     driver_name: "Valtteri Bottas",    team: "Cadillac",      grid: 20 },
  { driverRef: "perez",      driver_name: "Sergio Perez",       team: "Cadillac",      grid: 21 },
  { driverRef: "stroll",     driver_name: "Lance Stroll",       team: "Aston Martin",  grid: 22 },
];

