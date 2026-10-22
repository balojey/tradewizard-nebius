import { Easing, interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, palette } from "../theme";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export function StatusBar() {
  return (
    <div
      style={{
        height: 54,
        flexShrink: 0,
        padding: "0 34px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: fontSans,
        fontWeight: 600,
        fontSize: 26,
        color: palette.fg,
      }}
    >
      <span style={{ letterSpacing: "-0.01em" }}>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
          {[8, 12, 16, 20].map((height) => (
            <span
              key={height}
              style={{
                width: 4,
                height,
                borderRadius: 1,
                background: palette.fg,
                opacity: 0.9,
              }}
            />
          ))}
        </div>
        <svg width="24" height="18" viewBox="0 0 24 18" fill="none">
          <path
            d="M2 6.5C7.5 1.5 16.5 1.5 22 6.5M5.4 10.2c3.8-3.4 9.4-3.4 13.2 0M8.9 13.8c1.9-1.6 4.3-1.6 6.2 0"
            stroke={palette.fg}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="16" r="1.6" fill={palette.fg} />
        </svg>
        <div
          style={{
            width: 34,
            height: 17,
            border: `1.6px solid ${palette.fg}`,
            borderRadius: 5,
            padding: 2,
          }}
        >
          <div
            style={{
              width: "76%",
              height: "100%",
              background: palette.fg,
              borderRadius: 2.5,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function MobileLogo({ size = 36 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background:
            "linear-gradient(145deg, oklch(30% 0.09 285), oklch(18% 0.04 270))",
          border: "1px solid oklch(45% 0.12 285 / 0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
          <polyline
            points="4,18 9,13 13,15 20,7"
            stroke="oklch(78% 0.12 285)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="15,7 20,7 20,12"
            stroke="oklch(78% 0.12 285)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span
        style={{
          fontFamily: fontSans,
          fontSize: 31,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: palette.fg,
        }}
      >
        Trade<span style={{ color: palette.accent }}>Wizard</span>
      </span>
    </div>
  );
}

export function AppBar({
  credits = "19",
  title,
}: {
  credits?: string;
  title?: string;
}) {
  return (
    <div
      style={{
        height: 88,
        flexShrink: 0,
        padding: "0 30px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      {title ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {title}
          </span>
          <span style={{ fontFamily: fontMono, fontSize: 18, color: palette.muted }}>
            {credits} credits
          </span>
        </div>
      ) : (
        <MobileLogo />
      )}

      {!title ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 15px",
              borderRadius: 999,
              border: `1px solid ${palette.border}`,
              background: palette.surface2,
              fontFamily: fontMono,
              fontSize: 20,
              color: palette.fg,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 999, background: palette.yes }} />
            {credits}
          </span>
          <span
            style={{
              width: 50,
              height: 50,
              borderRadius: 999,
              background:
                "linear-gradient(145deg, oklch(55% 0.15 285), oklch(45% 0.16 250))",
              border: `1px solid ${palette.borderStrong}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fontSans,
              fontSize: 21,
              fontWeight: 700,
            }}
          >
            A
          </span>
        </div>
      ) : (
        <span
          style={{
            width: 50,
            height: 50,
            borderRadius: 999,
            background:
              "linear-gradient(145deg, oklch(55% 0.15 285), oklch(45% 0.16 250))",
            border: `1px solid ${palette.borderStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontSans,
            fontSize: 21,
            fontWeight: 700,
          }}
        >
          A
        </span>
      )}
    </div>
  );
}

export const mobileCard: React.CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 20,
};

export function Chip({
  children,
  color = palette.muted,
  bg = palette.surface2,
  border = palette.border,
  fontSize = 20,
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
  fontSize?: number;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 12px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontFamily: fontMono,
        fontSize,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function TouchTap({
  x,
  y,
  at,
  color = palette.accent,
}: {
  x: number;
  y: number;
  at: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const ring = interpolate(frame, [at, at + 24], [0, 1], clamp);
  const dotOpacity = interpolate(
    frame,
    [at - 10, at - 4, at + 10, at + 18],
    [0, 1, 1, 0],
    clamp
  );

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 0,
        height: 0,
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -14,
          top: -14,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: color,
          opacity: dotOpacity * 0.9,
          boxShadow: `0 0 0 6px ${color}22`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -40,
          top: -40,
          width: 80,
          height: 80,
          borderRadius: 999,
          border: `3px solid ${color}`,
          opacity: frame >= at ? (1 - ring) * 0.75 : 0,
          transform: `scale(${0.25 + ring * 1.1})`,
        }}
      />
    </div>
  );
}

export function CountUp({
  from = 0,
  to,
  start,
  end,
  suffix = "",
  prefix = "",
  decimals = 0,
}: {
  from?: number;
  to: number;
  start: number;
  end: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [start, end], [from, to], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function ProgressBar({
  value,
  color = palette.yes,
  height = 8,
  track = palette.surface2,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: track,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: "100%",
          borderRadius: 999,
          background: color,
        }}
      />
    </div>
  );
}
