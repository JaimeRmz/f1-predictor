import { forwardRef } from "react";

// ── SHAREABLE PREDICTION CARD ────────────────────────────────────
// A fixed 1200×630 (social/OG ratio) card that html-to-image snapshots into a
// PNG. Built as a normal styled node — NOT drawn on a canvas — so it reuses the
// site's CSS variables and matches the app's look. The header (flag/race/date)
// and footer (wordmark/URL) are shared; the body has two variants:
//
//   solo (default)   NextRacePage — the model's podium prediction, headline P1.
//   comparison       MyPicksPage  — MY PICK vs MODEL PREDICTION, when `userPicks`
//                    is supplied.
//
// Props:
//   race       { flagUrl, name, date, round }
//   picks      model's [{ driver_name, team, color, win_probability, podium_probability }] (3)
//   userPicks  optional [{ driver_name, team, color }] (3) → renders comparison
//   siteUrl    string
//   tag        header badge text (default "MODEL PREDICTION")
//
// All values are already resolved by the caller (team overrides + colors).

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

const Dot = ({ color, size = 12 }) => (
  <span style={{ width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
);

const CardShell = forwardRef(({ children }, ref) => (
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
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "8px", background: "var(--red)" }} />
    {children}
  </div>
));
CardShell.displayName = "CardShell";

const CardHeader = ({ race, tag }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
      {race.flagUrl && (
        // Real image (not an emoji) so the flag renders identically on every OS —
        // Windows has no flag-emoji glyphs and would show bare letters.
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
        {tag}
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: "14px", fontWeight: 700, letterSpacing: "0.16em", color: "var(--gold)", marginTop: "10px" }}>
        PRE-QUALIFYING
      </div>
    </div>
  </div>
);

const CardFooter = ({ siteUrl }) => (
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
);

// ── Solo body: headline P1 + P2/P3 ──
const SoloBody = ({ picks }) => {
  const [p1, p2, p3] = picks;
  return (
    <>
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
    </>
  );
};

// ── Comparison body: MY PICK | MODEL PREDICTION ──
const PickRow = ({ pos, pick, value, valueLabel }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
    background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
    borderLeft: `5px solid ${pick.color}`, borderRadius: "10px", padding: "14px 18px",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: "15px", fontWeight: 700, color: pos === 1 ? "var(--red)" : "var(--muted)", width: "26px", flexShrink: 0 }}>P{pos}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "27px", fontWeight: 800, fontStyle: "italic", textTransform: "uppercase", lineHeight: 1.05, whiteSpace: "nowrap" }}>{pick.driver_name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
          <Dot color={pick.color} size={9} />
          <span style={{ fontFamily: "var(--mono)", fontSize: "13px", fontWeight: 600, color: pick.color }}>{pick.team}</span>
        </div>
      </div>
    </div>
    {value != null && (
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: "28px", fontWeight: 900, lineHeight: 1, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontFamily: "var(--mono)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.16em", color: "var(--muted)", marginTop: "4px" }}>{valueLabel}</div>
      </div>
    )}
  </div>
);

const ComparisonColumn = ({ title, accent, picks, showPct }) => (
  <div style={{
    flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px",
    background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px 22px",
  }}>
    <div style={{ fontFamily: "var(--mono)", fontSize: "15px", fontWeight: 700, letterSpacing: "0.2em", color: accent, textTransform: "uppercase" }}>{title}</div>
    {picks.map((p, i) => (
      <PickRow
        key={i}
        pos={i + 1}
        pick={p}
        value={showPct ? pct(i === 0 ? p.win_probability : p.podium_probability) : null}
        valueLabel={i === 0 ? "WIN" : "PODIUM"}
      />
    ))}
  </div>
);

const ComparisonBody = ({ picks, userPicks }) => (
  <div style={{ display: "flex", gap: "22px", flex: 1, alignItems: "stretch" }}>
    <ComparisonColumn title="My Pick" accent="var(--gold)" picks={userPicks} showPct={false} />
    <ComparisonColumn title="Model Prediction" accent="var(--red)" picks={picks} showPct={true} />
  </div>
);

const SharePredictionCard = forwardRef(({ race, picks, userPicks, siteUrl, tag }, ref) => {
  const comparison = Array.isArray(userPicks) && userPicks.length === 3;
  return (
    <CardShell ref={ref}>
      <CardHeader race={race} tag={tag || (comparison ? "ME vs MODEL" : "MODEL PREDICTION")} />
      {comparison ? <ComparisonBody picks={picks} userPicks={userPicks} /> : <SoloBody picks={picks} />}
      <CardFooter siteUrl={siteUrl} />
    </CardShell>
  );
});

SharePredictionCard.displayName = "SharePredictionCard";

export default SharePredictionCard;
