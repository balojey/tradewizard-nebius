import { palette, fontSans } from "../theme";

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background: "linear-gradient(145deg, oklch(30% 0.09 285), oklch(18% 0.04 270))",
          border: "1px solid oklch(45% 0.12 285 / 0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "inset 0 1px 0 oklch(100% 0 0 / 0.1)",
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
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: palette.fg,
        }}
      >
        Trade<span style={{ color: palette.accent }}>Wizard</span>
      </span>
    </div>
  );
}

export function SparkleIcon({ size = 18, color = palette.ai }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.7 4.9L18.6 9.6l-4.9 1.7L12 16.2l-1.7-4.9L5.4 9.6l4.9-1.7L12 3z"
        fill={color}
      />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill={color} opacity={0.7} />
    </svg>
  );
}

export function CheckIcon({ size = 14, color = palette.yes }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowIcon({ size = 16, color = palette.white }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
