import { useState } from "react";
import { canonicalTeam, logoSrc, TEAMS } from "../teams.js";
import "./teamMark.css";

// The one place a team logo is rendered. It sits BESIDE the team colour bar and driver code, never in place of
// them, so a row still reads if a logo is missing: no file, a failed load, or LOGOS_ENABLED=false all render a
// small coloured chip carrying the team code instead.
export const TeamMark = ({ team, size = 28, title }) => {
  const id = canonicalTeam(team);
  const [failed, setFailed] = useState(null); // id whose file failed to load
  const meta = id ? TEAMS[id] : null;
  const src = id && failed !== id ? logoSrc(id) : null;
  const label = title || meta?.name || (team ? String(team) : "Team unknown");

  if (src) {
    return (
      <span className="tm-box" style={{ width: size * 1.35, height: size }} title={label}>
        <img src={src} alt={label} loading="lazy" decoding="async" onError={() => setFailed(id)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </span>
    );
  }
  const color = meta?.color || "#8a8a95";
  return (
    <span className="tm-box tm-chip" title={label} role="img" aria-label={label}
      style={{ width: size * 1.35, height: size, color, borderColor: color, fontSize: Math.max(8, size * 0.34) }}>
      {meta?.code || "—"}
    </span>
  );
};

export default TeamMark;
