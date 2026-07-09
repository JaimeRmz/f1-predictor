import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { card, prefersReducedMotion } from "./constants.js";
import { useHealth } from "./health.jsx";

// ── Shared components ──────────────────────────────────────────


// Animated number: counts from its previous value (0 on first mount) to
// `value` with an ease-out cubic over ~700ms. Rendered digits stay steady
// thanks to the global tabular-nums. Skips straight to the final value
// under prefers-reduced-motion.
export const CountUp = ({ value, decimals = 1, suffix = "" }) => {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0));
  const fromRef = useRef(prefersReducedMotion() ? value : 0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    // Zero-duration run still goes through one rAF tick (never a sync
    // setState inside the effect body) and lands exactly on `value`.
    const duration = prefersReducedMotion() || from === value ? 0 : 700;
    let raf;
    const start = performance.now();
    const tick = now => {
      const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display.toFixed(decimals)}{suffix}</>;
};

// Backend-unreachable state, styled after the header's SYS STATUS readout.
export const OfflinePanel = ({ detail = "The prediction engine isn't responding.", onRetry }) => (
  <div style={{ ...card, borderColor: "var(--border-red)", padding: "3rem 2rem", textAlign: "center" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--red)", animation: "pulse 1.2s infinite" }} />
      <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", fontWeight: "700", color: "var(--red)", letterSpacing: "0.2em" }}>SYS STATUS · OFFLINE</span>
    </div>
    <div style={{ fontSize: "1rem", fontWeight: "900", fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>Model server unreachable</div>
    <p style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.8, margin: "0 auto 1.25rem", maxWidth: "420px" }}>
      {detail} Check that the FastAPI backend is running on port 8000, then retry.
    </p>
    {onRetry && (
      <button onClick={onRetry} className="btn-ghost" style={{
        background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "var(--text)",
        padding: "0.5rem 1.25rem", fontSize: "0.68rem", fontWeight: "700", letterSpacing: "0.12em",
        textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--mono)",
      }}>↺ Retry</button>
    )}
  </div>
);

// Backend cold-start state, styled after the header's SYS STATUS readout but
// in amber (calm/expected, not the red alarm of a true failure). Shown while
// the free-tier instance is spinning up.
export const WakingPanel = () => (
  <div style={{ ...card, borderColor: "rgba(255,176,32,0.35)", padding: "3rem 2rem", textAlign: "center" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--amber)", animation: "pulse 1.2s infinite" }} />
      <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", fontWeight: "700", color: "var(--amber)", letterSpacing: "0.2em" }}>SYS STATUS · WAKING</span>
    </div>
    <div style={{ fontSize: "1rem", fontWeight: "900", fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>Waking model server</div>
    <p style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.8, margin: "0 auto 1.5rem", maxWidth: "440px" }}>
      Free-tier instance is spinning up — this takes about 30–50 seconds on first visit. Predictions will load automatically.
    </p>
    <div className="loading-bar amber" style={{ maxWidth: "440px", margin: "0 auto" }} />
  </div>
);

// Single entry point for the "data couldn't load" state on a page. Reads the
// shared backend health: shows WAKING (with auto-retry, no button) while the
// instance is spinning up, and only falls back to the red OFFLINE panel (with
// a manual retry button) once the backend is genuinely unreachable.
// onRetry should re-run the page's failed request; it's auto-invoked every 5s
// while waking and once the moment the backend reports ready.
export const BackendPanel = ({ onRetry, detail }) => {
  const { status } = useHealth();
  const cbRef = useRef(onRetry);
  cbRef.current = onRetry;
  const prevStatus = useRef(status);

  // Auto-retry the failed request every 5s while not offline. Kept on a ref so
  // a page re-render (which hands us a fresh onRetry closure) doesn't reset the
  // interval; it only re-arms when the health status itself changes.
  useEffect(() => {
    if (status === "offline") return;
    const id = setInterval(() => cbRef.current?.(), 5000);
    return () => clearInterval(id);
  }, [status]);

  // Retry once when the backend TRANSITIONS into online (e.g. warmup just
  // finished), so data appears without waiting out the 5s tick. Guarding on the
  // transition — not merely "status === online" — is essential: onRetry usually
  // clears the page's failed flag, which unmounts+remounts this panel, so firing
  // on every mount-while-online would spin a tight retry loop whenever a single
  // data endpoint returns 503 while the health check itself is healthy. In that
  // case we simply let the 5s interval poll instead.
  useEffect(() => {
    if (prevStatus.current !== "online" && status === "online") cbRef.current?.();
    prevStatus.current = status;
  }, [status]);

  if (status === "offline") return <OfflinePanel detail={detail} onRetry={onRetry} />;
  return <WakingPanel />;
};

// Glass-card placeholder rows shown while driver lists load. Mirrors the
// real row layout (position chip, name + sub-line, right-aligned metrics).
export const SkeletonList = ({ rows = 8, metrics = 2 }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="stagger-item" style={{
        ...card, "--i": i, padding: "16px", display: "flex", alignItems: "center", gap: "1rem",
        borderLeft: "3px solid var(--dimmed)",
      }}>
        <div className="skeleton-block" style={{ width: "22px", height: "12px", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skeleton-block" style={{ width: "40%", maxWidth: "180px", height: "12px", marginBottom: "7px" }} />
          <div className="skeleton-block" style={{ width: "25%", maxWidth: "110px", height: "8px" }} />
        </div>
        {Array.from({ length: metrics }, (_, m) => (
          <div key={m} className="skeleton-block" style={{ width: "56px", height: "12px", flexShrink: 0 }} />
        ))}
      </div>
    ))}
  </div>
);

