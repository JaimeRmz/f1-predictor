import { forwardRef, useRef, useEffect } from "react";
import { hexA, glassStyle, prefersReducedMotion } from "../constants.js";

// ── HUD GLASS PANEL ────────────────────────────────────────────────
// "Pit Wall / Broadcast HUD" panel: a frosted-glass surface that behaves like a
// live telemetry monitor. Frosted fill over --glass-base, a hairline --hud-line
// border, an optional translucent team-tint overlay with a matching outer glow,
// and 4 broadcast-camera corner brackets.
//
// Phase 2 adds motion, all of it self-disabling for reduced-motion / touch:
//   • cursor parallax tilt (a few degrees of rotateX/Y toward the pointer)
//   • a light-sweep reflection on mount (staggered) and on pointer-enter
//
// The bare `glassStyle(tint)` style object lives in constants.js (so this file
// exports only components, per React Fast Refresh) — import it from there when
// you need the treatment on a non-GlassPanel element (e.g. a motion.div).

const MAX_TILT = 4; // degrees — subtle "visor catching light", not a gimmick

// Cursor tilt only makes sense with a real hovering pointer; on coarse/touch
// pointers it's disabled entirely (no jittery touch-position fake). Re-checked
// live on each interaction so it tracks an OS setting change without reload.
const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
    : false;
const motionOn = () => !prefersReducedMotion();

// Play the light-sweep once across the band via the Web Animations API. Used
// for both the mount reveal (with a stagger delay) and the pointer-enter replay.
// WAAPI (not a CSS loop) so it's a single pass — a reflection, not a shimmer.
function playSweep(band, delay) {
  if (!band || !motionOn()) return;
  band.animate(
    [
      { transform: "translateX(-140%)", opacity: 0 },
      { opacity: 0.5, offset: 0.5 },
      { transform: "translateX(160%)", opacity: 0 },
    ],
    { duration: 1000, delay, easing: "cubic-bezier(0.25,0.46,0.45,0.94)" }
  );
}

// The 4 broadcast-camera corner brackets (┌ ┐ └ ┘). Absolutely-positioned
// children rather than pseudo-elements, since ::before/::after give only two
// corners. Color follows the tint (or a neutral hairline when untinted).
export const HudBrackets = ({ tint }) => {
  const color = tint ? hexA(tint, 0.55) : "rgba(255,255,255,0.22)";
  return (
    <>
      {["tl", "tr", "bl", "br"].map(pos => (
        <span key={pos} className={`hud-bracket ${pos}`} style={{ borderColor: color }} aria-hidden="true" />
      ))}
    </>
  );
};

// The panel itself. Forwards its ref and spreads extra props (onClick, data-*,
// pointer handlers) onto the root div. `tilt` / `sweep` opt out of the two
// motions individually (e.g. the What-If drag rows set tilt={false} because the
// drag gesture drives `transform` itself).
export const GlassPanel = forwardRef(function GlassPanel(
  { tint, glow = true, brackets = true, tilt = true, sweep = true, className = "", style, children, ...rest }, ref
) {
  const elRef = useRef(null);
  const bandRef = useRef(null);
  const rafRef = useRef(0);

  const setRef = (node) => {
    elRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  // Mount reveal sweep — staggered by the row's --i (if any) so a list of
  // panels entering together ripples instead of flashing all at once.
  useEffect(() => {
    if (!sweep) return;
    const iVar = parseFloat(elRef.current?.style.getPropertyValue("--i")) || 0;
    playSweep(bandRef.current, Math.min(iVar * 55 + 120, 650));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEnter = () => { if (sweep) playSweep(bandRef.current, 0); };

  const onMove = (e) => {
    if (!tilt || !motionOn() || !finePointer()) return;
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!elRef.current) return;
      elRef.current.style.transform =
        `perspective(760px) rotateX(${(-py * MAX_TILT).toFixed(2)}deg) rotateY(${(px * MAX_TILT).toFixed(2)}deg)`;
    });
  };

  const onLeave = () => {
    if (!tilt) return;
    cancelAnimationFrame(rafRef.current);
    const el = elRef.current;
    if (el) el.style.transform = ""; // .glass-panel transition eases it flat
  };

  return (
    <div
      ref={setRef}
      className={`glass-panel${className ? " " + className : ""}`}
      style={{ ...glassStyle(tint, { glow }), ...style }}
      {...rest}
      onMouseMove={onMove}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {brackets && <HudBrackets tint={tint} />}
      {sweep && (
        <span className="glass-sweep-wrap" aria-hidden="true">
          <span ref={bandRef} className="glass-sweep-band" />
        </span>
      )}
      {children}
    </div>
  );
});

export default GlassPanel;
