import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, fontSans, palette, shadow } from "../theme";
import { STAGES, TL } from "../timeline";
import { CheckIcon, SparkleIcon } from "./Logo";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function ProgressRing({ active, frame }: { active: boolean; frame: number }) {
  if (!active) return null;
  const pulse = (Math.sin(frame * 0.45) + 1) / 2;
  return (
    <div
      style={{
        position: "absolute",
        inset: -5,
        borderRadius: 999,
        border: "1px solid oklch(62% 0.2 260 / 0.65)",
        opacity: 0.25 + pulse * 0.55,
        transform: `scale(${0.96 + pulse * 0.1})`,
      }}
    />
  );
}

function StageRow({
  index,
  label,
  state,
  frame,
}: {
  index: number;
  label: string;
  state: "done" | "active" | "pending";
  frame: number;
}) {
  const isDone = state === "done";
  const isActive = state === "active";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 40,
        padding: "0 12px",
        borderRadius: 9,
        background: isActive ? palette.surface2 : "transparent",
        border: isActive ? "1px solid oklch(62% 0.2 260 / 0.28)" : "1px solid transparent",
        transition: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 24,
          height: 24,
          borderRadius: 999,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isDone
            ? "oklch(72% 0.16 155 / 0.14)"
            : isActive
              ? palette.accent
              : palette.surface2,
          border: isDone
            ? "none"
            : isActive
              ? "none"
              : `1px solid ${palette.border}`,
          color: isActive ? palette.white : palette.muted,
          fontFamily: fontMono,
          fontSize: 9,
          fontWeight: 600,
        }}
      >
        <ProgressRing active={isActive} frame={frame} />
        {isDone ? <CheckIcon size={12} /> : <span>{String(index + 1).padStart(2, "0")}</span>}
      </div>
      <span
        style={{
          flex: 1,
          fontFamily: fontSans,
          fontSize: 13,
          fontWeight: isActive ? 600 : 400,
          color: isActive ? palette.fg : palette.muted,
          textDecoration: isDone ? "line-through" : "none",
          opacity: isDone ? 0.55 : 1,
        }}
      >
        {label}
      </span>
      {isActive && (
        <span
          style={{
            fontFamily: fontMono,
            fontSize: 10,
            color: palette.accent,
            opacity: 0.75 + ((Math.sin(frame * 0.4) + 1) / 2) * 0.25,
          }}
        >
          running
        </span>
      )}
      {isDone && (
        <span style={{ fontFamily: fontMono, fontSize: 10, color: palette.muted, opacity: 0.5 }}>
          done
        </span>
      )}
    </div>
  );
}

function RequestView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderRadius: 10,
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          marginBottom: 24,
        }}
      >
        <span style={{ fontFamily: fontSans, fontSize: 13, color: palette.muted }}>
          Credits remaining
        </span>
        <span style={{ fontFamily: fontMono, fontSize: 14, fontWeight: 600, color: palette.fg }}>
          19
        </span>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
          Request type
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div
            style={{
              flex: 1,
              height: 44,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: palette.accent,
              color: palette.white,
              fontFamily: fontSans,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 6px 18px -10px oklch(62% 0.2 260 / 0.8)",
            }}
          >
            One-time
          </div>
          <div
            style={{
              flex: 1,
              height: 44,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${palette.border}`,
              background: palette.bg,
              color: palette.muted,
              fontFamily: fontSans,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Recurring
          </div>
        </div>
      </div>

      <div
        style={{
          borderRadius: 11,
          border: `1px solid oklch(62% 0.18 295 / 0.28)`,
          background: "linear-gradient(135deg, oklch(62% 0.18 295 / 0.1), oklch(62% 0.2 260 / 0.05))",
          padding: "18px 18px 16px",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <SparkleIcon size={16} />
          <span style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 600 }}>
            Full research pass
          </span>
        </div>
        {[
          "14 specialist agents analyze every angle",
          "Bull and bear cases cross-examined",
          "Consensus probability, entry zones, and sizing",
        ].map((line) => (
          <div
            key={line}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontFamily: fontSans,
              fontSize: 12,
              color: palette.muted,
              lineHeight: 1.5,
              marginTop: 6,
            }}
          >
            <CheckIcon size={11} color={palette.yes} />
            <span>{line}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: fontMono,
          fontSize: 11,
          color: palette.muted,
          padding: "0 2px",
        }}
      >
        <span>Cost: 1 credit</span>
        <span>Est. 52 seconds</span>
      </div>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          gap: 12,
          paddingTop: 20,
          borderTop: `1px solid ${palette.border}`,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 46,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${palette.border}`,
            background: palette.bg,
            color: palette.muted,
            fontFamily: fontSans,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Cancel
        </div>
        <div
          style={{
            flex: 1,
            height: 46,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "linear-gradient(180deg, oklch(62% 0.18 295), oklch(55% 0.2 275))",
            color: palette.white,
            fontFamily: fontSans,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 10px 26px -12px oklch(62% 0.18 295 / 0.8)",
          }}
        >
          <SparkleIcon size={14} color={palette.white} />
          Request Analysis
        </div>
      </div>
    </div>
  );
}