export const Spinner = ({ text = "COMPUTING..." }) => (
  <div style={{ textAlign: "center", padding: "4rem 0" }}>
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", color: "var(--red)", fontSize: "1.2rem", lineHeight: 1, animation: "pulse 1s ease-in-out infinite" }}>●</span>
    <p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.75rem", letterSpacing: "0.15em", fontWeight: "700", marginTop: "0.75rem" }}>{text}</p>
  </div>
);

// Value swaps tween (fade + slight rise/fall) whenever `value` changes —
// e.g. switching races on the Predictor. `initial={false}` keeps first
// mount driven by the CSS .stat-card entrance instead of double-animating.
export const StatCard = ({ label, value, sub, accent }) => (
  <div className="stat-card card-lift" style={{ ...card, padding: "1.25rem", flex: 1, minWidth: "130px" }}>
    <div className="section-label" style={{ marginBottom: "0.6rem" }}>{label}</div>
    <div className="telemetry" style={{ color: accent || "var(--text)", overflow: "hidden" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ display: "inline-block" }}
        >{value}</motion.span>
      </AnimatePresence>
    </div>
    {sub && <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--muted)", marginTop: "6px", fontWeight: "500" }}>{sub}</div>}
  </div>
);

export const Pill = ({ children, active, onClick }) => (
  <button onClick={onClick} className={`pill-tab${active ? " pill-active" : ""}`} style={{
    padding: "0.4rem 1rem", border: "none", cursor: "pointer",
    fontSize: "0.7rem", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase",
    background: active ? "var(--red)" : "transparent",
    color: active ? "#fff" : "var(--muted)",
    borderBottom: active ? "2px solid var(--red)" : "2px solid transparent",
    fontFamily: "var(--sans)",
  }}>{children}</button>
);

export const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...card, padding: "0.75rem 1rem", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", borderColor: "var(--border-red)" }}>
      <p style={{ fontFamily: "var(--mono)", color: "var(--text)", fontWeight: "700", margin: "0 0 4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{d.driver_name || d.driver || d.name || d.circuit}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontFamily: "var(--mono)", color: p.color || "var(--red)", margin: "2px 0", fontSize: "0.78rem", fontWeight: "700" }}>
          {p.name}: {typeof p.value === "number" && p.value <= 1 ? `${(p.value * 100).toFixed(1)}%` : p.value}
        </p>
      ))}
    </div>
  );
};

