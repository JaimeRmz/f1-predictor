// Team identity: canonical ids, logo files and fallback codes. TeamMark.jsx is the ONLY file that builds a
// logo URL from this. To remove every logo (e.g. a team asks), set LOGOS_ENABLED = false, or delete the
// files in public/teams/ -- TeamMark falls back to a coloured code chip either way.
export const LOGOS_ENABLED = true;

export const TEAMS = {
  "mercedes":     { name: "Mercedes",     code: "MER", color: "#00d2be" },
  "ferrari":      { name: "Ferrari",      code: "FER", color: "#e10600" },
  "mclaren":      { name: "McLaren",      code: "MCL", color: "#ff8000" },
  "red-bull":     { name: "Red Bull",     code: "RBR", color: "#3671c6" },
  "alpine":       { name: "Alpine",       code: "ALP", color: "#0093cc" },
  "racing-bulls": { name: "Racing Bulls", code: "RB",  color: "#6692ff" },
  "haas":         { name: "Haas",         code: "HAA", color: "#b6babd" },
  "williams":     { name: "Williams",     code: "WIL", color: "#37bedd" },
  "audi":         { name: "Audi",         code: "AUD", color: "#b7babd" },
  "aston-martin": { name: "Aston Martin", code: "AMR", color: "#358c75" },
  "cadillac":     { name: "Cadillac",     code: "CAD", color: "#c8102e" },
};

// Order matters: the first matching rule wins, so "red bull" is tested before the bare "rb" rules.
const RULES = [
  [/racing\s*bulls?|\brb\b|rb f1|visa cash app|alphatauri|alpha tauri|toro\s*rosso/, "racing-bulls"],
  [/red\s*bull/, "red-bull"],
  [/audi|sauber|alfa\s*romeo|kick/, "audi"],
  [/alpine|renault/, "alpine"],
  [/aston|racing point|force india/, "aston-martin"],
  [/mercedes/, "mercedes"],
  [/ferrari/, "ferrari"],
  [/mclaren/, "mclaren"],
  [/haas/, "haas"],
  [/williams/, "williams"],
  [/cadillac/, "cadillac"],
];

// Any spelling the API or constants use ("RB F1 Team", "Racing Bulls", "Kick Sauber", "Alpine F1 Team"...) -> id, or null.
export const canonicalTeam = (raw) => {
  if (!raw) return null;
  if (TEAMS[raw]) return raw;
  const s = String(raw).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, id] of RULES) if (re.test(s)) return id;
  return null;
};

export const logoSrc = (id) => (LOGOS_ENABLED && TEAMS[id] ? `/teams/${id}.png` : null);
