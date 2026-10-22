import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, palette, themeCss, type Theme } from "./theme";
import { AppNav } from "./components/AppNav";
import { CheckIcon, SparkleIcon } from "./components/Logo";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const SCROLL_MAX = 524;
const SCROLL_START = 70;
const SCROLL_END = 360;

type Signal = "bull" | "bear" | "neutral";

const AGENT_FINDINGS: Array<{ name: string; signal: Signal; confidence: number; note: string }> = [
  { name: "Market microstructure", signal: "bull", confidence: 78, note: "Ask-side depth thin; buyers lifting offers." },
  { name: "Probability baseline", signal: "bull", confidence: 74, note: "Base rate implies 69% versus 62¢ market." },
  { name: "Risk assessment", signal: "bear", confidence: 58, note: "Size above 4.5% adds concentration risk." },
  { name: "Breaking news", signal: "bull", confidence: 83, note: "Dovish Fed minutes surfaced Tuesday." },
  { name: "Event impact", signal: "bull", confidence: 76, note: "September meeting now live for a cut." },
  { name: "Polling intelligence", signal: "bull", confidence: 81, note: "68% of economists expect a cut by Q3." },
  { name: "Historical patterns", signal: "bull", confidence: 72, note: "4 of 5 similar setups cut within 90 days." },
  { name: "Media sentiment", signal: "bull", confidence: 70, note: "Coverage shifted from 'if' to 'when'." },
  { name: "Social sentiment", signal: "bull", confidence: 64, note: "Retail attention rising, direction positive." },
  { name: "Narrative velocity", signal: "bull", confidence: 75, note: "Cut narrative accelerating across wires." },
  { name: "Momentum", signal: "bull", confidence: 69, note: "Price up 6 of the last 8 sessions." },
  { name: "Mean reversion", signal: "bull", confidence: 59, note: "Pullback shallow; trend still intact." },
  { name: "Catalyst identification", signal: "bull", confidence: 80, note: "Thursday CPI is the next trigger." },
  { name: "Tail risk", signal: "bear", confidence: 64, note: "Energy shock could delay the first cut." },
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
        gap: 6,
        padding: "4px 9px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontFamily: fontMono,
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SignalPill({ signal }: { signal: Signal }) {
  const map = {
    bull: { label: "Bullish", color: palette.yes, bg: "oklch(72% 0.16 155 / 0.1)", border: "oklch(72% 0.16 155 / 0.28)" },
    bear: { label: "Bearish", color: palette.no, bg: "oklch(65% 0.18 25 / 0.1)", border: "oklch(65% 0.18 25 / 0.28)" },
    neutral: { label: "Neutral", color: palette.muted, bg: palette.surface2, border: palette.border },
  }[signal];

  return (
    <span
      style={{
        fontFamily: fontMono,
        fontSize: 9.5,
        fontWeight: 500,
        color: map.color,
        background: map.bg,
        border: `1px solid ${map.border}`,
        padding: "2px 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {map.label}
    </span>
  );
}

function AgentRow({ agent }: { agent: (typeof AGENT_FINDINGS)[number] }) {
  const color =
    agent.signal === "bull" ? palette.yes : agent.signal === "bear" ? palette.no : palette.muted;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            fontFamily: fontSans,
            fontSize: 12.5,
            fontWeight: 600,
            color: palette.fg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agent.name}
        </span>
        <SignalPill signal={agent.signal} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontFamily: fontSans,
            fontSize: 11,
            color: palette.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agent.note}
        </span>
        <span
          style={{
            fontFamily: fontMono,
            fontSize: 9.5,
            color,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {agent.confidence}%
        </span>
      </div>
      <div style={{ height: 3, borderRadius: 999, background: palette.surface2, marginTop: 6 }}>
        <div
          style={{
            width: `${agent.confidence}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
            opacity: 0.75,
          }}
        />
      </div>
    </div>
  );
}

function GapBar() {
  return (
    <div>
      <div style={{ position: "relative", height: 22 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 7,
            height: 8,
            borderRadius: 999,
            background: palette.surface2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "71%",
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
            height: 18,
            marginLeft: -1,
            background: palette.fg,
            opacity: 0.8,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "71%",
            top: 2,
            width: 13,
            height: 13,
            marginLeft: -6.5,
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
          marginTop: 5,
          fontFamily: fontMono,
          fontSize: 10,
          color: palette.muted,
        }}
      >
        <span>0%</span>
        <span>Market 62¢</span>
        <span style={{ color: palette.yes }}>AI 71%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function VerdictCard() {
  return (
    <div style={{ ...card, padding: "22px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.13)" border="oklch(72% 0.16 155 / 0.35)">
            LONG YES
          </Chip>
          <Chip>82% confidence</Chip>
          <Chip color={palette.muted}>Analysis #4821</Chip>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 10.5, color: palette.muted }}>
          Completed in 52s · 1 credit
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                fontFamily: fontSans,
                fontSize: 56,
                fontWeight: 700,
                letterSpacing: "-0.045em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              71%
            </span>
            <div style={{ fontFamily: fontSans, fontSize: 12.5, color: palette.muted, lineHeight: 1.4 }}>
              <div>AI probability</div>
              <div style={{ fontFamily: fontMono, fontSize: 10.5 }}>confidence band 66–76%</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 28, paddingBottom: 4 }}>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 10.5, color: palette.muted, marginBottom: 3 }}>
              Market price
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 600 }}>62¢</div>
          </div>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 10.5, color: palette.muted, marginBottom: 3 }}>
              Edge
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 600, color: palette.yes }}>
              +9¢
            </div>
          </div>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 10.5, color: palette.muted, marginBottom: 3 }}>
              Agents aligned
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 600 }}>12 / 14</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <GapBar />
      </div>
    </div>
  );
}

function ReasoningChain() {
  const steps = [
    { title: "14 agents", detail: "Independent reads" },
    { title: "Signal fusion", detail: "Weighted + conflicts" },
    { title: "5 stress tests", detail: "Adversarial review" },
    { title: "Consensus", detail: "71% · 66–76% band" },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 700 }}>The reasoning chain</div>
          <div style={{ fontFamily: fontSans, fontSize: 11.5, color: palette.muted, marginTop: 2 }}>
            Every stage is visible. Nothing is hidden behind a single score.
          </div>
        </div>
        <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.1)" border="oklch(62% 0.18 295 / 0.28)">
          11 stages · 14 agents
        </Chip>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        {steps.map((step, index) => (
          <div key={step.title} style={{ display: "flex", alignItems: "stretch", flex: 1, gap: 8 }}>
            <div
              style={{
                flex: 1,
                padding: "12px 14px",
                borderRadius: 10,
                background: index === steps.length - 1 ? "oklch(72% 0.16 155 / 0.07)" : palette.surface,
                border: `1px solid ${index === steps.length - 1 ? "oklch(72% 0.16 155 / 0.3)" : palette.border}`,
              }}
            >
              <div style={{ fontFamily: fontSans, fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>
                {step.title}
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 9.5, color: palette.muted }}>{step.detail}</div>
            </div>
            {index < steps.length - 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: palette.borderStrong,
                  fontFamily: fontMono,
                  fontSize: 12,
                }}
              >
                →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentFindings() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 700 }}>What each agent found</div>
          <div style={{ fontFamily: fontSans, fontSize: 11.5, color: palette.muted, marginTop: 2 }}>
            Including the two agents that disagreed with the consensus.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)">
            12 bullish
          </Chip>
          <Chip color={palette.no} bg="oklch(65% 0.18 25 / 0.1)" border="oklch(65% 0.18 25 / 0.28)">
            2 bearish
          </Chip>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {AGENT_FINDINGS.map((agent) => (
          <AgentRow key={agent.name} agent={agent} />
        ))}
      </div>
    </div>
  );
}

function BullBear() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 700 }}>Bull vs bear</div>
        <Chip color={palette.muted}>5 adversarial challenges</Chip>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div
          style={{
            ...card,
            padding: "14px 16px",
            background: "linear-gradient(140deg, oklch(72% 0.16 155 / 0.06), transparent 60%)",
            borderColor: "oklch(72% 0.16 155 / 0.22)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: palette.yes }} />
            <span style={{ fontFamily: fontSans, fontSize: 12.5, fontWeight: 700, color: palette.yes }}>
              Bull case · 12 agents
            </span>
          </div>
          <div style={{ fontFamily: fontSans, fontSize: 11.5, color: palette.muted, lineHeight: 1.65 }}>
            Labor-market softening is accelerating. CPI has printed below 2.5% for three
            straight months, and the dot plot shifted dovish. Four of five similar setups
            cut within 90 days.
          </div>
        </div>

        <div
          style={{
            ...card,
            padding: "14px 16px",
            background: "linear-gradient(140deg, oklch(65% 0.18 25 / 0.05), transparent 60%)",
            borderColor: "oklch(65% 0.18 25 / 0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: palette.no }} />
            <span style={{ fontFamily: fontSans, fontSize: 12.5, fontWeight: 700, color: palette.no }}>
              Bear case · 2 agents
            </span>
          </div>
          <div style={{ fontFamily: fontSans, fontSize: 11.5, color: palette.muted, lineHeight: 1.65 }}>
            An energy supply shock from Iran tensions could re-accelerate headline inflation.
            Sticky services inflation remains the main risk if housing costs do not normalize.
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 10,
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontFamily: fontSans, fontSize: 11.5, color: palette.muted }}>
          Cross-examination: bull thesis survived{" "}
          <span style={{ color: palette.fg, fontWeight: 600 }}>4 of 5</span> challenges
        </span>
        <div style={{ display: "flex", gap: 5 }}>
          {[true, true, true, true, false].map((passed, i) => (
            <span
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: passed ? palette.yes : palette.no,
                opacity: passed ? 0.9 : 0.55,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BottomLine() {
  return (
    <div style={{ ...card, padding: "18px 20px", background: "linear-gradient(135deg, oklch(62% 0.18 295 / 0.07), transparent 55%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <SparkleIcon size={15} />
        <span style={{ fontFamily: fontSans, fontSize: 14, fontWeight: 700 }}>Bottom line</span>
      </div>
      <div style={{ fontFamily: fontSans, fontSize: 13, color: palette.fg, lineHeight: 1.6, maxWidth: 880 }}>
        Buy YES in the <span style={{ fontFamily: fontMono, color: palette.yes }}>60–64¢</span> zone.
        Labor-market softening and three months of sub-2.5% CPI outweigh the energy-shock tail.
        Invalidate the thesis below <span style={{ fontFamily: fontMono }}>55¢</span> or on a CPI print
        above 2.7%.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Chip>Catalyst · CPI Thu 8:30am</Chip>
        <Chip>Horizon · Sep 16, 2026</Chip>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)">
          Re-check after CPI
        </Chip>
      </div>
    </div>
  );
}

function TradePlan({ frame }: { frame: number }) {
  const highlight = interpolate(frame, [330, 352], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const pulse = (Math.sin(frame * 0.18) + 1) / 2;

  return (
    <div
      style={{
        ...card,
        padding: "18px 18px 16px",
        borderColor: `oklch(72% 0.16 155 / ${0.24 + highlight * 0.5})`,
        boxShadow: `0 0 ${highlight * (26 + pulse * 10)}px -8px oklch(72% 0.16 155 / ${highlight * 0.55})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: fontSans, fontSize: 14, fontWeight: 700 }}>Trade plan</span>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.12)" border="oklch(72% 0.16 155 / 0.32)">
          LONG YES
        </Chip>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["Entry zone", "60–64¢"],
          ["Stop", "54¢"],
          ["Target", "78¢"],
          ["Size", "4.5%"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              borderRadius: 9,
              border: `1px solid ${palette.border}`,
              background: palette.bg,
              padding: "9px 11px",
            }}
          >
            <div style={{ fontFamily: fontSans, fontSize: 9.5, color: palette.muted, marginBottom: 3 }}>
              {label}
            </div>
            <div style={{ fontFamily: fontMono, fontSize: 15, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 12,
          paddingTop: 11,
          borderTop: `1px solid ${palette.border}`,
          fontFamily: fontMono,
          fontSize: 10,
          color: palette.muted,
        }}
      >
        <span>R:R 2.1x</span>
        <span>Risk $112 of $2,500</span>
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontFamily: fontSans,
          fontSize: 10.5,
          color: highlight > 0.3 ? palette.yes : palette.muted,
          opacity: 0.55 + highlight * 0.45,
        }}
      >
        <CheckIcon size={11} />
        Auto-invalidate below 55¢
      </div>
    </div>
  );
}

