import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, palette, themeCss, type Theme } from "../theme";
import { CheckIcon, SparkleIcon } from "../components/Logo";
import { AppBar, Chip, ProgressBar, StatusBar, mobileCard } from "./ui";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const SCROLL_MAX = 2580;

type Signal = "bull" | "bear";

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

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
      <span style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 700 }}>{title}</span>
      {meta ? <span style={{ fontFamily: fontMono, fontSize: 17, color: palette.muted }}>{meta}</span> : null}
    </div>
  );
}

function VerdictCard() {
  return (
    <div style={{ ...mobileCard, padding: "24px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.12)" border="oklch(72% 0.16 155 / 0.32)" fontSize={18}>
            LONG YES
          </Chip>
          <Chip fontSize={17}>82% confidence</Chip>
        </div>
        <span style={{ fontFamily: fontMono, fontSize: 16, color: palette.muted }}>#4821</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <span
            style={{
              fontFamily: fontMono,
              fontSize: 78,
              fontWeight: 700,
              letterSpacing: "-0.05em",
              lineHeight: 1,
              color: palette.fg,
            }}
          >
            71%
          </span>
          <div style={{ fontFamily: fontSans, fontSize: 19, color: palette.muted, marginTop: 5 }}>
            AI probability · band 66–76%
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, paddingBottom: 4 }}>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 16, color: palette.muted }}>Market</div>
            <div style={{ fontFamily: fontMono, fontSize: 30, fontWeight: 600 }}>62¢</div>
          </div>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 16, color: palette.muted }}>Edge</div>
            <div style={{ fontFamily: fontMono, fontSize: 30, fontWeight: 600, color: palette.yes }}>+9¢</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ position: "relative", height: 20 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 9, borderRadius: 999, background: palette.surface2, overflow: "hidden" }}>
            <div style={{ width: "71%", height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${palette.accent}, ${palette.yes})` }} />
          </div>
          <div style={{ position: "absolute", left: "62%", top: 2, width: 3, height: 16, marginLeft: -1.5, background: palette.fg, opacity: 0.75 }} />
          <div style={{ position: "absolute", left: "71%", top: 2, width: 15, height: 15, marginLeft: -7.5, borderRadius: 999, background: palette.yes, border: `3px solid ${palette.bg}` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: fontMono, fontSize: 15, color: palette.muted }}>
          <span>0%</span>
          <span>Market 62¢</span>
          <span style={{ color: palette.yes }}>AI 71%</span>
          <span>100%</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {[
          ["Agents", "12 / 14"],
          ["Disagreement", "18% · low"],
          ["Confidence", "82%"],
        ].map(([label, value]) => (
          <div key={label} style={{ flex: 1, borderRadius: 12, border: `1px solid ${palette.border}`, background: palette.bg, padding: "10px 12px" }}>
            <div style={{ fontFamily: fontSans, fontSize: 15, color: palette.muted }}>{label}</div>
            <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradePlanCard() {
  return (
    <div style={{ ...mobileCard, padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontFamily: fontSans, fontSize: 27, fontWeight: 700 }}>Trade plan</span>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.12)" border="oklch(72% 0.16 155 / 0.32)" fontSize={17}>
          LONG YES
        </Chip>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          ["Entry zone", "60–64¢"],
          ["Stop", "54¢"],
          ["Target", "78¢"],
          ["Size", "4.5%"],
        ].map(([label, value]) => (
          <div key={label} style={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: palette.bg, padding: "10px 14px" }}>
            <div style={{ fontFamily: fontSans, fontSize: 15, color: palette.muted }}>{label}</div>
            <div style={{ fontFamily: fontMono, fontSize: 26, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${palette.border}`, fontFamily: fontMono, fontSize: 16, color: palette.muted }}>
        <span>R:R 2.1x</span>
        <span>Risk $112 of $2,500</span>
      </div>
    </div>
  );
}

