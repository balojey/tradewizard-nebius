import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { MarketPage } from "./components/MarketPage";
import { AnalysisModal } from "./components/AnalysisModal";
import { Cursor } from "./components/Cursor";
import { palette, themeCss, type Theme } from "./theme";
import { TL } from "./timeline";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export function AnalysisDemo({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = interpolate(frame, [0, TL.fadeInEnd], [0, 1], clamp);
  const exit = interpolate(frame, [TL.fadeOut, TL.total], [1, 0], clamp);
  const opacity = enter * exit;
  const scale = interpolate(enter, [0, 1], [1.008, 1]);

  return (
    <AbsoluteFill
      className={`tw-theme-${theme}`}
      style={{ background: palette.bg, overflow: "hidden" }}
    >
      <style>{themeCss(theme)}</style>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--tw-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--tw-grid) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 8%, black 10%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 8%, black 10%, transparent 78%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -340,
          width: 1000,
          height: 620,
          transform: "translateX(-50%)",
          borderRadius: 999,
          background: "oklch(62% 0.2 260 / 0.16)",
          filter: "blur(110px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -80,
          top: 140,
          width: 520,
          height: 520,
          borderRadius: 999,
          background: "oklch(62% 0.18 295 / 0.12)",
          filter: "blur(110px)",
        }}
      />

      <AbsoluteFill
        style={{
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "50% 45%",
        }}
      >
        <MarketPage frame={frame} fps={fps} />
        <AnalysisModal frame={frame} />
        <Cursor />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 120% 90% at 50% 40%, transparent 58%, var(--tw-vignette) 100%)",
        }}
      />
    </AbsoluteFill>
  );
}