function ProgressView({ frame }: { frame: number }) {
  const raw = interpolate(frame, [TL.progressStart, TL.progressEnd], [0, STAGES.length], clamp);
  const isComplete = raw >= STAGES.length;
  const elapsed = interpolate(frame, [TL.progressStart, TL.progressEnd], [0, 52], clamp);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: isComplete ? palette.yes : palette.ai,
            }}
          />
          <span style={{ fontFamily: fontSans, fontSize: 12.5, color: palette.muted }}>
            {isComplete ? "Consensus reached" : "14 agents deployed on Fed Rate Cut"}
          </span>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 11, color: palette.muted }}>
          {isComplete ? "52s" : `${Math.round(elapsed)}s`}
        </span>
      </div>

      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: palette.surface2,
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, (raw / STAGES.length) * 100)}%`,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.ai})`,
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
        {STAGES.map((stage, i) => {
          const state = raw >= i + 1 ? "done" : raw >= i ? "active" : "pending";
          return <StageRow key={stage} index={i} label={stage} state={state} frame={frame} />;
        })}
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 16,
          borderTop: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: fontSans,
            fontSize: 12.5,
            color: isComplete ? palette.yes : palette.muted,
            fontWeight: isComplete ? 600 : 400,
          }}
        >
          {isComplete ? "Analysis complete - results ready." : "Working through the research pipeline…"}
        </span>
        {isComplete && (
          <span
            style={{
              fontFamily: fontSans,
              fontSize: 12,
              fontWeight: 600,
              color: palette.white,
              background: palette.accent,
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            View results
          </span>
        )}
      </div>
    </div>
  );
}

export function AnalysisModal({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const open = spring({
    frame: frame - TL.modalOpen,
    fps,
    config: { damping: 24, stiffness: 160, mass: 0.9 },
  });

  const out = interpolate(frame, [TL.modalClose, TL.modalClose + 14], [1, 0], clamp);
  const backdrop = interpolate(frame, [TL.modalOpen - 4, TL.modalOpen + 8], [0, 0.62], clamp) * out;
  const showProgress = frame >= TL.clickRequest;

  if (frame < TL.modalOpen - 6) return null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `oklch(6% 0.01 260 / ${backdrop})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 420,
          top: 148,
          width: 760,
          height: 700,
          borderRadius: 18,
          background: palette.surface,
          border: `1px solid ${palette.borderStrong}`,
          boxShadow: shadow.modal,
          opacity: open * out,
          transform: `translateY(${(1 - open) * 22}px) scale(${0.965 + open * 0.035})`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: 72,
            padding: "0 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${palette.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "oklch(62% 0.18 295 / 0.13)",
                border: "1px solid oklch(62% 0.18 295 / 0.28)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SparkleIcon size={16} />
            </div>
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>
                {showProgress ? "Analyzing market" : "Get Analysis"}
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 10, color: palette.muted, marginTop: 2 }}>
                Fed Rate Cut · Polymarket
              </div>
            </div>
          </div>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: `1px solid ${palette.border}`,
              color: palette.muted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              lineHeight: 1,
            }}
          >
            ×
          </div>
        </div>

        <div style={{ padding: "22px 28px 24px", flex: 1, display: "flex", flexDirection: "column" }}>
          {showProgress ? <ProgressView frame={frame} /> : <RequestView />}
        </div>
      </div>
    </div>
  );
}
