import { useState, useEffect } from "react";
import { STANDINGS_GRID_2026, TEAM_COLORS, CONSTRUCTOR_OVERRIDES } from "../constants.js";

// ── RACE STRATEGY (tyre table + lap-by-lap position chart) ───────
// Loads the cached OpenF1 telemetry for one race on demand, straight from the
// repo-root data/ dir via import.meta.glob (no backend, no public/ copy). Each
// race's JSON is a separate lazy chunk, fetched only when its detail expands.
const strategyModules = import.meta.glob("../../../data/openf1_strategy/*.json");
function loadStrategy(raceId) {
  const entry = Object.entries(strategyModules).find(([k]) => k.endsWith(`/${raceId}.json`));
  return entry ? entry[1]().then(m => m.default) : Promise.resolve(null);
}

const NAME = Object.fromEntries(STANDINGS_GRID_2026.map(d => [d.driverRef, d.driver_name]));
const lastName = (ref) => (NAME[ref] || ref).split(" ").pop();
const teamOf = (ref) => CONSTRUCTOR_OVERRIDES[ref] || STANDINGS_GRID_2026.find(d => d.driverRef === ref)?.team;
const colorOf = (ref) => TEAM_COLORS[teamOf(ref)] || "#8a8a95";

const TYRE = {
  SOFT: "#e8402a", MEDIUM: "#f5d020", HARD: "#e9e9ea",
  INTERMEDIATE: "#3fa93b", WET: "#1c6fb8",
};
const tyreColor = (c) => TYRE[(c || "").toUpperCase()] || "#5a5a6e";
const tyreLetter = (c) => (c || "?").toUpperCase()[0];

// drivers sorted by classified finish (DNFs, by their standings order, last)
const orderedDrivers = (data) =>
  Object.entries(data.drivers).sort((a, b) => {
    const pa = a[1].result_position ?? 99, pb = b[1].result_position ?? 99;
    return pa - pb;
  });