function RightRail({ frame }: { frame: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <TradePlan frame={frame} />

      <div style={{ ...card, padding: "14px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700 }}>Consensus</span>
          <span style={{ fontFamily: fontMono, fontSize: 10.5, color: palette.yes }}>12 / 14</span>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: palette.surface2, display: "flex", gap: 3 }}>
          {AGENT_FINDINGS.map((agent, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                borderRadius: 999,
                background: agent.signal === "bear" ? palette.no : palette.yes,
                opacity: agent.signal === "bear" ? 0.55 : 0.85,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: fontSans, fontSize: 10.5 }}>
          <span style={{ color: palette.muted }}>Disagreement</span>
          <span style={{ color: palette.fg }}>Low · 18%</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: fontSans, fontSize: 10.5 }}>
          <span style={{ color: palette.muted }}>Confidence band</span>
          <span style={{ fontFamily: fontMono, color: palette.fg }}>66–76%</span>
        </div>
      </div>

      <div style={{ ...card, padding: "14px 18px" }}>
        <div style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Catalysts</div>
        {[
          ["CPI print", "Thu · 8:30am"],
          ["FOMC decision", "Sep 16"],
          ["Invalidation", "> 2.7% CPI"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 0",
              borderTop: `1px solid ${palette.border}`,
              fontFamily: fontMono,
              fontSize: 10,
            }}
          >
            <span style={{ color: palette.muted }}>{label}</span>
            <span style={{ color: palette.fg }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: "12px 18px" }}>
        <div style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Risk checks</div>
        {["Stop-loss set at 54¢", "Max position 4.5% of capital", "Session loss limit armed"].map(
          (check) => (
            <div
              key={check}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: fontSans,
                fontSize: 10.5,
                color: palette.muted,
                padding: "4px 0",
              }}
            >
              <CheckIcon size={11} />
              {check}
            </div>
          )
        )}
      </div>

    </div>
  );
}

