import { forwardRef } from "react";

// ── SHAREABLE PREDICTION CARD ────────────────────────────────────
// A fixed 1200×630 (social/OG ratio) card that html-to-image snapshots into a
// PNG. Built as a normal styled node — NOT drawn on a canvas — so it reuses the
// site's CSS variables (--red, --text, --muted, --border, mono/sans fonts) and
// matches the app's look. NextRacePage mounts it off-screen and captures it on
// "Share Prediction".
//
// Props:
//   race    { flagUrl, name, date, round }
//   picks   [{ driver_name, team, color, win_probability, podium_probability }] (3)
//   siteUrl string
//
// All values are already resolved by the caller (team overrides + colors), so
// this component stays purely presentational.

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

const Dot = ({ color, size = 12 }) => (
  <span style={{ width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
);

const SharePredictionCard = forwardRef(({ race, picks, siteUrl }, ref) => {
  const [p1, p2, p3] = picks;

  return (
    <div
      ref={ref}
      style={{
        width: "1200px", height: "630px", boxSizing: "border-box",
        background: "radial-gradient(1100px 620px at 82% -12%, rgba(225,6,0,0.20), transparent 58%), #080812",
        color: "var(--text)", fontFamily: "var(--sans)",
        position: "relative", overflow: "hidden",
        padding: "54px 64px", display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}
    >
      {/* Top accent strip */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "8px", background: "var(--red)" }} />

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          {race.flagUrl && (
            // Real image (not an emoji) so the flag renders identically on every
            // OS — Windows has no flag-emoji glyphs and would show bare letters.
            <img
              src={race.flagUrl}
              alt=""
              crossOrigin="anonymous"
              style={{ height: "48px", width: "auto", borderRadius: "5px", border: "1px solid var(--border)", display: "block", flexShrink: 0 }}
            />
          )}
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "15px", fontWeight: 700, letterSpacing: "0.22em", color: "var(--red)" }}>
              ROUND {race.round} · 2026 FIA F1 WORLD CHAMPIONSHIP
            </div>
            <div style={{ fontSize: "40px", fontWeight: 900, fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.05, marginTop: "6px", whiteSpace: "nowrap" }}>
              {race.name}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "17px", color: "var(--muted)", marginTop: "6px", letterSpacing: "0.04em" }}>
              {race.date}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", paddingTop: "4px" }}>
          <div style={{ display: "inline-block", border: "1px solid var(--border-red)", borderRadius: "6px", padding: "8px 14px", fontFamily: "var(--mono)", fontSize: "14px", fontWeight: 700, letterSpacing: "0.18em", color: "var(--red)" }}>
            MODEL PREDICTION
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "14px", fontWeight: 700, letterSpacing: "0.16em", color: "var(--gold)", marginTop: "10px" }}>
            PRE-QUALIFYING
          </div>
        </div>
      </div>

      {/* ── Headline P1 pick ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "40px",
        background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
        borderLeft: `7px solid ${p1.color}`, borderRadius: "16px", padding: "34px 40px",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: "16px", fontWeight: 700, letterSpacing: "0.2em", color: "var(--red)" }}>PROJECTED P1</div>
          <div style={{ fontSize: "82px", fontWeight: 900, fontStyle: "italic", textTransform: "uppercase", lineHeight: 0.98, marginTop: "8px", whiteSpace: "nowrap" }}>
            {p1.driver_name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
            <Dot color={p1.color} size={16} />
            <span style={{ fontFamily: "var(--mono)", fontSize: "24px", fontWeight: 700, color: p1.color, letterSpacing: "0.03em" }}>{p1.team}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "104px", fontWeight: 900, lineHeight: 0.9, color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{pct(p1.win_probability)}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "15px", fontWeight: 700, letterSpacing: "0.18em", color: "var(--muted)", marginTop: "8px" }}>WIN PROBABILITY</div>
        </div>
      </div>

      {/* ── P2 / P3 ── */}
      <div style={{ display: "flex", gap: "20px" }}>
        {[p2, p3].map((p, i) => (
          <div key={i} style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px",
            background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
            borderLeft: `5px solid ${p.color}`, borderRadius: "12px", padding: "22px 26px",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "14px", fontWeight: 700, letterSpacing: "0.18em", color: "var(--muted)" }}>P{i + 2}</div>
              <div style={{ fontSize: "34px", fontWeight: 800, fontStyle: "italic", textTransform: "uppercase", lineHeight: 1.02, marginTop: "4px", whiteSpace: "nowrap" }}>{p.driver_name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "9px" }}>
                <Dot color={p.color} size={11} />
                <span style={{ fontFamily: "var(--mono)", fontSize: "16px", fontWeight: 600, color: p.color }}>{p.team}</span>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "40px", fontWeight: 900, lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{pct(p.podium_probability)}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "12px", fontWeight: 700, letterSpacing: "0.16em", color: "var(--muted)", marginTop: "6px" }}>PODIUM</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "22px" }}>
        <div>
          <div style={{ fontSize: "26px", fontWeight: 900, fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.05em" }}>F1 Race Predictor</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "13px", color: "var(--muted)", letterSpacing: "0.1em", marginTop: "4px" }}>3-MODEL PIPELINE · XGBOOST · jaimecodes</div>
        </div>
        <div style={{ textAlign: "right", maxWidth: "560px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: "15px", color: "var(--muted)", lineHeight: 1.5 }}>
            Predicted before qualifying — see how it played out:
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "22px", fontWeight: 700, color: "var(--red)", letterSpacing: "0.03em", marginTop: "4px" }}>{siteUrl}</div>
        </div>
      </div>
    </div>
  );
});

SharePredictionCard.displayName = "SharePredictionCard";

export default SharePredictionCard;
