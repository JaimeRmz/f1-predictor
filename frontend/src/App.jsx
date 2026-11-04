import { useState, lazy, Suspense } from "react";
import { MotionConfig } from "framer-motion";
import { HealthProvider } from "./health.jsx";
import SiteHeader from "./components/SiteHeader.jsx";
import { PAGES, SUB_LABEL, sectionOf } from "./navModel.js";
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
const LivePage = lazy(() => import("./pages/LivePage.jsx"));
const ModelPage = lazy(() => import("./pages/ModelPage.jsx"));

// Suspense fallback while a lazy page chunk downloads — styled like the
// existing loading treatments (thin sweep bar + telemetry label).
const PageLoader = () => (
  <div>
    <div className="loading-bar" />
    <p style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: "0.7rem", letterSpacing: "0.2em", fontWeight: "700", textAlign: "center", padding: "3rem 0" }}>LOADING MODULE...</p>
  </div>
);

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
    [PAGES.home]: <HomePage />,
    [PAGES.predictor]: <PredictorPage />,
    [PAGES.race]: <NextRacePage />,
    [PAGES.whatif]: <WhatIfPage />,
    [PAGES.picks]: <MyPicksPage />, // kept, but no longer linked from the nav
    [PAGES.champ]: <ChampionshipPage />,
    [PAGES.drivers]: <DriversPage />,
    [PAGES.compare]: <ComparePage />,
    [PAGES.season]: <Season2026Page />,
    [PAGES.live]: <LivePage />,
    [PAGES.model]: <ModelPage />,
  };
  const sec = sectionOf(page);

  return (
    <HealthProvider>
    <AuthProvider>
    <MotionConfig reducedMotion="user">
    {/* Transparent: the void, the ambient red glow, the grain/scanline/vignette
        layers all live on body/#root, and every surface above them is glass. */}
    <div style={{ minHeight: "100vh", color: "var(--text)", fontFamily: "var(--sans)" }}>
      <SiteHeader page={page} setPage={setPage} onNavigate={handleNavigate} />

      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "1.5rem 2rem 4rem", position: "relative" }}>
        {showSweep && <div className="sweep-line" />}
        {sec && sec.pages.length > 1 && (
          <div className={`sub-nav${page === PAGES.race ? " wide" : ""}`} role="group" aria-label={`${sec.label} pages`}>
            {sec.pages.map(pg => (
              <button key={pg} type="button" className="sub-tab" aria-pressed={pg === page} onClick={() => { setPage(pg); handleNavigate(); }}>{SUB_LABEL[pg]}</button>
            ))}
          </div>
        )}
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