// ── Tyre strategy table ──────────────────────────────────────────
const TyreTable = ({ data }) => {
  const drivers = orderedDrivers(data);
  const maxLap = Math.max(1, ...drivers.flatMap(([, d]) => d.stints.map(s => s.lap_end || 0)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", fontFamily: "var(--mono)", fontSize: "0.55rem", color: "var(--muted)", letterSpacing: "0.1em", paddingBottom: "2px" }}>
        <span style={{ width: "96px" }}>DRIVER</span>
        <span style={{ flex: 1 }}>STINTS · TYRE COMPOUND × LAPS</span>
        <span style={{ width: "70px", textAlign: "right" }}>STOPS</span>
      </div>
      {drivers.map(([ref, d]) => {
        // Exclude red-flag "pits" — under a stoppage OpenF1 logs the car sitting
        // in the pit lane as a single pit with the full stoppage duration (~35min
        // at Monaco). A real green-flag stop is well under 120s.
        const real = d.pits.filter(p => p.duration == null || p.duration < 120);
        const stops = real.length;
        const total = real.reduce((s, p) => s + (p.duration || 0), 0);
        return (
          <div key={ref} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "96px", display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
              <span style={{ width: "3px", height: "14px", background: colorOf(ref), flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.64rem", fontWeight: "700", color: d.dnf ? "var(--muted)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {lastName(ref)}
              </span>
            </div>
            <div style={{ flex: 1, display: "flex", height: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "3px", overflow: "hidden" }}>
              {d.stints.filter(s => s.lap_start && s.lap_end).map((s, i) => {
                const len = s.lap_end - s.lap_start + 1;
                const dark = ["HARD", "MEDIUM"].includes((s.compound || "").toUpperCase());
                return (
                  <div key={i} title={`${s.compound} · L${s.lap_start}–${s.lap_end}`} style={{
                    width: `${(len / maxLap) * 100}%`, background: tyreColor(s.compound),
                    borderRight: i < d.stints.length - 1 ? "1px solid #0a0a0c" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--mono)", fontSize: "0.52rem", fontWeight: "700",
                    color: dark ? "#111" : "#fff", overflow: "hidden",
                  }}>{len >= 3 ? tyreLetter(s.compound) : ""}</div>
                );
              })}
            </div>
            <span style={{ width: "70px", textAlign: "right", fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--muted)" }}>
              {stops}{total > 0 ? ` · ${total.toFixed(0)}s` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── Lap-by-lap position chart (custom SVG) ───────────────────────
const PositionChart = ({ data }) => {
  const drivers = orderedDrivers(data);
  const allLaps = drivers.flatMap(([, d]) => d.laps.map(l => l.lap));
  const allPos = drivers.flatMap(([, d]) => d.laps.map(l => l.position));
  if (!allLaps.length) return null;
  const maxLap = Math.max(...allLaps);
  const maxPos = Math.max(...allPos, 20);

  const W = 960, H = 440;
  const m = { top: 18, right: 104, bottom: 30, left: 40 };
  const plotW = W - m.left - m.right, plotH = H - m.top - m.bottom;
  const x = (lap) => m.left + (maxLap > 1 ? (lap - 1) / (maxLap - 1) : 0) * plotW;
  const y = (pos) => m.top + (maxPos > 1 ? (pos - 1) / (maxPos - 1) : 0) * plotH;

  const posTicks = [1, 5, 10, 15, 20].filter(p => p <= maxPos);
  const lapTicks = [];
  for (let l = 10; l < maxLap; l += 10) lapTicks.push(l);

  const scBand = (sc) => sc.type === "VSC"
    ? { fill: "rgba(28,111,184,0.14)", label: "VSC", color: "#5b9bd5" }
    : { fill: "rgba(245,209,32,0.12)", label: "SC", color: "#f5d020" };

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: "620px", display: "block" }}>
        {/* Safety car / VSC bands (behind everything) */}
        {(data.safety_cars || []).map((sc, i) => {
          const b = scBand(sc);
          const x0 = x(sc.lap_start), x1 = x(Math.min(sc.lap_end + 1, maxLap));
          return (
            <g key={`sc${i}`}>
              <rect x={x0} y={m.top} width={Math.max(2, x1 - x0)} height={plotH} fill={b.fill} />
              <text x={x0 + 3} y={m.top + 10} fontFamily="var(--mono)" fontSize="9" fontWeight="700" fill={b.color}>{b.label}</text>
            </g>
          );
        })}

        {/* Position gridlines + labels */}
        {posTicks.map(p => (
          <g key={`p${p}`}>
            <line x1={m.left} y1={y(p)} x2={m.left + plotW} y2={y(p)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={m.left - 6} y={y(p) + 3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">P{p}</text>
          </g>
        ))}
        {/* Lap ticks */}
        {lapTicks.map(l => (
          <text key={`l${l}`} x={x(l)} y={H - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">L{l}</text>
        ))}
        <text x={m.left + plotW / 2} y={H - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)" opacity="0" />

        {/* Driver lines */}
        {drivers.map(([ref, d]) => {
          if (!d.laps.length) return null;
          const pts = d.laps.map(l => ({ x: x(l.lap), y: y(l.position), approx: l.approx }));
          let solid = "", dashed = "";
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const seg = `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
            if (a.approx || b.approx) dashed += seg; else solid += seg;
          }
          const c = colorOf(ref);
          const end = pts[pts.length - 1];
          const finisher = !d.dnf;
          return (
            <g key={ref}>
              {solid && <path d={solid} fill="none" stroke={c} strokeWidth="1.4" strokeOpacity="0.9" strokeLinejoin="round" />}
              {dashed && <path d={dashed} fill="none" stroke={c} strokeWidth="1.4" strokeOpacity="0.4" strokeDasharray="3 3" strokeLinejoin="round" />}
              {/* Final point: always a definitive solid dot (anchored to results.csv) */}
              <circle cx={end.x} cy={end.y} r={finisher ? 2.7 : 2.4}
                fill={finisher ? c : "#0a0a0c"} stroke={c} strokeWidth={finisher ? 0 : 1.3} />
              <text x={end.x + 6} y={end.y + 3} fontFamily="var(--mono)" fontSize="8.5"
                fontWeight={finisher ? "700" : "500"} fill={finisher ? c : "var(--muted)"}>
                {lastName(ref)}{d.dnf ? " ×" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ── Wrapper: lazy-load + render ──────────────────────────────────
const RaceStrategy = ({ raceId }) => {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | empty | error

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard on-demand load flag; resolves async
    setState("loading");
    loadStrategy(raceId)
      .then(d => { if (!alive) return; if (d) { setData(d); setState("ready"); } else setState("empty"); })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [raceId]);

  if (state === "loading") return <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--muted)", padding: "0.75rem" }}>Loading strategy telemetry…</div>;
  if (state === "empty") return <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--muted)", padding: "0.75rem" }}>No strategy data cached for this race.</div>;
  if (state === "error") return <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--red)", padding: "0.75rem" }}>Couldn't load strategy telemetry.</div>;

  const pc = data.position_confidence || {};
  const sparse = pc.finishers && pc.on_track_agreed / pc.finishers < 0.75;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "0.5rem 0.25rem" }}>
      {/* Tyres */}
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", fontWeight: "700", letterSpacing: "0.14em", color: "var(--gold)", marginBottom: "0.6rem" }}>TYRE STRATEGY</div>
        <TyreTable data={data} />
      </div>

      {/* Position chart */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.4rem" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", fontWeight: "700", letterSpacing: "0.14em", color: "var(--red)" }}>LAP-BY-LAP POSITION</span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.9rem", fontFamily: "var(--mono)", fontSize: "0.54rem", color: "var(--muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}><span style={{ width: "16px", height: "2px", background: "var(--muted)" }} /> recorded</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}><span style={{ width: "16px", height: "0", borderTop: "2px dashed var(--muted)", opacity: 0.6 }} /> approximate</span>
          </span>
        </div>
        {sparse && (
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.56rem", color: "var(--amber)", marginBottom: "0.4rem", lineHeight: 1.6 }}>
            Sparse OpenF1 position data this race — mid-race trajectory is approximate (dashed) where positions were interpolated. Only {pc.on_track_agreed}/{pc.finishers} finishers' on-track order matched the official result before anchoring. Final positions are exact.
          </div>
        )}
        <PositionChart data={data} />
      </div>
    </div>
  );
};

// ── Shared expand/collapse section (toggle + lazy body) ──────────
// One styled entry point used by both MyPicksPage and Season2026Page so the
// feature reads identically in both. Expand state is owned by each page (passed
// in via `open`/`onToggle`) — the two pages don't share state. `label` lets the
// season page put the race identity on the row itself; My Picks keeps the
// default (the race name already sits in that card's header).
export const RaceStrategySection = ({ raceId, open, onToggle, label = "Race Strategy & Telemetry" }) => (
  <>
    <button
      onClick={onToggle}
      className="data-row"
      style={{
        width: "100%", display: "flex", alignItems: "stretch", gap: "0.55rem",
        border: "none", borderTop: "1px solid var(--border)",
        background: open ? "rgba(225,6,0,0.08)" : "rgba(225,6,0,0.04)",
        cursor: "pointer", textAlign: "left", padding: "0.6rem 0.85rem",
      }}
    >
      {/* Red accent bar — signals a real feature, not secondary metadata */}
      <span style={{ width: "3px", background: "var(--red)", flexShrink: 0, opacity: open ? 1 : 0.55, borderRadius: "2px" }} />
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "0.82rem", lineHeight: 1, flexShrink: 0 }}>🏁</span>
        <span style={{
          fontFamily: "var(--mono)", fontSize: "0.64rem", fontWeight: "700",
          letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--red)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{label}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", color: "var(--red)", fontSize: "0.66rem", flexShrink: 0, opacity: 0.85 }}>
        {open ? "▾" : "▸"}
      </span>
    </button>
    {open && (
      <div style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 0.85rem 0.9rem" }}>
        <RaceStrategy raceId={raceId} />
      </div>
    )}
  </>
);

export default RaceStrategy;
