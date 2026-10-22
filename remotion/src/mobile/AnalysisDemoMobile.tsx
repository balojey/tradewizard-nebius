import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, fontSans, palette, themeCss, type Theme } from "../theme";
import { STAGES, TL } from "../timeline";
import { CheckIcon, SparkleIcon } from "../components/Logo";
import {
  AppBar,
  Chip,
  CountUp,
  ProgressBar,
  StatusBar,
  TouchTap,
  mobileCard,
} from "./ui";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function MarketCard() {
  return (
    <div style={{ ...mobileCard, padding: "22px 24px", height: 162 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: fontSans, fontSize: 22, color: palette.muted }}>
          Market probability
        </span>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)" fontSize={18}>
          YES
        </Chip>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
        <span
          style={{
            fontFamily: fontSans,
            fontSize: 62,
            fontWeight: 700,
            letterSpacing: "-0.045em",
            color: palette.fg,
            lineHeight: 1,
          }}
        >
          62¢
        </span>
        <span style={{ fontFamily: fontMono, fontSize: 22, color: palette.muted }}>38¢ NO</span>
      </div>
      <div style={{ marginTop: 14, display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: palette.surface2 }}>
        <div style={{ width: "62%", background: `linear-gradient(90deg, ${palette.accent}, ${palette.yes})` }} />
        <div style={{ width: "38%", background: "var(--tw-no-soft)" }} />
      </div>
    </div>
  );
}

function EmptyAnalysis() {
  return (
    <div style={{ ...mobileCard, height: 520, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          height: 72,
          flexShrink: 0,
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 26px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SparkleIcon size={22} />
          <span style={{ fontFamily: fontSans, fontSize: 27, fontWeight: 700 }}>AI Analysis</span>
        </div>
        <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.1)" border="oklch(62% 0.18 295 / 0.28)" fontSize={17}>
          14 agents
        </Chip>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 40px 20px",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 22,
            background: "oklch(62% 0.18 295 / 0.11)",
            border: "1px solid oklch(62% 0.18 295 / 0.24)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 18,
          }}
        >
          <SparkleIcon size={38} />
        </div>
        <span style={{ fontFamily: fontSans, fontSize: 31, fontWeight: 700, textAlign: "center" }}>
          No analysis yet
        </span>
        <span
          style={{
            fontFamily: fontSans,
            fontSize: 22,
            color: palette.muted,
            lineHeight: 1.45,
            textAlign: "center",
            marginTop: 8,
            maxWidth: 600,
          }}
        >
          Send all 14 agents after this market. You get a probability, a confidence band, and a trade plan.
        </span>
        <div
          style={{
            marginTop: 24,
            height: 66,
            padding: "0 36px",
            borderRadius: 14,
            background: `linear-gradient(180deg, ${palette.accent}, ${palette.accentDeep})`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: palette.white,
            fontFamily: fontSans,
            fontSize: 27,
            fontWeight: 600,
            boxShadow: "0 16px 40px -18px oklch(62% 0.2 260 / 0.8)",
          }}
        >
          <SparkleIcon size={24} color={palette.white} />
          Get Analysis
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 19, color: palette.muted, marginTop: 14 }}>
          1 credit · about 52 seconds
        </span>
      </div>
    </div>
  );
}

