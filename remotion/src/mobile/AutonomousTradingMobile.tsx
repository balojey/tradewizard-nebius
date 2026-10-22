import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, fontSans, palette, themeCss, type Theme } from "../theme";
import { CheckIcon, SparkleIcon } from "../components/Logo";
import { AppBar, Chip, ProgressBar, StatusBar, mobileCard } from "./ui";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const ENTRY_FRAME = 94;
const MARK_START = 160;
const MARK_END = 360;

const EVENTS = [
  { at: 16, time: "09:41", text: "Scanned 42 markets - no edge above threshold", tone: "muted" },
  { at: 58, time: "09:42", text: "Fed Rate Cut - edge +9¢, above 8% threshold", tone: "accent" },
  { at: ENTRY_FRAME, time: "09:42", text: "ENTER LONG YES · 62¢ · $50", tone: "yes" },
  { at: 136, time: "09:42", text: "Stop 54¢ · target 78¢ · trail armed", tone: "muted" },
  { at: 300, time: "09:45", text: "Marked to 69¢ - unrealized +$5.64", tone: "yes" },
] as const;

function KillSwitch() {
  return (
    <div
      style={{
        width: 54,
        height: 54,
        borderRadius: 14,
        border: "1px solid oklch(65% 0.18 25 / 0.42)",
        background: "oklch(65% 0.18 25 / 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M12 3v8" stroke={palette.no} strokeWidth="2.2" strokeLinecap="round" />
        <path
          d="M7 6.2a8 8 0 1 0 10 0"
          stroke={palette.no}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function Stats({ frame }: { frame: number }) {
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const unrealized = 17.76 + mark;
  const enter = spring({ frame: frame - 8, fps: 30, config: { damping: 200 } });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, opacity: enter }}>
      {[
        { label: "Committed", value: "$450", sub: "$790 available" },
        { label: "Unrealized P&L", value: `+$${unrealized.toFixed(2)}`, sub: `+${((unrealized / 450) * 100).toFixed(1)}%`, tone: palette.yes },
        { label: "Realized P&L", value: "+$67.20", sub: "cumulative", tone: palette.yes },
        { label: "Active sessions", value: "3 / 3", sub: "Pro plan" },
      ].map((stat) => (
        <div key={stat.label} style={{ ...mobileCard, padding: "12px 15px" }}>
          <div style={{ fontFamily: fontSans, fontSize: 15, color: palette.muted }}>{stat.label}</div>
          <div style={{ fontFamily: fontMono, fontSize: 25, fontWeight: 600, color: stat.tone ?? palette.fg, marginTop: 2 }}>
            {stat.value}
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 13, color: palette.muted, marginTop: 1 }}>{stat.sub}</div>
        </div>
      ))}
    </div>
  );
}

function FedSession({ frame }: { frame: number }) {
  const entered = frame >= ENTRY_FRAME;
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const utilized = Math.round(interpolate(frame, [ENTRY_FRAME, ENTRY_FRAME + 30], [0, 25], clamp));

  return (
    <div style={{ ...mobileCard, padding: "14px 16px", height: 204, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 600, lineHeight: 1.18 }}>
            Will the Fed cut rates before September 2026?
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: palette.muted, marginTop: 4 }}>62% market</div>
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: "4px 10px",
            borderRadius: 999,
            border: entered ? "1px solid oklch(72% 0.16 155 / 0.32)" : "1px solid oklch(62% 0.2 260 / 0.32)",
            background: entered ? "oklch(72% 0.16 155 / 0.12)" : "oklch(62% 0.2 260 / 0.12)",
            color: entered ? palette.yes : palette.accent,
            fontFamily: fontMono,
            fontSize: 14,
          }}
        >
          {entered ? "Positioned" : "Watching"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, fontFamily: fontSans, fontSize: 14, color: palette.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: palette.ai }}>
          <SparkleIcon size={14} />
          The Sniper
        </span>
        <span>$200 invested</span>
        <span>{utilized}% utilized</span>
      </div>

      <div style={{ marginTop: 9 }}>
        <ProgressBar value={utilized} height={6} />
      </div>

      <div style={{ marginTop: 8, fontFamily: fontSans, fontSize: 15, color: palette.muted, lineHeight: 1.35 }}>
        {entered ? "Edge 9% > threshold - entered LONG YES at 62¢." : "Edge 7%, below Sniper threshold of 8%."}
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 8,
          borderTop: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: fontMono,
          fontSize: 15,
          color: palette.muted,
        }}
      >
        <span>
          Unrealized <span style={{ color: palette.yes }}>+${mark.toFixed(2)}</span>
        </span>
        <span style={{ color: palette.muted }}>Realized <span style={{ color: palette.yes }}>+$12.00</span></span>
      </div>
    </div>
  );
}

