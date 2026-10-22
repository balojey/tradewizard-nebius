import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, fontSans, palette, shadow } from "../theme";
import { AGENTS, TL } from "../timeline";
import { ArrowIcon, CheckIcon, SparkleIcon } from "./Logo";
import { AppNav } from "./AppNav";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const card: React.CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 16,
};

function Chip({
  children,
  color = palette.muted,
  bg = palette.surface2,
  border = palette.border,
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontFamily: fontMono,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function MarketHeader() {
  return (
    <div
      style={{
        ...card,
        marginTop: 22,
        padding: "26px 30px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "stretch",
        gap: 34,
        background: `linear-gradient(100deg, var(--tw-surface-grad), ${palette.surface} 62%)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
            <Chip color={palette.warning} bg="oklch(78% 0.14 85 / 0.1)" border="oklch(78% 0.14 85 / 0.25)">
              Economics
            </Chip>
            <Chip>Fed</Chip>
            <Chip color={palette.accent} bg="oklch(62% 0.2 260 / 0.1)" border="oklch(62% 0.2 260 / 0.28)">
              Live
            </Chip>
          </div>
          <h1
            style={{
              fontFamily: fontSans,
              fontSize: 37,
              lineHeight: 1.12,
              letterSpacing: "-0.028em",
              fontWeight: 700,
              margin: 0,
              maxWidth: 760,
            }}
          >
            Will the Fed cut rates before September 2026?
          </h1>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            marginTop: 20,
            fontFamily: fontMono,
            fontSize: 12,
            color: palette.muted,
          }}
        >
          <span>$4.2M volume</span>
          <span style={{ width: 1, height: 14, background: palette.border }} />
          <span>$318K liquidity</span>
          <span style={{ width: 1, height: 14, background: palette.border }} />
          <span>Ends Sep 16, 2026</span>
          <span style={{ width: 1, height: 14, background: palette.border }} />
          <span style={{ color: palette.yes }}>+2.4% today</span>
        </div>
      </div>

      <div
        style={{
          width: 262,
          flexShrink: 0,
          borderRadius: 13,
          border: `1px solid ${palette.border}`,
          background: palette.bg,
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: fontSans, fontSize: 12, color: palette.muted }}>Market probability</span>
          <span style={{ fontFamily: fontMono, fontSize: 11, color: palette.yes }}>YES</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
          <span
            style={{
              fontFamily: fontSans,
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: palette.fg,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            62¢
          </span>
          <span style={{ fontFamily: fontMono, fontSize: 12, color: palette.muted }}>38¢ NO</span>
        </div>
        <div
          style={{
            height: 7,
            borderRadius: 999,
            background: palette.surface2,
            overflow: "hidden",
            marginTop: 12,
            display: "flex",
          }}
        >
          <div style={{ width: "62%", background: `linear-gradient(90deg, ${palette.accent}, ${palette.yes})` }} />
          <div style={{ width: "38%", background: "var(--tw-no-soft)" }} />
        </div>
      </div>
    </div>
  );
}

function TradePanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700 }}>Trade</span>
          <Chip color={palette.muted}>Polymarket</Chip>
        </div>

        <div
          style={{
            display: "flex",
            padding: 4,
            borderRadius: 10,
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "9px 0",
              borderRadius: 7,
              background: "oklch(72% 0.16 155 / 0.14)",
              border: "1px solid oklch(72% 0.16 155 / 0.3)",
              color: palette.yes,
              fontFamily: fontSans,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Buy YES 62¢
          </div>
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "9px 0",
              color: palette.muted,
              fontFamily: fontSans,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Buy NO 38¢
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderRadius: 10,
            border: `1px solid ${palette.border}`,
            background: palette.bg,
            padding: "13px 15px",
            marginBottom: 12,
          }}
        >
          <span style={{ fontFamily: fontSans, fontSize: 12, color: palette.muted }}>Amount</span>
          <span style={{ fontFamily: fontMono, fontSize: 18, fontWeight: 600, color: palette.fg }}>$250.00</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: fontMono,
            fontSize: 11,
            color: palette.muted,
            marginBottom: 18,
          }}
        >
          <span>≈ 403 shares</span>
          <span>Max payout $403</span>
        </div>

        <div
          style={{
            height: 48,
            borderRadius: 10,
            background: "linear-gradient(180deg, oklch(72% 0.16 155), oklch(62% 0.14 158))",
            color: "oklch(16% 0.02 160)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontSans,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: "0 10px 26px -12px oklch(72% 0.16 155 / 0.75)",
          }}
        >
          Buy YES
        </div>
      </div>

      <div style={{ ...card, padding: 22 }}>
        <div
          style={{
            fontFamily: fontSans,
            fontSize: 12,
            color: palette.muted,
            marginBottom: 14,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Market pulse</span>
          <span style={{ fontFamily: fontMono, color: palette.yes }}>+2.4%</span>
        </div>
        {[
          ["24h volume", "$412K"],
          ["Open interest", "$1.8M"],
          ["Last trade", "62¢ · 12s ago"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 0",
              borderTop: `1px solid ${palette.border}`,
              fontFamily: fontMono,
              fontSize: 12,
            }}
          >
            <span style={{ color: palette.muted }}>{label}</span>
            <span style={{ color: palette.fg }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyAnalysis({ frame, fps }: { frame: number; fps: number }) {
  const appear = spring({
    frame: frame - 10,
    fps,
    config: { damping: 200 },
  });
  return (
    <div style={{ ...card, height: 578, display: "flex", flexDirection: "column", opacity: appear }}>
      <div
        style={{
          height: 68,
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 26px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SparkleIcon size={17} />
          <span style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700 }}>AI Analysis</span>
        </div>
        <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.1)" border="oklch(62% 0.18 295 / 0.28)">
          14 agents ready
        </Chip>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: 18,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: "oklch(62% 0.18 295 / 0.11)",
            border: "1px solid oklch(62% 0.18 295 / 0.24)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <SparkleIcon size={30} />
        </div>
        <div style={{ fontFamily: fontSans, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          No analysis on this market yet
        </div>
        <div
          style={{
            fontFamily: fontSans,
            fontSize: 14,
            color: palette.muted,
            maxWidth: 420,
            textAlign: "center",
            lineHeight: 1.55,
            marginBottom: 26,
          }}
        >
          Deploy all 14 agents for a full research pass. You get a probability,
          confidence band, entry zones, and position sizing.
        </div>
        <div
          style={{
            height: 52,
            padding: "0 30px",
            borderRadius: 11,
            background: `linear-gradient(180deg, ${palette.accent}, ${palette.accentDeep})`,
            boxShadow: shadow.glow,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: palette.white,
            fontFamily: fontSans,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <SparkleIcon size={17} color={palette.white} />
          Get Analysis
        </div>
        <div style={{ fontFamily: fontMono, fontSize: 11, color: palette.muted, marginTop: 14 }}>
          1 credit · about 52 seconds
        </div>
      </div>
    </div>
  );
}

function VerdictPanel({ frame, fps }: { frame: number; fps: number }) {
  const appear = spring({
    frame: frame - TL.verdictStart,
    fps,
    config: { damping: 22, stiffness: 130, mass: 0.9 },
  });
  const count = interpolate(frame, [TL.verdictStart + 5, TL.verdictStart + 34], [0, 1], {
    ...clamp,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const aiProb = Math.round(71 * count);
  const edge = Math.round(9 * count);
  const stats = interpolate(frame, [TL.verdictStats, TL.verdictStats + 18], [0, 1], clamp);

  return (
    <div
      style={{
        ...card,
        height: 578,
        display: "flex",
        flexDirection: "column",
        opacity: appear,
        transform: `translateY(${interpolate(appear, [0, 1], [16, 0])}px)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 68,
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 26px",
          background: "linear-gradient(90deg, oklch(62% 0.18 295 / 0.07), transparent 55%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SparkleIcon size={17} />
          <span style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700 }}>AI Analysis</span>
          <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)">
            Complete in 52s
          </Chip>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 11, color: palette.muted }}>14 / 14 agents</span>
      </div>

      <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  padding: "8px 16px",
                  borderRadius: 9,
                  background: "oklch(72% 0.16 155 / 0.14)",
                  border: "1px solid oklch(72% 0.16 155 / 0.38)",
                  color: palette.yes,
                  fontFamily: fontSans,
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  transform: `scale(${interpolate(appear, [0, 1], [0.86, 1])})`,
                }}
              >
                LONG YES
              </div>
              <span
                style={{
                  fontFamily: fontMono,
                  fontSize: 11,
                  color: palette.muted,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                }}
              >
                high conviction
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <span
                style={{
                  fontFamily: fontSans,
                  fontSize: 62,
                  lineHeight: 1,
                  fontWeight: 700,
                  letterSpacing: "-0.045em",
                  color: palette.fg,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {aiProb}%
              </span>
              <div style={{ fontFamily: fontSans, fontSize: 13, color: palette.muted, lineHeight: 1.4 }}>
                <div>AI probability</div>
                <div style={{ fontFamily: fontMono, fontSize: 11 }}>band 66–76%</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, auto)",
              gap: "12px 30px",
              padding: "16px 20px",
              borderRadius: 12,
              background: palette.bg,
              border: `1px solid ${palette.border}`,
              opacity: stats,
            }}
          >
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 11, color: palette.muted }}>Market</div>
              <div style={{ fontFamily: fontMono, fontSize: 19, fontWeight: 600 }}>62¢</div>
            </div>
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 11, color: palette.muted }}>Edge</div>
              <div style={{ fontFamily: fontMono, fontSize: 19, fontWeight: 600, color: palette.yes }}>
                +{edge}¢
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 22, opacity: stats }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontFamily: fontSans, fontSize: 11, color: palette.muted }}>Agent alignment</span>
            <span style={{ fontFamily: fontMono, fontSize: 11, color: palette.fg }}>12 / 14</span>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {AGENTS.map((agent, i) => (
              <div
                key={agent}
                style={{
                  height: 5,
                  flex: 1,
                  borderRadius: 999,
                  background: i < 12 ? palette.yes : palette.surface2,
                  opacity: i < 12 ? 1 : 0.9,
                }}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            marginTop: 22,
            opacity: stats,
          }}
        >
          {[
            ["Entry zone", "60–64¢"],
            ["Stop", "54¢"],
            ["Target", "78¢"],
            ["Size", "4.5%"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                borderRadius: 11,
                border: `1px solid ${palette.border}`,
                background: palette.bg,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontFamily: fontSans, fontSize: 10, color: palette.muted, marginBottom: 5 }}>
                {label}
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 16, fontWeight: 600, color: palette.fg }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22, opacity: stats }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span style={{ fontFamily: fontSans, fontSize: 11, color: palette.muted }}>
              AI probability vs market price
            </span>
            <span style={{ fontFamily: fontMono, fontSize: 11, color: palette.yes }}>
              +{edge}¢ edge
            </span>
          </div>
          <div style={{ position: "relative", height: 20 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 6,
                height: 8,
                borderRadius: 999,
                background: palette.surface2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${62 + edge}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${palette.accent}, ${palette.yes})`,
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: "62%",
                top: 2,
                width: 2,
                height: 16,
                marginLeft: -1,
                borderRadius: 2,
                background: palette.fg,
                opacity: 0.75,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${62 + edge}%`,
                top: 2,
                width: 12,
                height: 12,
                marginLeft: -6,
                borderRadius: 999,
                background: palette.yes,
                border: `2px solid ${palette.bg}`,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
              fontFamily: fontMono,
              fontSize: 10,
              color: palette.muted,
            }}
          >
            <span>Market 62¢</span>
            <span style={{ color: palette.yes }}>AI {aiProb}%</span>
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 18,
            borderTop: `1px solid ${palette.border}`,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            opacity: stats,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "oklch(62% 0.18 295 / 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            <CheckIcon size={12} color={palette.ai} />
          </div>
          <div style={{ fontFamily: fontSans, fontSize: 12.5, color: palette.muted, lineHeight: 1.55 }}>
            Labor market softening and CPI below target. The market is underweighting a
            September cut - 12 of 14 agents converge on Yes.
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketPage({ frame }: { frame: number; fps: number }) {
  const { fps } = useVideoConfig();

  const verdictOpacity = interpolate(frame, [TL.verdictStart - 4, TL.verdictStart + 8], [0, 1], clamp);
  const emptyOpacity = 1 - verdictOpacity;

  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: fontSans, color: palette.fg }}>
      <AppNav active="Markets" credits="19 credits" />

      <div style={{ padding: "0 56px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 18,
            fontFamily: fontSans,
            fontSize: 12,
            color: palette.muted,
          }}
        >
          <span>Markets</span>
          <span style={{ opacity: 0.5 }}>›</span>
          <span>Economics</span>
          <span style={{ opacity: 0.5 }}>›</span>
          <span style={{ color: palette.fg }}>Fed Rate Cut</span>
        </div>

        <MarketHeader />

        <div style={{ display: "grid", gridTemplateColumns: "1024px 432px", gap: 20, marginTop: 20 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, opacity: emptyOpacity }}>
              <EmptyAnalysis frame={frame} fps={fps} />
            </div>
            <div style={{ position: "absolute", inset: 0, opacity: verdictOpacity }}>
              <VerdictPanel frame={frame} fps={fps} />
            </div>
          </div>
          <TradePanel />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: 22,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: fontMono,
          fontSize: 10.5,
          color: palette.muted,
          opacity: 0.65,
        }}
      >
        <span>TradeWizard analysis desk</span>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <ArrowIcon size={11} color={palette.muted} />
          All 14 agents run on every analysis
        </span>
      </div>
    </div>
  );
}