export function AnalysisReport({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();

  const scroll = interpolate(frame, [SCROLL_START, SCROLL_END], [0, SCROLL_MAX], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });

  const enter = interpolate(frame, [0, 12], [0, 1], clamp);
  const exit = interpolate(frame, [402, 420], [0, 1], clamp);
  const cover = Math.max(1 - enter, exit);

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
          left: "42%",
          top: -300,
          width: 900,
          height: 540,
          borderRadius: 999,
          background: "oklch(62% 0.2 260 / 0.13)",
          filter: "blur(120px)",
        }}
      />

      <AppNav active="Insights" credits="18 credits" />

      <div style={{ padding: "14px 56px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: fontSans, fontSize: 11.5, color: palette.muted }}>
          <span>Insights</span>
          <span style={{ opacity: 0.5 }}>›</span>
          <span>Economics</span>
          <span style={{ opacity: 0.5 }}>›</span>
          <span style={{ color: palette.fg }}>Fed Rate Cut</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: fontSans,
                fontSize: 27,
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              Will the Fed cut rates before September 2026?
            </h1>
            <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.1)" border="oklch(62% 0.18 295 / 0.28)">
              Analysis report
            </Chip>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Chip>Export PDF</Chip>
            <Chip color={palette.accent} bg="oklch(62% 0.2 260 / 0.1)" border="oklch(62% 0.2 260 / 0.3)">
              Re-run analysis
            </Chip>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8, fontFamily: fontMono, fontSize: 10.5, color: palette.muted }}>
          <span>#4821</span>
          <span style={{ width: 1, height: 12, background: palette.border }} />
          <span>Fed Rate Cut</span>
          <span style={{ width: 1, height: 12, background: palette.border }} />
          <span>Ends Sep 16, 2026</span>
          <span style={{ width: 1, height: 12, background: palette.border }} />
          <span style={{ color: palette.yes }}>12 / 14 agents aligned</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 196,
          left: 56,
          right: 56,
          bottom: 24,
          display: "grid",
          gridTemplateColumns: "1010px 414px",
          gap: 20,
        }}
      >
        <div style={{ position: "relative", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              transform: `translateY(${-scroll}px)`,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              paddingBottom: 36,
            }}
          >
            <VerdictCard />
            <ReasoningChain />
            <AgentFindings />
            <BullBear />
            <BottomLine />
          </div>

          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 2,
              borderRadius: 999,
              background: palette.border,
            }}
          >
            <div
              style={{
                width: "100%",
                height: `${(780 / (780 + SCROLL_MAX)) * 100}%`,
                borderRadius: 999,
                background: palette.borderStrong,
                transform: `translateY(${(scroll / SCROLL_MAX) * ((SCROLL_MAX / (780 + SCROLL_MAX)) * 780)}px)`,
              }}
            />
          </div>
        </div>

        <RightRail frame={frame} />
      </div>

      <AbsoluteFill style={{ background: palette.bg, opacity: cover, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