function LiveActivity({ frame }: { frame: number }) {
  const toneColor = {
    muted: palette.muted,
    accent: palette.accent,
    yes: palette.yes,
  };

  return (
    <div style={{ ...mobileCard, padding: "14px 16px", height: 222, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", width: 10, height: 10, borderRadius: 999, background: palette.ai }}>
            <span
              style={{
                position: "absolute",
                inset: -4,
                borderRadius: 999,
                border: "1px solid oklch(62% 0.18 295 / 0.5)",
                opacity: 0.4 + ((Math.sin(frame * 0.35) + 1) / 2) * 0.5,
              }}
            />
          </span>
          <span style={{ fontFamily: fontSans, fontSize: 23, fontWeight: 700 }}>Live activity</span>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 15, color: palette.muted }}>24/7</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {EVENTS.map((event) => {
          const opacity = interpolate(frame, [event.at, event.at + 10], [0, 1], clamp);
          return (
            <div
              key={event.at}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 32,
                padding: "0 7px",
                borderRadius: 7,
                background: event.tone === "yes" ? "oklch(72% 0.16 155 / 0.06)" : "transparent",
                opacity,
              }}
            >
              <span style={{ fontFamily: fontMono, fontSize: 13, color: palette.muted, width: 42, flexShrink: 0 }}>
                {event.time}
              </span>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: toneColor[event.tone],
                  flexShrink: 0,
                  opacity: event.tone === "muted" ? 0.5 : 0.9,
                }}
              />
              <span style={{ fontFamily: fontSans, fontSize: 15, color: event.tone === "muted" ? palette.muted : palette.fg }}>
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
  const appear = spring({ frame: frame - ENTRY_FRAME - 6, fps, config: { damping: 20, stiffness: 130 } });
  const mark = interpolate(frame, [MARK_START, MARK_END], [0, 5.64], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const price = Math.round(62 + (mark / 5.64) * 7);

  return (
    <div style={{ ...mobileCard, padding: "14px 16px", height: 198, opacity: appear, transform: `translateY(${(1 - appear) * 10}px)` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 700 }}>Current position</span>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)" fontSize={14}>
          LONG YES
        </Chip>
      </div>

      <div style={{ fontFamily: fontSans, fontSize: 16, color: palette.muted }}>Fed Rate Cut · Sep 16</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        {[
          ["Entry", "62¢", palette.fg],
          ["Mark", `${price}¢`, palette.yes],
          ["Unrealized", `+$${mark.toFixed(2)}`, palette.yes],
        ].map(([label, value, color]) => (
          <div key={label} style={{ borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.bg, padding: "7px 8px" }}>
            <div style={{ fontFamily: fontSans, fontSize: 13, color: palette.muted }}>{label}</div>
            <div style={{ fontFamily: fontMono, fontSize: 19, fontWeight: 600, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 9 }}>
        <ProgressBar value={((price - 54) / (78 - 54)) * 100} height={6} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontFamily: fontMono, fontSize: 13, color: palette.muted }}>
          <span>Stop 54¢</span>
          <span>Entry 62¢</span>
          <span>Target 78¢</span>
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6, fontFamily: fontSans, fontSize: 14, color: palette.muted }}>
        <CheckIcon size={13} />
        Trailing exit armed · checked every 60s
      </div>
    </div>
  );
}

export function AutonomousTradingMobile({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], clamp);
  const exit = interpolate(frame, [402, 420], [1, 0], clamp);
  const header = spring({ frame: frame - 4, fps: 30, config: { damping: 200 } });

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
          maskImage: "radial-gradient(ellipse 90% 50% at 50% 0%, black 10%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 50% at 50% 0%, black 10%, transparent 78%)",
        }}
      />

      <div style={{ position: "absolute", inset: 0, opacity: enter * exit }}>
        <StatusBar />
        <AppBar credits="18 credits" />

        <div style={{ padding: "12px 26px 22px", height: 1125 - 142, display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: header }}>
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 37, fontWeight: 700, letterSpacing: "-0.03em" }}>
                Portfolio Manager
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.12)" border="oklch(62% 0.18 295 / 0.3)" fontSize={15}>
                  <SparkleIcon size={13} />
                  The Sniper
                </Chip>
                <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)" fontSize={15}>
                  Autonomous · 24/7
                </Chip>
              </div>
            </div>
            <KillSwitch />
          </div>

          <Stats frame={frame} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 700 }}>Sessions</span>
            <span style={{ fontFamily: fontMono, fontSize: 15, color: palette.muted }}>3 active · 3 past</span>
          </div>

          <FedSession frame={frame} />
          <LiveActivity frame={frame} />
          <CurrentPosition frame={frame} />
        </div>
      </div>

      <AbsoluteFill style={{ background: palette.bg, opacity: 1 - enter * exit, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