function VerdictAnalysis({ frame }: { frame: number }) {
  const appear = spring({
    frame: frame - TL.verdictStart,
    fps: 30,
    config: { damping: 22, stiffness: 130 },
  });
  const price = interpolate(frame, [TL.verdictStart + 6, TL.verdictStart + 34], [0, 71], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        ...mobileCard,
        height: 520,
        overflow: "hidden",
        opacity: appear,
        transform: `translateY(${(1 - appear) * 14}px)`,
      }}
    >
      <div
        style={{
          height: 72,
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "linear-gradient(90deg, oklch(62% 0.18 295 / 0.08), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SparkleIcon size={22} />
          <span style={{ fontFamily: fontSans, fontSize: 27, fontWeight: 700 }}>AI Analysis</span>
        </div>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)" fontSize={17}>
          complete · 52s
        </Chip>
      </div>

      <div style={{ padding: "20px 24px 22px", display: "flex", flexDirection: "column", height: 448 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              background: "oklch(72% 0.16 155 / 0.14)",
              border: "1px solid oklch(72% 0.16 155 / 0.38)",
              color: palette.yes,
              fontFamily: fontSans,
              fontSize: 25,
              fontWeight: 700,
            }}
          >
            LONG YES
          </span>
          <Chip color={palette.muted} fontSize={17}>
            high conviction
          </Chip>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 8 }}>
          <div>
            <span
              style={{
                fontFamily: fontMono,
                fontSize: 66,
                fontWeight: 700,
                letterSpacing: "-0.05em",
                lineHeight: 1,
                color: palette.fg,
              }}
            >
              {Math.round(price)}%
            </span>
            <div style={{ fontFamily: fontSans, fontSize: 19, color: palette.muted, marginTop: 4 }}>
              AI probability · band 66–76%
            </div>
          </div>
          <div style={{ display: "flex", gap: 22, paddingBottom: 4 }}>
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 17, color: palette.muted }}>Market</div>
              <div style={{ fontFamily: fontMono, fontSize: 28, fontWeight: 600 }}>62¢</div>
            </div>
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 17, color: palette.muted }}>Edge</div>
              <div style={{ fontFamily: fontMono, fontSize: 28, fontWeight: 600, color: palette.yes }}>+9¢</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ position: "relative", height: 22 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 10, borderRadius: 999, background: palette.surface2, overflow: "hidden" }}>
              <div style={{ width: "71%", height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${palette.accent}, ${palette.yes})` }} />
            </div>
            <div style={{ position: "absolute", left: "62%", top: 2, width: 3, height: 18, marginLeft: -1.5, background: palette.fg, opacity: 0.75 }} />
            <div style={{ position: "absolute", left: "71%", top: 2, width: 16, height: 16, marginLeft: -8, borderRadius: 999, background: palette.yes, border: `3px solid ${palette.bg}` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: fontMono, fontSize: 16, color: palette.muted }}>
            <span>0%</span>
            <span>Market 62¢</span>
            <span style={{ color: palette.yes }}>AI 71%</span>
            <span>100%</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          {[
            ["Entry zone", "60–64¢"],
            ["Stop", "54¢"],
            ["Target", "78¢"],
            ["Size", "4.5%"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.bg,
                padding: "9px 14px",
              }}
            >
              <div style={{ fontFamily: fontSans, fontSize: 16, color: palette.muted }}>{label}</div>
              <div style={{ fontFamily: fontMono, fontSize: 24, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 9, fontSize: 18, fontFamily: fontSans, color: palette.muted }}>
          <CheckIcon size={17} />
          12 / 14 agents aligned · labor market softening, CPI below target
        </div>
      </div>
    </div>
  );
}

function BottomSheet({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const open = spring({
    frame: frame - TL.modalOpen,
    fps,
    config: { damping: 24, stiffness: 160, mass: 0.9 },
  });
  const out = interpolate(frame, [TL.modalClose, TL.modalClose + 16], [1, 0], clamp);
  const showProgress = frame >= TL.clickRequest;
  const raw = interpolate(frame, [TL.progressStart, TL.progressEnd], [0, STAGES.length], clamp);
  const elapsed = interpolate(frame, [TL.progressStart, TL.progressEnd], [0, 52], clamp);

  if (frame < TL.modalOpen - 6) return null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `oklch(6% 0.01 260 / ${0.5 * Math.min(1, open) * out})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 820,
          borderRadius: "34px 34px 0 0",
          background: palette.surface,
          borderTop: `1px solid ${palette.borderStrong}`,
          boxShadow: "0 -30px 80px -30px oklch(0% 0 0 / 0.7)",
          transform: `translateY(${(1 - open) * 120 + (1 - out) * 60}px)`,
          opacity: Math.min(1, open) * out,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ height: 22, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ width: 90, height: 5, borderRadius: 999, background: palette.borderStrong, opacity: 0.7 }} />
        </div>

        <div style={{ padding: "0 30px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 31, fontWeight: 700 }}>
              {showProgress ? "Analyzing market" : "Get Analysis"}
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 18, color: palette.muted, marginTop: 2 }}>
              Fed Rate Cut · Polymarket
            </div>
          </div>
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              border: `1px solid ${palette.border}`,
              color: palette.muted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            ×
          </span>
        </div>

        <div style={{ padding: "0 30px", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {showProgress ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: fontSans, fontSize: 20, color: palette.muted }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: raw >= STAGES.length ? palette.yes : palette.ai }} />
                  {raw >= STAGES.length ? "Consensus reached" : "14 agents deployed"}
                </div>
                <span style={{ fontFamily: fontMono, fontSize: 18, color: palette.muted }}>
                  {raw >= STAGES.length ? "52s" : `${Math.round(elapsed)}s`}
                </span>
              </div>
              <ProgressBar value={(raw / STAGES.length) * 100} height={10} color={palette.accent} />
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                {STAGES.map((stage, index) => {
                  const done = raw >= index + 1;
                  const active = !done && raw >= index;
                  return (
                    <div
                      key={stage}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        height: 42,
                        padding: "0 10px",
                        borderRadius: 10,
                        background: active ? palette.surface2 : "transparent",
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: done ? "oklch(72% 0.16 155 / 0.14)" : active ? palette.accent : palette.surface2,
                          border: done || active ? "none" : `1px solid ${palette.border}`,
                          color: active ? palette.white : palette.muted,
                          fontFamily: fontMono,
                          fontSize: 13,
                        }}
                      >
                        {done ? <CheckIcon size={15} /> : String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        style={{
                          fontFamily: fontSans,
                          fontSize: 21,
                          color: active ? palette.fg : palette.muted,
                          textDecoration: done ? "line-through" : "none",
                          opacity: done ? 0.6 : 1,
                          flex: 1,
                        }}
                      >
                        {stage}
                      </span>
                      {active && (
                        <span style={{ fontFamily: fontMono, fontSize: 15, color: palette.accent }}>running</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 12,
                  borderTop: `1px solid ${palette.border}`,
                  fontFamily: fontSans,
                  fontSize: 20,
                  color: raw >= STAGES.length ? palette.yes : palette.muted,
                }}
              >
                {raw >= STAGES.length ? "Analysis complete - results ready." : "Working through the research pipeline…"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: palette.bg,
                  border: `1px solid ${palette.border}`,
                  fontFamily: fontSans,
                  fontSize: 21,
                }}
              >
                <span style={{ color: palette.muted }}>Credits remaining</span>
                <span style={{ fontFamily: fontMono, color: palette.fg }}>19</span>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 500, marginBottom: 9 }}>Request type</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 60,
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: palette.accent,
                      color: palette.white,
                      fontFamily: fontSans,
                      fontSize: 22,
                      fontWeight: 600,
                    }}
                  >
                    One-time
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 60,
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: palette.bg,
                      border: `1px solid ${palette.border}`,
                      color: palette.muted,
                      fontFamily: fontSans,
                      fontSize: 22,
                      fontWeight: 500,
                    }}
                  >
                    Recurring
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  padding: "18px 18px 16px",
                  borderRadius: 14,
                  border: "1px solid oklch(62% 0.18 295 / 0.28)",
                  background: "linear-gradient(135deg, oklch(62% 0.18 295 / 0.1), oklch(62% 0.2 260 / 0.05))",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                  <SparkleIcon size={20} />
                  <span style={{ fontFamily: fontSans, fontSize: 21, fontWeight: 600 }}>Full research pass</span>
                </div>
                {[
                  "14 specialist agents analyze every angle",
                  "Bull and bear cases cross-examined",
                  "Consensus probability, entry zones, sizing",
                ].map((line) => (
                  <div key={line} style={{ display: "flex", gap: 8, marginTop: 7, fontFamily: fontSans, fontSize: 18, color: palette.muted, lineHeight: 1.4 }}>
                    <CheckIcon size={14} color={palette.yes} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", fontFamily: fontMono, fontSize: 17, color: palette.muted }}>
                <span>Cost: 1 credit</span>
                <span>Est. 52 seconds</span>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  gap: 12,
                  paddingTop: 16,
                  borderTop: `1px solid ${palette.border}`,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 64,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: palette.bg,
                    border: `1px solid ${palette.border}`,
                    color: palette.muted,
                    fontFamily: fontSans,
                    fontSize: 22,
                    fontWeight: 500,
                  }}
                >
                  Cancel
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 64,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: "linear-gradient(180deg, oklch(62% 0.18 295), oklch(55% 0.2 275))",
                    color: palette.white,
                    fontFamily: fontSans,
                    fontSize: 22,
                    fontWeight: 600,
                  }}
                >
                  <SparkleIcon size={19} color={palette.white} />
                  Request Analysis
                </div>
              </div>
            </div>
          )}
        </div>
        <div style={{ height: 20, flexShrink: 0 }} />
      </div>
    </div>
  );
}