export const SectionHeader = ({ eyebrow, title, right }) => (
  <div className="accent-strip scanline-overlay" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "24px" }}>
    <div>
      {eyebrow && <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", fontWeight: "700", letterSpacing: "0.25em", opacity: 0.75, marginBottom: "0.2rem" }}>{eyebrow}</div>}
      <div style={{ fontSize: "1.15rem", fontWeight: "900", fontStyle: "italic", letterSpacing: "0.04em" }}>{title}</div>
    </div>
    {right}
  </div>
);


// ── RACE SELECTOR (custom searchable dropdown) ─────────────────
const CHEVRON_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23e10600' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

// Shared dropdown panel used by RaceSelector/DriverSelector, rendered via a
// portal straight into <body>. Every earlier attempt at this kept the panel
// as a normal DOM child of the trigger button's wrapper and just tuned its
// background/z-index - but that wrapper still lives inside cards that use
// backdrop-filter, and once real page content (prediction cards, driver
// rows) exists below/around it as a *sibling*, no z-index value on a
// descendant can reliably out-rank how the browser composites overlapping
// backdrop-filter layers within that ancestor tree. Rendering into body
// removes the panel from that tree entirely, so it paints as a fully
// separate, opaque layer above literally everything on the page regardless
// of what else is stacked or scrolled - same fix for both desktop and mobile.
const DropdownPanel = ({ anchorRef, panelRef, open, children }) => {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 12;
      // Anchors aren't always near the top of the viewport - on a long page
      // the panel can open with very little room left below it. Cap height
      // to whatever space is actually there instead of a fixed px value that
      // assumes the anchor is high up, or the tail of the list (eg. the
      // Completed section) ends up rendered past the bottom of the fixed
      // viewport where no page scroll can ever reach it. If there isn't even
      // enough room for a usable list below, flip and open upward instead.
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const isMobile = window.innerWidth <= 768;
      const viewportCap = window.innerHeight * (isMobile ? 0.6 : 0.5);
      const maxHeight = Math.min(openUp ? spaceAbove : spaceBelow, viewportCap);
      setRect({
        top: openUp ? undefined : r.bottom + 6,
        bottom: openUp ? window.innerHeight - r.top + 6 : undefined,
        left: r.left, width: r.width, maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return createPortal(
    <>
      {/* Dims the rest of the page while open. Without this, any full-bleed
          element that happens to fall at the same height as the panel (eg.
          the accent-strip results banner, which is unpadded and slightly
          wider than the panel since the panel matches the padded trigger
          button's width) pokes out past the panel's edge and reads as the
          panel itself being see-through. */}
      <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(5,5,10,0.88)" }} />
      <div
        ref={panelRef}
        className="dropdown-panel"
        style={{
          position: "fixed",
          top: rect.top !== undefined ? `${rect.top}px` : undefined,
          bottom: rect.bottom !== undefined ? `${rect.bottom}px` : undefined,
          left: `${rect.left}px`, width: `${rect.width}px`,
          maxHeight: `${rect.maxHeight}px`, display: "flex", flexDirection: "column",
          zIndex: 1000, background: "rgba(15,15,15,0.98)",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)", overflow: "hidden",
        }}
      >
        {children}
      </div>
    </>,
    document.body
  );
};

export const RaceSelector = ({ upcoming, completed, value, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const itemRefs = useRef({});

  const allOptions = useMemo(() => ([
    ...upcoming.map(r => ({ id: String(r.raceId), label: `2026 Rd ${r.round} — ${r.name} (${r.date})`, group: "upcoming" })),
    ...completed.map(r => ({ id: String(r.raceId), label: `${r.year} — ${r.name_race}`, group: "completed" })),
  ]), [upcoming, completed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allOptions.filter(o => o.label.toLowerCase().includes(q)) : allOptions;
  }, [allOptions, query]);

  const upcomingFiltered = filtered.filter(o => o.group === "upcoming");
  const completedFiltered = filtered.filter(o => o.group === "completed");
  const selectedOption = allOptions.find(o => o.id === value);

  const closePanel = () => { setOpen(false); setQuery(""); setActiveIndex(-1); };

  useEffect(() => {
    if (!open) return;
    // The panel is portaled into <body>, so it's no longer a DOM descendant
    // of wrapRef - it needs its own ref checked here too, or every click
    // inside the (now-detached) panel would register as "outside" and
    // close it before the onClick on an option even fires.
    const onClickOutside = e => {
      const insideWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const insidePanel = panelRef.current && panelRef.current.contains(e.target);
      if (!insideWrap && !insidePanel) closePanel();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);


  const choose = opt => { onSelect(opt.id, opt.label); closePanel(); };

  const moveActive = dir => {
    setActiveIndex(i => {
      const next = Math.max(0, Math.min(i + dir, filtered.length - 1));
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const handleSearchKeyDown = e => {
    if (e.key === "Escape") { e.preventDefault(); closePanel(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0 && filtered[activeIndex]) choose(filtered[activeIndex]); }
  };

  const handleControlKeyDown = e => {
    if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); }
    else if (e.key === "Escape") { closePanel(); }
  };

  let flatIndex = -1;
  const renderOption = opt => {
    flatIndex += 1;
    const idx = flatIndex;
    const isSelected = opt.id === value;
    const isActive = idx === activeIndex;
    return (
      <div
        key={opt.id}
        ref={el => { itemRefs.current[idx] = el; }}
        onMouseDown={e => e.preventDefault()}
        onClick={() => choose(opt)}
        onMouseEnter={() => setActiveIndex(idx)}
        className="dropdown-option"
        role="option"
        aria-selected={isSelected}
        style={{
          padding: "10px 16px", cursor: "pointer", fontFamily: "var(--mono)", fontSize: "0.78rem",
          borderLeft: "2px solid transparent",
          background: isActive ? "rgba(255,255,255,0.08)" : isSelected ? "rgba(225,6,0,0.15)" : "transparent",
          color: isSelected ? "var(--red)" : "var(--text)",
        }}
      >{opt.label}</div>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", isolation: "isolate" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleControlKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select Grand Prix"
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${open ? "var(--red)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: "10px", padding: "14px 16px", color: "var(--text)",
          fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: "600",
          cursor: "pointer", textAlign: "left", transition: "all 0.15s ease",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedOption ? "var(--text)" : "var(--muted)" }}>
          {selectedOption ? selectedOption.label : "Choose a race..."}
        </span>
        <span style={{
          display: "inline-block", marginLeft: "12px", flexShrink: 0, width: "10px", height: "10px",
          transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease",
          backgroundImage: CHEVRON_SVG, backgroundRepeat: "no-repeat", backgroundSize: "contain",
        }} />
      </button>

      <DropdownPanel anchorRef={wrapRef} panelRef={panelRef} open={open}>
          <input
            ref={el => el?.focus()}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(-1); }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search races..."
            style={{
              width: "100%", display: "block", background: "rgba(255,255,255,0.06)", border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.08)", borderRadius: 0,
              padding: "12px 16px", color: "var(--text)", fontFamily: "var(--mono)",
              fontSize: "0.8rem", outline: "none",
            }}
          />
          <div className="dropdown-list" role="listbox">
            {upcomingFiltered.length > 0 && (
              <>
                <div style={{ padding: "8px 16px 4px", fontFamily: "var(--mono)", fontSize: "0.6rem", fontWeight: "700", letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--red)" }}>2026 Upcoming</div>
                {upcomingFiltered.map(renderOption)}
              </>
            )}
            {completedFiltered.length > 0 && (
              <>
                <div style={{ padding: "8px 16px 4px", fontFamily: "var(--mono)", fontSize: "0.6rem", fontWeight: "700", letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--muted)", opacity: 0.7 }}>Completed</div>
                {completedFiltered.map(renderOption)}
              </>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: "16px", fontFamily: "var(--mono)", fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>No races found</div>
            )}
          </div>
      </DropdownPanel>
    </div>
  );
};

// ── DRIVER SELECTOR (custom searchable dropdown, flat list) ────
export const DriverSelector = ({ drivers, value, onSelect, placeholder = "Select..." }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const itemRefs = useRef({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? drivers.filter(d => d.driver_name.toLowerCase().includes(q)) : drivers;
  }, [drivers, query]);

  const selectedDriver = drivers.find(d => d.driverRef === value);

  const closePanel = () => { setOpen(false); setQuery(""); setActiveIndex(-1); };

  useEffect(() => {
    if (!open) return;
    // The panel is portaled into <body>, so it's no longer a DOM descendant
    // of wrapRef - it needs its own ref checked here too, or every click
    // inside the (now-detached) panel would register as "outside" and
    // close it before the onClick on an option even fires.
    const onClickOutside = e => {
      const insideWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const insidePanel = panelRef.current && panelRef.current.contains(e.target);
      if (!insideWrap && !insidePanel) closePanel();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);


  const choose = d => { onSelect(d.driverRef); closePanel(); };

  const moveActive = dir => {
    setActiveIndex(i => {
      const next = Math.max(0, Math.min(i + dir, filtered.length - 1));
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const handleSearchKeyDown = e => {
    if (e.key === "Escape") { e.preventDefault(); closePanel(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0 && filtered[activeIndex]) choose(filtered[activeIndex]); }
  };

  const handleControlKeyDown = e => {
    if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); }
    else if (e.key === "Escape") { closePanel(); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", isolation: "isolate" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleControlKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select driver"
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${open ? "var(--red)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: "10px", padding: "14px 16px", color: "var(--text)",
          fontFamily: "var(--mono)", fontSize: "0.85rem", fontWeight: "600",
          cursor: "pointer", textAlign: "left", transition: "all 0.15s ease",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedDriver ? "var(--text)" : "var(--muted)" }}>
          {selectedDriver ? selectedDriver.driver_name : placeholder}
        </span>
        <span style={{
          display: "inline-block", marginLeft: "12px", flexShrink: 0, width: "10px", height: "10px",
          transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease",
          backgroundImage: CHEVRON_SVG, backgroundRepeat: "no-repeat", backgroundSize: "contain",
        }} />
      </button>

      <DropdownPanel anchorRef={wrapRef} panelRef={panelRef} open={open}>
          <input
            ref={el => el?.focus()}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(-1); }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search drivers..."
            style={{
              width: "100%", display: "block", background: "rgba(255,255,255,0.06)", border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.08)", borderRadius: 0,
              padding: "12px 16px", color: "var(--text)", fontFamily: "var(--mono)",
              fontSize: "0.8rem", outline: "none",
            }}
          />
          <div className="dropdown-list" role="listbox">
            {filtered.map((d, idx) => {
              const isSelected = d.driverRef === value;
              const isActive = idx === activeIndex;
              return (
                <div
                  key={d.driverRef}
                  ref={el => { itemRefs.current[idx] = el; }}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(d)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className="dropdown-option"
                  role="option"
                  aria-selected={isSelected}
                  style={{
                    padding: "10px 16px", cursor: "pointer", fontFamily: "var(--mono)", fontSize: "0.78rem",
                    borderLeft: "2px solid transparent",
                    background: isActive ? "rgba(255,255,255,0.08)" : isSelected ? "rgba(225,6,0,0.15)" : "transparent",
                    color: isSelected ? "var(--red)" : "var(--text)",
                  }}
                >{d.driver_name}</div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "16px", fontFamily: "var(--mono)", fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>No drivers found</div>
            )}
          </div>
      </DropdownPanel>
    </div>
  );
};

