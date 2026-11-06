import { GlassPanel } from "../components/GlassPanel.jsx";

// LIVE has no data source yet (no timing feed is connected), so this page says so instead of showing anything made up.
const LivePage = () => (
  <GlassPanel style={{ padding: "2.5rem 2rem", textAlign: "center", maxWidth: 640, margin: "2rem auto" }}>
    <div style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.2em", color: "var(--amber)" }}>● NO LIVE DATA</div>
    <h1 style={{ fontFamily: "var(--display)", fontSize: "1.6rem", fontWeight: 800, textTransform: "uppercase", margin: "0.7rem 0" }}>Live session view</h1>
    <p style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", lineHeight: 1.8, color: "rgba(236,236,236,0.7)" }}>
      No live timing feed is connected yet, so there is nothing real to show here. When one is, this page will show positions, race control messages and weather, each labelled LIVE, DELAYED or FINAL by how old the data is.
    </p>
  </GlassPanel>
);

export default LivePage;
