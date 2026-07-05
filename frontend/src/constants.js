// Shared non-component constants and helpers.
export const API = `http://${window.location.hostname}:8000`;

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
  { raceId: 1177, round: 9,  name: "British Grand Prix",        circuit: "Silverstone", circuitRef: "silverstone",  date: "Jul 5"  },
  { raceId: 1178, round: 10, name: "Belgian Grand Prix",         circuit: "Spa",         circuitRef: "spa",          date: "Jul 19" },
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

export const STANDINGS_GRID_2026 = [
  { driverRef: "antonelli",  driver_name: "Kimi Antonelli",    team: "Mercedes",      grid: 1  },
  { driverRef: "russell",    driver_name: "George Russell",     team: "Mercedes",      grid: 2  },
  { driverRef: "hamilton",   driver_name: "Lewis Hamilton",     team: "Ferrari",       grid: 3  },
  { driverRef: "piastri",    driver_name: "Oscar Piastri",      team: "McLaren",       grid: 4  },
  { driverRef: "norris",     driver_name: "Lando Norris",       team: "McLaren",       grid: 5  },
  { driverRef: "leclerc",    driver_name: "Charles Leclerc",    team: "Ferrari",       grid: 6  },
  { driverRef: "max_verstappen", driver_name: "Max Verstappen",  team: "Red Bull",      grid: 7  },
  { driverRef: "hadjar",     driver_name: "Isack Hadjar",       team: "Red Bull",      grid: 8  },
  { driverRef: "gasly",      driver_name: "Pierre Gasly",       team: "Alpine",        grid: 9  },
  { driverRef: "lawson",     driver_name: "Liam Lawson",        team: "Racing Bulls",  grid: 10 },
  { driverRef: "bearman",    driver_name: "Oliver Bearman",     team: "Haas",          grid: 11 },
  { driverRef: "colapinto",  driver_name: "Franco Colapinto",   team: "Alpine",        grid: 12 },
  { driverRef: "lindblad",   driver_name: "Arvid Lindblad",     team: "Racing Bulls",  grid: 13 },
  { driverRef: "sainz",      driver_name: "Carlos Sainz",       team: "Williams",      grid: 14 },
  { driverRef: "albon",      driver_name: "Alex Albon",         team: "Williams",      grid: 15 },
  { driverRef: "ocon",       driver_name: "Esteban Ocon",       team: "Haas",          grid: 16 },
  { driverRef: "bortoleto",  driver_name: "Gabriel Bortoleto",  team: "Audi",          grid: 17 },
  { driverRef: "alonso",     driver_name: "Fernando Alonso",    team: "Aston Martin",  grid: 18 },
  { driverRef: "hulkenberg", driver_name: "Nico Hulkenberg",    team: "Audi",          grid: 19 },
  { driverRef: "bottas",     driver_name: "Valtteri Bottas",    team: "Cadillac",      grid: 20 },
  { driverRef: "perez",      driver_name: "Sergio Perez",       team: "Cadillac",      grid: 21 },
  { driverRef: "stroll",     driver_name: "Lance Stroll",       team: "Aston Martin",  grid: 22 },
];

