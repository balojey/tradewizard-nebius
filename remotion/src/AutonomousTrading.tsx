import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, fontSans, palette, themeCss, type Theme } from "./theme";
import { AppNav } from "./components/AppNav";
import { CheckIcon, SparkleIcon } from "./components/Logo";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const ENTRY_FRAME = 94;
const MARK_START = 160;
const MARK_END = 360;

type Tone = "muted" | "accent" | "yes" | "no";

const EVENTS: Array<{ at: number; time: string; text: string; tone: Tone }> = [
  { at: 16, time: "09:41", text: "Scanned 42 markets - no edge above threshold", tone: "muted" },
  { at: 58, time: "09:42", text: "Fed Rate Cut - edge +9¢, above 8% Sniper threshold", tone: "accent" },
  { at: ENTRY_FRAME, time: "09:42", text: "ENTER LONG YES · 62¢ · $50 (25% of session)", tone: "yes" },
  { at: 136, time: "09:42", text: "Stop 54¢ · target 78¢ · trailing exit armed", tone: "muted" },
  { at: 274, time: "09:43", text: "Marked to 66¢ - unrealized +$3.22", tone: "yes" },
  { at: 310, time: "09:45", text: "CPI print in 2h - holding, no new entries", tone: "muted" },
  { at: 360, time: "09:47", text: "Marked to 69¢ - unrealized +$5.64", tone: "yes" },
];

const card: React.CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 14,
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
        gap: 5,
        padding: "4px 9px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontFamily: fontMono,
        fontSize: 10,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function PulseDot({ frame, color = palette.yes }: { frame: number; color?: string }) {
  const pulse = (Math.sin(frame * 0.35) + 1) / 2;
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: color,
          opacity: 0.2 + pulse * 0.35,
          transform: `scale(${1 + pulse * 1.6})`,
        }}
      />
      <span style={{ position: "relative", width: 7, height: 7, borderRadius: 999, background: color }} />
    </span>
  );
}

