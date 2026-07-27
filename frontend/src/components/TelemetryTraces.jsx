// ── AMBIENT TELEMETRY TRACES ───────────────────────────────────────
// Thin oscilloscope-style SVG lines whose dash flows along the path forever
// (draws itself in, loops seamlessly). Pure ambient texture for empty / low-
// content areas (Predictor empty state) and behind hero sections. Absolutely
// positioned to fill its (position:relative) parent; pointer-events:none.
//
// Motion is CSS (see .telemetry-traces in index.css), so it collapses to a
// static frame automatically under prefers-reduced-motion. Keep `opacity` low
// enough that it reads as texture, never as competing content.
//
// Three fixed waveforms across a 1200×200 viewBox, stretched to the parent via
// preserveAspectRatio="none" (non-scaling-stroke keeps them hair-thin).
const PATHS = [
  "M0,100 C150,40 260,40 400,100 S650,160 800,100 S1050,40 1200,100",
  "M0,130 C180,150 300,70 460,110 S720,150 880,90 S1080,120 1200,80",
  "M0,70 C200,110 320,150 500,110 S760,60 920,110 S1100,150 1200,120",
];

export const TelemetryTraces = ({ color = "var(--red)", opacity = 0.16, style }) => (
  <svg
    className="telemetry-traces"
    viewBox="0 0 1200 200"
    preserveAspectRatio="none"
    aria-hidden="true"
    style={{ opacity, ...style }}
  >
    {PATHS.map((d, i) => (
      <path key={i} className={`trace trace-${i + 1}`} d={d} stroke={color} />
    ))}
  </svg>
);

export default TelemetryTraces;
