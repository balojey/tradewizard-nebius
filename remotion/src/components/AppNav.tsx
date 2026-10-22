import { fontMono, fontSans, palette } from "../theme";
import { Logo } from "./Logo";

export function AppNav({
  active = "Markets",
  credits = "18 credits",
}: {
  active?: string;
  credits?: string;
}) {
  const links = ["Markets", "Insights", "Portfolio", "Pricing"];

  return (
    <div
      style={{
        height: 78,
        borderBottom: `1px solid ${palette.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 56px",
        background: palette.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
        <Logo />
        <div
          style={{
            display: "flex",
            gap: 30,
            fontFamily: fontSans,
            fontSize: 14,
            color: palette.muted,
          }}
        >
          {links.map((link) => (
            <span
              key={link}
              style={
                link === active
                  ? { color: palette.fg, fontWeight: 500 }
                  : undefined
              }
            >
              {link}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 999,
            background: palette.surface2,
            border: `1px solid ${palette.border}`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: palette.yes,
            }}
          />
          <span
            style={{
              fontFamily: fontMono,
              fontSize: 12,
              color: palette.fg,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {credits}
          </span>
        </div>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background:
              "linear-gradient(145deg, oklch(55% 0.15 285), oklch(45% 0.16 250))",
            border: `1px solid ${palette.borderStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontSans,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          A
        </div>
      </div>
    </div>
  );
}