function StatsBar({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const unrealized = 17.76 + mark;
  const enterStats = spring({ frame: frame - 8, fps, config: { damping: 200 } });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, opacity: enterStats }}>
      {[
        { label: "Committed capital", value: "$450", sub: "$790 available of $1,240" },
        { label: "Unrealized P&L", value: `+$${unrealized.toFixed(2)}`, sub: `+${((unrealized / 450) * 100).toFixed(1)}%`, tone: palette.yes },
        { label: "Realized P&L", value: "+$67.20", sub: "cumulative", tone: palette.yes },
        { label: "Active sessions", value: "3 / 3", sub: "Pro plan limit" },
      ].map((stat) => (
        <div key={stat.label} style={{ ...card, padding: "14px 16px" }}>
          <div style={{ fontFamily: fontSans, fontSize: 10.5, color: palette.muted, marginBottom: 5 }}>
            {stat.label}
          </div>
          <div
            style={{
              fontFamily: fontMono,
              fontSize: 21,
              fontWeight: 600,
              color: stat.tone ?? palette.fg,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {stat.value}
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 9.5, color: palette.muted, marginTop: 3 }}>
            {stat.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function UtilizationBar({ value, tone = palette.yes }: { value: number; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 999,
          background: palette.surface2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            borderRadius: 999,
            background: tone,
            opacity: 0.9,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: fontMono,
          fontSize: 9.5,
          color: palette.muted,
          fontVariantNumeric: "tabular-nums",
          width: 78,
          textAlign: "right",
        }}
      >
        {value}% utilized
      </span>
    </div>
  );
}

function StatusPill({ status, warning }: { status: "Positioned" | "Watching"; warning?: boolean }) {
  const styles = warning
    ? {
        color: palette.warning,
        background: "oklch(78% 0.14 85 / 0.12)",
        border: "oklch(78% 0.14 85 / 0.32)",
      }
    : status === "Positioned"
      ? {
          color: palette.yes,
          background: "oklch(72% 0.16 155 / 0.12)",
          border: "oklch(72% 0.16 155 / 0.32)",
        }
      : {
          color: palette.accent,
          background: "oklch(62% 0.2 260 / 0.12)",
          border: "oklch(62% 0.2 260 / 0.32)",
        };

  return (
    <span
      style={{
        fontFamily: fontMono,
        fontSize: 9.5,
        fontWeight: 500,
        color: styles.color,
        background: styles.background,
        border: `1px solid ${styles.border}`,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function SessionCard({
  frame,
  title,
  probability,
  status,
  invested,
  utilized,
  pnl,
  realized,
  note,
  warn,
  children,
}: {
  frame: number;
  title: string;
  probability: string;
  status: "Positioned" | "Watching";
  invested: string;
  utilized: number;
  pnl: string;
  realized: string;
  note: string;
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ ...card, padding: "16px 18px", height: 198, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span
            style={{
              fontFamily: fontSans,
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          <span style={{ fontFamily: fontMono, fontSize: 10.5, color: palette.muted }}>{probability}</span>
          {warn && (
            <Chip color={palette.warning} bg="oklch(78% 0.14 85 / 0.1)" border="oklch(78% 0.14 85 / 0.3)">
              loss limit · sizing cut
            </Chip>
          )}
        </div>
        <StatusPill status={status} warning={warn} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: 10,
          fontFamily: fontSans,
          fontSize: 10.5,
          color: palette.muted,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: palette.ai }}>
          <SparkleIcon size={12} />
          The Sniper
        </span>
        <span>{invested} invested</span>
        <span>{utilized}% utilized</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <UtilizationBar value={utilized} tone={warn ? palette.warning : palette.yes} />
      </div>

      <div style={{ marginTop: 10, fontFamily: fontSans, fontSize: 10.5, color: palette.muted, lineHeight: 1.5 }}>
        {note}
      </div>

      {children}

      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            fontFamily: fontMono,
            fontSize: 10,
            color: palette.muted,
          }}
        >
          <span>
            Unrealized <span style={{ color: pnl.startsWith("-") ? palette.no : pnl === "$0.00" ? palette.muted : palette.yes }}>{pnl}</span>
          </span>
          <span>
            Realized <span style={{ color: realized.startsWith("-") ? palette.no : palette.yes }}>{realized}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["Pause", "Stop"].map((action) => (
            <span
              key={action}
              style={{
                fontFamily: fontSans,
                fontSize: 9.5,
                color: palette.muted,
                border: `1px solid ${palette.border}`,
                borderRadius: 5,
                padding: "3px 8px",
              }}
            >
              {action}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FedSession({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const entered = frame >= ENTRY_FRAME;
  const statusChange = spring({
    frame: frame - ENTRY_FRAME,
    fps,
    config: { damping: 18, stiffness: 140 },
  });
  const utilized = Math.round(
    interpolate(frame, [ENTRY_FRAME, ENTRY_FRAME + 30], [0, 25], clamp)
  );
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const pnl = `+$${mark.toFixed(2)}`;

  return (
    <SessionCard
      frame={frame}
      title="Will the Fed cut rates before September 2026?"
      probability="62%"
      status={entered ? "Positioned" : "Watching"}
      invested="$200"
      utilized={utilized}
      pnl={pnl}
      realized="+$12.00"
      note={
        entered
          ? "Edge 9% > Sniper threshold - entered LONG YES at 62¢."
          : "Last decision: edge 7%, below Sniper threshold of 8%."
      }
    >
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 24,
          opacity: statusChange,
        }}
      >
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.3)">
          LONG YES @ 62¢
        </Chip>
        <span style={{ fontFamily: fontMono, fontSize: 9.5, color: palette.muted }}>
          stop 54¢ · target 78¢
        </span>
      </div>
    </SessionCard>
  );
}

function LiveActivity({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const toneColor: Record<Tone, string> = {
    muted: palette.muted,
    accent: palette.accent,
    yes: palette.yes,
    no: palette.no,
  };

  return (
    <div style={{ ...card, padding: "14px 16px", height: 350, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PulseDot frame={frame} color={palette.ai} />
          <span style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700 }}>Live activity</span>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 9.5, color: palette.muted }}>24 / 7</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {EVENTS.map((event) => {
          const appear = spring({
            frame: frame - event.at,
            fps,
            config: { damping: 22, stiffness: 150 },
          });
          return (
            <div
              key={event.at}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                padding: "7px 8px",
                borderRadius: 7,
                background: event.tone === "yes" && frame >= event.at ? "oklch(72% 0.16 155 / 0.06)" : "transparent",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 8}px)`,
              }}
            >
              <span
                style={{
                  fontFamily: fontMono,
                  fontSize: 9,
                  color: palette.muted,
                  paddingTop: 2,
                  width: 30,
                  flexShrink: 0,
                }}
              >
                {event.time}
              </span>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: toneColor[event.tone],
                  marginTop: 6,
                  flexShrink: 0,
                  opacity: event.tone === "muted" ? 0.5 : 0.9,
                }}
              />
              <span
                style={{
                  fontFamily: fontSans,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: event.tone === "muted" ? palette.muted : palette.fg,
                }}
              >
                {event.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentPosition({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const appear = spring({
    frame: frame - ENTRY_FRAME - 6,
    fps,
    config: { damping: 20, stiffness: 130 },
  });
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const price = Math.round(62 + (mark / 5.64) * 7);
  const pnl = mark;
  const flatOpacity = interpolate(frame, [ENTRY_FRAME, ENTRY_FRAME + 10], [1, 0], clamp);

  return (
    <div style={{ ...card, padding: "14px 16px", height: 240, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "14px 16px",
          opacity: flatOpacity,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700 }}>Current position</span>
          <Chip>Flat</Chip>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "oklch(62% 0.18 295 / 0.1)",
              border: "1px solid oklch(62% 0.18 295 / 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SparkleIcon size={16} />
          </div>
          <span style={{ fontFamily: fontSans, fontSize: 12, color: palette.fg }}>Scanning 42 markets</span>
          <span style={{ fontFamily: fontMono, fontSize: 9.5, color: palette.muted }}>
            waiting for edge &gt; 8%
          </span>
        </div>
      </div>

      <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 10}px)`, height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700 }}>Current position</span>
          <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.3)">
            LONG YES
          </Chip>
        </div>

        <div
          style={{
            fontFamily: fontSans,
            fontSize: 11.5,
            color: palette.fg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: 10,
          }}
        >
          Fed Rate Cut · Sep 16, 2026
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            ["Entry", "62¢", palette.fg],
            ["Mark", `${price}¢`, palette.yes],
            ["Unrealized", `+$${pnl.toFixed(2)}`, palette.yes],
          ].map(([label, value, color]) => (
            <div
              key={label}
              style={{
                borderRadius: 8,
                border: `1px solid ${palette.border}`,
                background: palette.bg,
                padding: "8px 9px",
              }}
            >
              <div style={{ fontFamily: fontSans, fontSize: 9, color: palette.muted, marginBottom: 3 }}>
                {label}
              </div>
              <div
                style={{
                  fontFamily: fontMono,
                  fontSize: 14,
                  fontWeight: 600,
                  color,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ position: "relative", height: 14 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 4,
                height: 5,
                borderRadius: 999,
                background: palette.surface2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${((price - 54) / (78 - 54)) * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${palette.yes}, ${palette.yes})`,
                  opacity: 0.85,
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: `${((62 - 54) / (78 - 54)) * 100}%`,
                top: 1,
                width: 2,
                height: 11,
                marginLeft: -1,
                background: palette.fg,
                opacity: 0.6,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: fontMono,
              fontSize: 9,
              color: palette.muted,
            }}
          >
            <span>Stop 54¢</span>
            <span>Entry 62¢</span>
            <span>Target 78¢</span>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            fontFamily: fontSans,
            fontSize: 10,
            color: palette.muted,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <CheckIcon size={11} />
          Trailing exit armed · checks every 60s
        </div>
      </div>
    </div>
  );
}

function SafetyRails() {
  return (
    <div style={{ ...card, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontFamily: fontSans, fontSize: 12.5, fontWeight: 700 }}>Safety rails</span>
        <Chip color={palette.muted}>armed</Chip>
      </div>
      {["Stop-loss on every trade", "25% max position size", "Global kill switch ready"].map((line) => (
        <div
          key={line}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: fontSans,
            fontSize: 10,
            color: palette.muted,
            padding: "3px 0",
          }}
        >
          <CheckIcon size={10} />
          {line}
        </div>
      ))}
    </div>
  );
}

export function AutonomousTrading({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = interpolate(frame, [0, 14], [0, 1], clamp);
  const exit = interpolate(frame, [402, 420], [1, 0], clamp);
  const opacity = enter * exit;
  const header = spring({ frame: frame - 4, fps, config: { damping: 200 } });

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
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 0%, black 10%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 0%, black 10%, transparent 75%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "38%",
          top: -300,
          width: 900,
          height: 540,
          borderRadius: 999,
          background: "oklch(62% 0.18 295 / 0.12)",
          filter: "blur(120px)",
        }}
      />

      <AbsoluteFill style={{ opacity }}>
        <AppNav active="Portfolio" credits="18 credits" />

        <div style={{ padding: "16px 56px 0", opacity: header }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ margin: 0, fontFamily: fontSans, fontSize: 27, fontWeight: 700, letterSpacing: "-0.03em" }}>
                Portfolio Manager
              </h1>
              <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.12)" border="oklch(62% 0.18 295 / 0.3)">
                <SparkleIcon size={11} />
                The Sniper
              </Chip>
              <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)">
                <PulseDot frame={frame} />
                Autonomous · 24/7
              </Chip>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontFamily: fontSans,
                  fontSize: 11.5,
                  color: palette.no,
                  border: `1px solid oklch(65% 0.18 25 / 0.4)`,
                  background: "oklch(65% 0.18 25 / 0.08)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontWeight: 600,
                }}
              >
                Kill Switch
              </span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <StatsBar frame={frame} />
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 254,
            left: 56,
            right: 56,
            bottom: 24,
            display: "grid",
            gridTemplateColumns: "1020px 414px",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontFamily: fontSans, fontSize: 14, fontWeight: 700 }}>Sessions</span>
              <span style={{ fontFamily: fontMono, fontSize: 10, color: palette.muted }}>
                3 active · 3 past
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <FedSession frame={frame} />
              <SessionCard
                frame={frame}
                title="Will Trump win the 2028 GOP primary?"
                probability="68%"
                status="Positioned"
                invested="$150"
                utilized={33}
                pnl="+$9.50"
                realized="+$12.00"
                note="LONG YES at 64¢ → 68¢ · trailing exit above 72¢."
              />
              <SessionCard
                frame={frame}
                title="Bitcoin above $150k by June?"
                probability="33%"
                status="Positioned"
                invested="$100"
                utilized={45}
                pnl="-$2.10"
                realized="+$36.70"
                note="LONG YES at 35¢ → 33¢ · loss limit hit, sizing reduced 50%."
                warn
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
            <LiveActivity frame={frame} />
            <CurrentPosition frame={frame} />
            <div style={{ marginTop: "auto" }}>
              <SafetyRails />
            </div>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ background: palette.bg, opacity: 1 - opacity, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
