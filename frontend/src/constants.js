// Shared non-component constants and helpers.
// In production (Vercel) the backend URL is injected at build time via
// VITE_API_URL. For local dev we fall back to the same host the app is served
// from on port 8000 — that resolves to http://127.0.0.1:8000 (or localhost),
// and also lets the LAN-exposed dev server (vite host:true) reach the API from
// another device without reconfiguration.
export const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

export const card = {
  background: "linear-gradient(155deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015) 60%), var(--glass-base)",
  backdropFilter: "blur(20px) saturate(170%)",
  WebkitBackdropFilter: "blur(20px) saturate(170%)",
  border: "1px solid var(--hud-line)",
  borderRadius: "14px",
  boxShadow: "var(--rim-top), var(--rim-bottom), 0 18px 44px -24px rgba(0, 0, 0, 0.75)",
};

// Red-tinted callout (What-If "Model Insight"). Frosted with a color tint
// rather than a flat fill, matching the banner treatment.
export const cardRed = {
  background: "linear-gradient(155deg, rgba(225,6,0,0.16), rgba(225,6,0,0.05) 70%), var(--glass-base)",
  backdropFilter: "blur(18px) saturate(160%)",
  WebkitBackdropFilter: "blur(18px) saturate(160%)",
  border: "1px solid var(--border-red)",
  borderRadius: "16px",
  boxShadow: "var(--rim-top), var(--rim-bottom), 0 18px 44px -26px rgba(225,6,0,0.45)",
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

// #RRGGBB (or #RGB) + alpha → an rgba() string. Used by the HUD GlassPanel to
// derive team-tint overlays, glows and corner-bracket colors from the hex team
// colors above. Passes non-hex values (e.g. CSS vars) straight through.
export const hexA = (hex, a) => {
  if (typeof hex !== "string" || hex[0] !== "#") return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// #RRGGBB → "r, g, b" (bare channels, for composing into rgba() inside CSS).
// Published as the --tone-rgb custom property by glassStyle so stylesheet rules
// — notably .card-lift:hover — can brighten a panel's border in its OWN tint
// instead of washing a team-colored card back to neutral white on hover.
// Returns null for non-hex input so the CSS fallback takes over.
export const hexChannels = (hex) => {
  if (typeof hex !== "string" || hex[0] !== "#") return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// The HUD glass treatment as a bare style object, for callers that can't use
// the <GlassPanel> element itself — e.g. a framer-motion node that must stay a
// motion.div to keep its existing layout animation. Lives here (not in the
// GlassPanel component file) so that file exports only components (React Fast
// Refresh requirement). A tint hex adds a translucent team-color overlay layer
// plus a matching outer glow; untinted is neutral frosted glass.
// A low-opacity white diagonal gradient over the dark frosted base is what
// makes the surface read as a lit sheet of glass rather than a grey box. When a
// team tint is supplied, that same diagonal is cast in the team color instead —
// so the panel picks up the team identity without the accent system touching
// the (semantically fixed) team hex itself.
const glassGradient = (tint) => tint
  ? `linear-gradient(155deg, ${hexA(tint, 0.14)}, ${hexA(tint, 0.035)} 60%), var(--glass-base)`
  : "linear-gradient(155deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015) 60%), var(--glass-base)";

export const glassStyle = (tint, { glow = true } = {}) => ({
  position: "relative",
  "--tone-rgb": hexChannels(tint) || "236, 236, 236",
  background: glassGradient(tint),
  // Blur radius and saturation are CSS vars so a mobile media query can dial
  // them down — backdrop-filter blur is the main perf cost on mobile Safari.
  backdropFilter: "blur(var(--glass-blur, 22px)) saturate(var(--glass-sat, 170%))",
  WebkitBackdropFilter: "blur(var(--glass-blur, 22px)) saturate(var(--glass-sat, 170%))",
  border: `1px solid ${tint ? hexA(tint, 0.28) : "var(--hud-line)"}`,
  borderRadius: "var(--glass-radius, 20px)",
  // Rim light first (bright hairline on the top edge, dark on the bottom — the
  // sense of physical thickness), then the cast shadow underneath.
  boxShadow: glow
    ? (tint
        ? `var(--rim-top), var(--rim-bottom), 0 24px 60px -28px ${hexA(tint, 0.5)}`
        : "var(--rim-top), var(--rim-bottom), 0 24px 60px -28px rgba(0,0,0,0.7)")
    : "var(--rim-top), var(--rim-bottom)",
});

// ── Constants shared by Predictor + Season2026 pages ───────────
export const UPCOMING_RACES_2026 = [
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

// Public site URL, shown on the shareable prediction card.
export const SITE_URL = "https://f1predictor.app";

// Circuit → ISO-3166 alpha-2 country code, for real flag images on the share
// card (emoji flags render as bare letters on Windows, which has no flag-emoji
// glyphs). Keyed by the same circuitRef used across the race constants.
export const CIRCUIT_COUNTRY = {
  hungaroring: "hu", zandvoort: "nl", monza: "it", madrid: "es", baku: "az",
  marina_bay: "sg", americas: "us", rodriguez: "mx", interlagos: "br",
  las_vegas: "us", losail: "qa", yas_marina: "ae",
};

// Flag image URL for a circuit (flagcdn.com, CORS-enabled so html-to-image can
// inline it into the captured PNG). Null when the circuit isn't mapped. A raster
// PNG (w320, crisp at the card's ~48px height) is used rather than SVG because
// html-to-image can't reliably embed an external SVG inside its foreignObject
// serialization — an SVG flag captures blank.
export const flagUrl = (circuitRef) => {
  const cc = CIRCUIT_COUNTRY[circuitRef];
  return cc ? `https://flagcdn.com/w320/${cc}.png` : null;
};

// The current upcoming race, as the single source of truth for the countdown,
// the What-If/Next-Race pages, and the prediction picker's lock. The Dutch GP is
// a SPRINT weekend, so `qualiCutoffISO` closes the pick window before Friday's
// first on-track session (FP1 10:30 UTC / Sprint Qualifying): Sprint Qualifying
// sets Saturday's sprint grid and the sprint result would otherwise be visible
// before a pick locks. For fairness — parity with the model snapshot, which
// freezes pre-weekend — the window shuts before any running, not at GP qualifying.
// `raceISO` matches RaceCountdown's target (15:00 CEST = 13:00 UTC).
export const NEXT_RACE = {
  raceId: 1180,
  round: 12,
  name: "Dutch Grand Prix",
  circuit: "Zandvoort",
  circuitRef: "zandvoort",
  flag: "🇳🇱",
  raceISO: "2026-08-23T13:00:00Z",
  qualiCutoffISO: "2026-08-21T10:00:00Z",
};

// Completed 2026 rounds, shared by the 2026 Season page and the My Picks
// history/results view. Ordered by round. `qualiISO` is each round's GP
// qualifying start (UTC, from races.csv) — the Accuracy Tracker uses it to tell
// a genuine pre-race model_snapshots row (snapshotted_at < qualiISO) apart from
// a post-qualifying backfill (rounds 1-10 were backfilled on 2026-07-23 via the
// /predict real-grid path, i.e. AFTER their quali).
export const COMPLETED_2026 = [
  { raceId: 1169, round: 1,  name: "Australian GP",         flag: "🇦🇺", qualiISO: "2026-03-07T05:00:00Z" },
  { raceId: 1170, round: 2,  name: "Chinese GP",            flag: "🇨🇳", qualiISO: "2026-03-14T07:00:00Z" },
  { raceId: 1171, round: 3,  name: "Japanese GP",           flag: "🇯🇵", qualiISO: "2026-03-28T06:00:00Z" },
  { raceId: 1172, round: 4,  name: "Miami GP",              flag: "🇺🇸", qualiISO: "2026-05-02T20:00:00Z" },
  { raceId: 1173, round: 5,  name: "Canadian GP",           flag: "🇨🇦", qualiISO: "2026-05-23T20:00:00Z" },
  { raceId: 1174, round: 6,  name: "Monaco GP",             flag: "🇲🇨", qualiISO: "2026-06-06T14:00:00Z" },
  { raceId: 1175, round: 7,  name: "Spanish GP (Barcelona)", flag: "🇪🇸", qualiISO: "2026-06-13T14:00:00Z" },
  { raceId: 1176, round: 8,  name: "Austrian GP",           flag: "🇦🇹", qualiISO: "2026-06-27T14:00:00Z" },
  { raceId: 1177, round: 9,  name: "British GP",            flag: "🇬🇧", qualiISO: "2026-07-04T15:00:00Z" },
  { raceId: 1178, round: 10, name: "Belgian GP",            flag: "🇧🇪", qualiISO: "2026-07-18T14:00:00Z" },
  { raceId: 1179, round: 11, name: "Hungarian GP",          flag: "🇭🇺", qualiISO: "2026-07-25T14:00:00Z" },
];

// Roster ordered by post-Hungary (round 11) championship standings.
export const STANDINGS_GRID_2026 = [
  { driverRef: "antonelli",  driver_name: "Kimi Antonelli",    team: "Mercedes",      grid: 1  },
  { driverRef: "hamilton",   driver_name: "Lewis Hamilton",     team: "Ferrari",       grid: 2  },
  { driverRef: "russell",    driver_name: "George Russell",     team: "Mercedes",      grid: 3  },
  { driverRef: "leclerc",    driver_name: "Charles Leclerc",    team: "Ferrari",       grid: 4  },
  { driverRef: "norris",     driver_name: "Lando Norris",       team: "McLaren",       grid: 5  },
  { driverRef: "max_verstappen", driver_name: "Max Verstappen",  team: "Red Bull",      grid: 6  },
  { driverRef: "piastri",    driver_name: "Oscar Piastri",      team: "McLaren",       grid: 7  },
  { driverRef: "hadjar",     driver_name: "Isack Hadjar",       team: "Red Bull",      grid: 8  },
  { driverRef: "lawson",     driver_name: "Liam Lawson",        team: "Racing Bulls",  grid: 9  },
  { driverRef: "gasly",      driver_name: "Pierre Gasly",       team: "Alpine",        grid: 10 },
  { driverRef: "lindblad",   driver_name: "Arvid Lindblad",     team: "Racing Bulls",  grid: 11 },
  { driverRef: "colapinto",  driver_name: "Franco Colapinto",   team: "Alpine",        grid: 12 },
  { driverRef: "bearman",    driver_name: "Oliver Bearman",     team: "Haas",          grid: 13 },
  { driverRef: "bortoleto",  driver_name: "Gabriel Bortoleto",  team: "Audi",          grid: 14 },
  { driverRef: "sainz",      driver_name: "Carlos Sainz",       team: "Williams",      grid: 15 },
  { driverRef: "albon",      driver_name: "Alex Albon",         team: "Williams",      grid: 16 },
  { driverRef: "ocon",       driver_name: "Esteban Ocon",       team: "Haas",          grid: 17 },
  { driverRef: "hulkenberg", driver_name: "Nico Hulkenberg",    team: "Audi",          grid: 18 },
  { driverRef: "alonso",     driver_name: "Fernando Alonso",    team: "Aston Martin",  grid: 19 },
  { driverRef: "stroll",     driver_name: "Lance Stroll",       team: "Aston Martin",  grid: 20 },
  { driverRef: "bottas",     driver_name: "Valtteri Bottas",    team: "Cadillac",      grid: 21 },
  { driverRef: "perez",      driver_name: "Sergio Perez",       team: "Cadillac",      grid: 22 },
];