function ReasoningChain() {
  const steps = [
    ["14 agents", "Independent reads"],
    ["Signal fusion", "Weighted + conflicts"],
    ["5 stress tests", "Adversarial review"],
    ["Consensus", "71% · 66–76%"],
  ];
  return (
    <div>
      <SectionTitle title="The reasoning chain" meta="11 stages" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {steps.map(([title, detail], index) => (
          <div
            key={title}
            style={{
              borderRadius: 12,
              border: `1px solid ${index === steps.length - 1 ? "oklch(72% 0.16 155 / 0.3)" : palette.border}`,
              background: index === steps.length - 1 ? "oklch(72% 0.16 155 / 0.07)" : palette.surface,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 600 }}>{title}</div>
            <div style={{ fontFamily: fontMono, fontSize: 15, color: palette.muted, marginTop: 3 }}>{detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentFindings() {
  return (
    <div>
      <SectionTitle title="What each agent found" meta="14 signals" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AGENT_FINDINGS.map((agent) => {
          const color = agent.signal === "bull" ? palette.yes : palette.no;
          return (
            <div
              key={agent.name}
              style={{
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.bg,
                padding: "10px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontFamily: fontSans, fontSize: 21, fontWeight: 600 }}>{agent.name}</span>
                <Chip
                  color={color}
                  bg={agent.signal === "bull" ? "oklch(72% 0.16 155 / 0.1)" : "oklch(65% 0.18 25 / 0.1)"}
                  border={agent.signal === "bull" ? "oklch(72% 0.16 155 / 0.28)" : "oklch(65% 0.18 25 / 0.28)"}
                  fontSize={15}
                >
                  {agent.signal === "bull" ? "Bullish" : "Bearish"}
                </Chip>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 5 }}>
                <span style={{ flex: 1, fontFamily: fontSans, fontSize: 17, color: palette.muted }}>{agent.note}</span>
                <span style={{ fontFamily: fontMono, fontSize: 16, color }}>{agent.confidence}%</span>
              </div>
              <div style={{ marginTop: 7 }}>
                <ProgressBar value={agent.confidence} color={color} height={5} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BullBear() {
  return (
    <div>
      <SectionTitle title="Bull vs bear" meta="4 of 5 survived" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...mobileCard, padding: "18px 20px", borderColor: "oklch(72% 0.16 155 / 0.24)", background: "linear-gradient(140deg, oklch(72% 0.16 155 / 0.06), transparent 65%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 700, color: palette.yes }}>Bull case</span>
            <span style={{ fontFamily: fontMono, fontSize: 16, color: palette.muted }}>12 agents</span>
          </div>
          <div style={{ fontFamily: fontSans, fontSize: 18, lineHeight: 1.5, color: palette.muted, marginTop: 8 }}>
            Labor-market softening is accelerating. CPI has printed below 2.5% for three
            straight months, and the dot plot shifted dovish.
          </div>
        </div>
        <div style={{ ...mobileCard, padding: "18px 20px", borderColor: "oklch(65% 0.18 25 / 0.22)", background: "linear-gradient(140deg, oklch(65% 0.18 25 / 0.05), transparent 65%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 700, color: palette.no }}>Bear case</span>
            <span style={{ fontFamily: fontMono, fontSize: 16, color: palette.muted }}>2 agents</span>
          </div>
          <div style={{ fontFamily: fontSans, fontSize: 18, lineHeight: 1.5, color: palette.muted, marginTop: 8 }}>
            An energy supply shock could re-accelerate inflation. Services inflation
            remains sticky if housing costs do not normalize.
          </div>
        </div>
      </div>
    </div>
  );
}

function CrossExam() {
  const challenges = [
    ["Sticky services inflation", true],
    ["Energy supply shock", true],
    ["Market already pricing a cut", false],
    ["Dot plot credibility", true],
    ["Liquidity around CPI", true],
  ] as const;

  return (
    <div>
      <SectionTitle title="Cross-examination" meta="5 challenges" />
      <div style={{ ...mobileCard, padding: "14px 16px" }}>
        {challenges.map(([label, passed]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 0",
              borderTop: `1px solid ${palette.border}`,
            }}
          >
            <span style={{ flex: 1, fontFamily: fontSans, fontSize: 18, color: palette.fg }}>{label}</span>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: passed ? "oklch(72% 0.16 155 / 0.14)" : "oklch(65% 0.18 25 / 0.14)",
                color: passed ? palette.yes : palette.no,
              }}
            >
              {passed ? <CheckIcon size={16} /> : <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomLine() {
  return (
    <div style={{ ...mobileCard, padding: "20px 22px", background: "linear-gradient(135deg, oklch(62% 0.18 295 / 0.08), transparent 60%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        <SparkleIcon size={20} />
        <span style={{ fontFamily: fontSans, fontSize: 24, fontWeight: 700 }}>Bottom line</span>
      </div>
      <div style={{ fontFamily: fontSans, fontSize: 20, lineHeight: 1.55, color: palette.fg }}>
        Buy YES in the <span style={{ fontFamily: fontMono, color: palette.yes }}>60–64¢</span> zone.
        Labor-market softening and three months of sub-2.5% CPI outweigh the energy-shock
        tail. Invalidate below <span style={{ fontFamily: fontMono }}>55¢</span> or on a CPI print
        above 2.7%.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <Chip fontSize={16}>CPI Thu · 8:30am</Chip>
        <Chip fontSize={16}>Horizon · Sep 16</Chip>
        <Chip color={palette.yes} bg="oklch(72% 0.16 155 / 0.1)" border="oklch(72% 0.16 155 / 0.28)" fontSize={16}>
          Re-check after CPI
        </Chip>
      </div>
    </div>
  );
}

export function AnalysisReportMobile({ theme = "dark" }: { theme?: Theme }) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], clamp);
  const exit = interpolate(frame, [400, 420], [1, 0], clamp);
  const scroll = interpolate(frame, [60, 390], [0, SCROLL_MAX], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });

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

        <div style={{ position: "absolute", top: 142, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              transform: `translateY(${-scroll}px)`,
              padding: "12px 32px 60px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: fontSans, fontSize: 17, color: palette.muted }}>Insights</span>
                <span style={{ color: palette.muted, opacity: 0.5 }}>›</span>
                <span style={{ fontFamily: fontSans, fontSize: 17, color: palette.fg }}>Fed Rate Cut</span>
                <Chip color={palette.ai} bg="oklch(62% 0.18 295 / 0.1)" border="oklch(62% 0.18 295 / 0.28)" fontSize={15}>
                  analysis report
                </Chip>
              </div>
              <h1 style={{ margin: "10px 0 0", fontFamily: fontSans, fontSize: 39, lineHeight: 1.1, letterSpacing: "-0.035em", fontWeight: 700 }}>
                Will the Fed cut rates before September 2026?
              </h1>
              <div style={{ display: "flex", gap: 12, marginTop: 10, fontFamily: fontMono, fontSize: 15, color: palette.muted }}>
                <span>#4821</span>
                <span>14 agents</span>
                <span>52s</span>
                <span style={{ color: palette.yes }}>12 / 14 aligned</span>
              </div>
            </div>

            <VerdictCard />
            <TradePlanCard />
            <ReasoningChain />
            <AgentFindings />
            <BullBear />
            <CrossExam />
            <BottomLine />
          </div>

          <div style={{ position: "absolute", right: 8, top: 80, bottom: 80, width: 4, borderRadius: 999, background: palette.border }}>
            <div
              style={{
                width: "100%",
                height: "32%",
                borderRadius: 999,
                background: palette.borderStrong,
                transform: `translateY(${(scroll / SCROLL_MAX) * 560}px)`,
              }}
            />
          </div>

          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 28, background: `linear-gradient(${palette.bg}, transparent)` }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 50, background: `linear-gradient(transparent, ${palette.bg})` }} />
        </div>
      </div>

      <AbsoluteFill style={{ background: palette.bg, opacity: 1 - enter * exit, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
