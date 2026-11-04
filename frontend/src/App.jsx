import { useState, lazy, Suspense } from "react";
import { MotionConfig } from "framer-motion";
import { NEXT_RACE } from "./constants.js";

// Nav label and page key for the next-race tab: the flag follows NEXT_RACE.
const NEXT_RACE_TAB = `Next Race ${NEXT_RACE.flag}`;
import { HealthProvider, useHealth } from "./health.jsx";
import { AuthProvider } from "./auth.jsx";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const PredictorPage = lazy(() => import("./pages/PredictorPage.jsx"));
const NextRacePage = lazy(() => import("./pages/NextRacePage.jsx"));
const WhatIfPage = lazy(() => import("./pages/WhatIfPage.jsx"));
const ChampionshipPage = lazy(() => import("./pages/ChampionshipPage.jsx"));
const DriversPage = lazy(() => import("./pages/DriversPage.jsx"));
const ComparePage = lazy(() => import("./pages/ComparePage.jsx"));
const Season2026Page = lazy(() => import("./pages/Season2026Page.jsx"));
const MyPicksPage = lazy(() => import("./pages/MyPicksPage.jsx"));
const ModelPage = lazy(() => import("./pages/ModelPage.jsx"));

// Suspense fallback while a lazy page chunk downloads — styled like the
// existing loading treatments (thin sweep bar + telemetry label).
const PageLoader = () => (
  <div>
    <div className="loading-bar" />
    <p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.7rem", letterSpacing: "0.2em", fontWeight: "700", textAlign: "center", padding: "3rem 0" }}>LOADING MODULE...</p>
  </div>
);

// Live backend health readout for the header. Reads the shared health context
// (single poller in HealthProvider) so it, and every data page, agree on the
// same three states — including the cold-start WAKING state.
const HEALTH_UI = {
  online:  { color: "var(--green)", label: "ONLINE" },
  waking:  { color: "var(--amber)", label: "WAKING" },
  offline: { color: "var(--red)",   label: "OFFLINE" },
};
const HealthIndicator = () => {
  const { status } = useHealth();
  const ui = HEALTH_UI[status] || HEALTH_UI.offline;
  // Waking pulses a touch faster to read as "actively working".
  const pulse = status === "waking" ? "pulse 1.2s infinite" : "pulse 2s infinite";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: ui.color, animation: pulse }} />
      <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: ui.color, fontWeight: "700", letterSpacing: "0.1em" }}>
        {ui.label}
      </span>
    </div>
  );
};

// ── NAV ────────────────────────────────────────────────────────
const Nav = ({ page, setPage, onNavigate }) => {
  const links = ["Home", "Predictor", NEXT_RACE_TAB, "What-If 🎮", "My Picks 🎯", "Championship", "Drivers", "Compare", "2026 Season", "Model"];
  // Stickiness lives on the shared .chrome-sticky wrapper in App() below, so the
  // nav pins directly under the topbar without either needing to hardcode the
  // other's height. This element only owns the frosted fill.
  return (
    <nav className="nav-glass">
      <div className="nav-scroll" style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 2rem", display: "flex", overflowX: "auto" }}>
        {links.map(l => (
          <button key={l} onClick={() => { setPage(l); onNavigate(); }} className="nav-tab" style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0.95rem 1rem", fontSize: "0.68rem", fontWeight: "500",
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: page === l ? "var(--text)" : "var(--muted)",
            borderBottom: page === l ? "2px solid var(--red)" : "2px solid transparent",
            whiteSpace: "nowrap", fontFamily: "var(--mono)",
          }}>{l}</button>
        ))}
      </div>
    </nav>
  );
};

// ── ROOT ───────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("Home");
  const [pageKey, setPageKey] = useState(0);
  const [showSweep, setShowSweep] = useState(false);

  const handleNavigate = () => {
    setPageKey(k => k + 1);
    setShowSweep(true);
    setTimeout(() => setShowSweep(false), 500);
  };

  const pages = {
    "Home": <HomePage />,
    "Predictor": <PredictorPage />,
    [NEXT_RACE_TAB]: <NextRacePage />,
    "What-If 🎮": <WhatIfPage />,
    "My Picks 🎯": <MyPicksPage />,
    "Championship": <ChampionshipPage />,
    "Drivers": <DriversPage />,
    "Compare": <ComparePage />,
    "2026 Season": <Season2026Page />,
    "Model": <ModelPage />,
  };

  return (
    <HealthProvider>
    <AuthProvider>
    <MotionConfig reducedMotion="user">
    {/* Transparent: the void, the ambient red glow, the grain/scanline/vignette
        layers all live on body/#root, and every surface above them is glass. */}
    <div style={{ minHeight: "100vh", color: "var(--text)", fontFamily: "var(--sans)" }}>
      {/* Topbar + nav pin together as one frosted block. */}
      <div className="chrome-sticky">
        <div style={{ height: "3px", background: "rgba(225,6,0,0.35)" }} />

        <header className="scanline-overlay topbar-glass">
          <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0.85rem 2rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <img src="/f1-logo.png" alt="F1" style={{ height: "30px", width: "auto" }} />
              <div>
                <div className="hud-title" style={{ fontSize: "1rem", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1, marginRight: "124px" }}>Race Predictor</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.55rem", color: "var(--muted)", fontWeight: "400", letterSpacing: "0.12em", marginTop: "4px" }}>3-MODEL PIPELINE · XGBOOST · jaimecodes</div>
              </div>
            </div>
            <div className="header-right" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--muted)", letterSpacing: "0.15em" }}>SYS STATUS</div>
              <HealthIndicator />
            </div>
          </div>
        </header>

        <Nav page={page} setPage={setPage} onNavigate={handleNavigate} />
      </div>

      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "1.5rem 2rem 4rem", position: "relative" }}>
        {showSweep && <div className="sweep-line" />}
        <div key={pageKey} className="page-enter">
          <Suspense fallback={<PageLoader />}>
            {pages[page]}
          </Suspense>
        </div>
      </main>
    </div>
    </MotionConfig>
    </AuthProvider>
    </HealthProvider>
  );
}