export function AnalysisDemoMobile({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], clamp);
  const exit = interpolate(frame, [402, 420], [1, 0], clamp);
  const verdict = frame >= TL.verdictStart;

  return (
    <AbsoluteFill
      className={`tw-theme-${theme}`}
      style={{ background: palette.bg, overflow: "hidden", fontFamily: fontSans, color: palette.fg }}
    >
      <style>{themeCss(theme)}</style>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--tw-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--tw-grid) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 90% 55% at 50% 0%, black 10%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 55% at 50% 0%, black 10%, transparent 78%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -260,
          width: 760,
          height: 440,
          transform: "translateX(-50%)",
          borderRadius: 999,
          background: "oklch(62% 0.2 260 / 0.14)",
          filter: "blur(90px)",
        }}
      />

      <div style={{ position: "absolute", inset: 0, opacity: enter * exit }}>
        <StatusBar />
        <AppBar credits="19 credits" />

        <div style={{ padding: "10px 32px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: fontSans, fontSize: 18, color: palette.muted }}>
            <span>Markets</span>
            <span style={{ opacity: 0.5 }}>›</span>
            <span>Economics</span>
            <span style={{ opacity: 0.5 }}>›</span>
            <span style={{ color: palette.fg }}>Fed Rate Cut</span>
          </div>

          <h1
            style={{
              margin: "12px 0 0",
              fontFamily: fontSans,
              fontSize: 43,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              fontWeight: 700,
            }}
          >
            Will the Fed cut rates before September 2026?
          </h1>

          <div style={{ marginTop: 18 }}>
            <MarketCard />
          </div>

          <div style={{ marginTop: 18 }}>
            {verdict ? <VerdictAnalysis frame={frame} /> : <EmptyAnalysis />}
          </div>
        </div>

        <BottomSheet frame={frame} />
        <TouchTap x={450} y={794} at={TL.clickGet} />
        <TouchTap x={664} y={1050} at={TL.clickRequest} />
      </div>

      <AbsoluteFill style={{ background: palette.bg, opacity: 1 - enter * exit, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
