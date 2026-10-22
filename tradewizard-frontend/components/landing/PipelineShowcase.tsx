"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import { ArrowRight, Check, Pause, Play, X } from "lucide-react";
import { AGENTS, PIPELINE_STAGES } from "@/constants/analysis";
import { cn } from "@/utils/classNames";

const STAGE_MS = 2400;

const EASE = [0.22, 1, 0.36, 1] as const;

function AnimatedNumber({
  value,
  suffix = "",
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) return;

    const duration = 1100;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, value]);

  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  );
}

function StageHeading({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted">{title}</span>
      {meta ? (
        <span className="font-mono text-[0.62rem] text-muted/80">{meta}</span>
      ) : null}
    </div>
  );
}

function DataCollectionStage() {
  const sources = [
    { name: "Price history", detail: "12,480 ticks", pct: 88 },
    { name: "Related markets", detail: "18 correlated", pct: 72 },
    { name: "Web + news research", detail: "64 sources", pct: 94 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="text-xs text-muted">Markets scanned</span>
          <div className="mt-1 flex items-baseline gap-2">
            <AnimatedNumber
              value={42}
              className="font-mono text-4xl font-semibold tracking-[-0.03em] text-fg"
            />
            <span className="font-mono text-xs text-muted">this cycle</span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-yes/25 bg-yes/10 px-2.5 py-1 font-mono text-[0.62rem] text-yes">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yes" />
          sources live
        </span>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {sources.map((source, index) => (
          <motion.div
            key={source.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 + index * 0.1, duration: 0.4, ease: EASE }}
            className="rounded-xl border border-border bg-bg/60 p-3.5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-fg">{source.name}</span>
              <span className="font-mono text-[0.65rem] text-muted">
                {source.detail}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${source.pct}%` }}
                transition={{ delay: 0.2 + index * 0.1, duration: 0.8, ease: EASE }}
                className="h-full rounded-full bg-gradient-to-r from-accent to-ai"
              />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 text-[0.68rem] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-yes" />
        Snapshot synced just now · no gaps in the window
      </div>
    </div>
  );
}

function AgentsStage() {
  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Independent agents" meta="14 / 14 returned" />

      <div className="mt-4 grid grid-cols-2 gap-2">
        {AGENTS.map((agent, index) => (
          <motion.div
            key={agent}
            initial={{ opacity: 0.24 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.04 + index * 0.05, duration: 0.35 }}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-ai/20 bg-ai/[0.035] px-2.5 py-2"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
            <span className="truncate text-[0.7rem] text-muted">{agent}</span>
          </motion.div>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between font-mono text-[0.62rem] text-muted">
          <span>Signals returned</span>
          <span className="text-yes">100%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ delay: 0.5, duration: 0.9, ease: EASE }}
            className="h-full rounded-full bg-gradient-to-r from-ai to-accent"
          />
        </div>
      </div>
    </div>
  );
}

function SignalFusionStage() {
  const signals = [
    { name: "Momentum", weight: 82, value: "0.82", tone: "yes" },
    { name: "Polling intelligence", weight: 74, value: "0.74", tone: "yes" },
    { name: "Microstructure", weight: 68, value: "0.68", tone: "yes" },
    { name: "Narrative velocity", weight: 61, value: "0.61", tone: "ai" },
    { name: "Tail risk (inverted)", weight: 36, value: "0.36", tone: "warning" },
  ] as const;

  const toneClass = {
    yes: "bg-yes",
    ai: "bg-ai",
    warning: "bg-warning",
  };

  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Weighted aggregate" meta="2 conflicts flagged" />

      <div className="mt-5 flex flex-col gap-3.5">
        {signals.map((signal, index) => (
          <div key={signal.name}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-fg">{signal.name}</span>
              <span className="font-mono text-[0.65rem] text-muted">
                {signal.value}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${signal.weight}%` }}
                transition={{ delay: 0.08 + index * 0.08, duration: 0.7, ease: EASE }}
                className={cn("h-full rounded-full", toneClass[signal.tone])}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[0.68rem] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        2 conflicts flagged · tail risk discounted, not ignored
      </div>

      <div className="mt-auto rounded-xl border border-accent/25 bg-accent/[0.06] p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="text-[0.68rem] text-muted">Aggregate probability</span>
            <div className="mt-0.5 flex items-baseline gap-2">
              <AnimatedNumber
                value={71}
                suffix="%"
                className="font-mono text-3xl font-semibold text-fg"
              />
              <span className="font-mono text-[0.62rem] text-muted">vs 62¢ market</span>
            </div>
          </div>
          <span className="rounded-full border border-border bg-surface px-2 py-1 font-mono text-[0.6rem] text-muted">
            disagreement 18% · low
          </span>
        </div>
      </div>
    </div>
  );
}

function ThesisStage() {
  const bull = [
    "Labor market is softening",
    "CPI below target for 3 months",
    "Dot plot shifted dovish",
  ];
  const bear = [
    "Energy shock could re-ignite CPI",
    "Services inflation still sticky",
  ];

  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Competing theses" meta="built independently" />

      <div className="mt-4 grid flex-1 grid-cols-2 gap-3">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="flex flex-col rounded-xl border border-yes/25 bg-yes/[0.05] p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-yes">Bull case</span>
            <span className="font-mono text-[0.6rem] text-muted">12 agents</span>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {bull.map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + index * 0.08, duration: 0.35 }}
                className="flex items-start gap-2 text-[0.72rem] leading-snug text-muted"
              >
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-yes" />
                {item}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: EASE }}
          className="flex flex-col rounded-xl border border-no/20 bg-no/[0.04] p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-no">Bear case</span>
            <span className="font-mono text-[0.6rem] text-muted">2 agents</span>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {bear.map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.08, duration: 0.35 }}
                className="flex items-start gap-2 text-[0.72rem] leading-snug text-muted"
              >
                <X className="mt-0.5 h-3 w-3 shrink-0 text-no" />
                {item}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="mt-3 flex items-center gap-4 rounded-lg border border-border bg-bg/60 px-3 py-2.5">
        <span className="text-[0.68rem] text-muted">Thesis strength</span>
        <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "72%" }}
            transition={{ delay: 0.35, duration: 0.7, ease: EASE }}
            className="h-full rounded-l-full bg-yes"
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "28%" }}
            transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
            className="h-full rounded-r-full bg-no/70"
          />
        </div>
        <span className="font-mono text-[0.62rem] text-yes">bull leads</span>
      </div>
    </div>
  );
}

function CrossExamStage() {
  const challenges = [
    { question: "Can sticky services inflation hold?", passed: true },
    { question: "Does an energy shock invalidate the cut?", passed: true },
    { question: "Is the market already pricing a cut?", passed: false },
    { question: "Is the dot plot signal credible?", passed: true },
    { question: "Is liquidity thin around CPI?", passed: true },
  ];

  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Adversarial review" meta="5 challenges" />

      <div className="mt-4 flex flex-col gap-2">
        {challenges.map((challenge, index) => (
          <motion.div
            key={challenge.question}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + index * 0.1, duration: 0.35 }}
            className="flex items-center gap-3 rounded-lg border border-border bg-bg/60 px-3 py-2.5"
          >
            <span className="font-mono text-[0.6rem] text-muted/70">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 text-[0.72rem] text-fg">
              {challenge.question}
            </span>
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full",
                challenge.passed
                  ? "bg-yes/15 text-yes"
                  : "bg-no/15 text-no"
              )}
            >
              {challenge.passed ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
        <span className="text-[0.7rem] text-muted">
          Bull thesis survived{" "}
          <span className="font-semibold text-fg">4 of 5</span> challenges
        </span>
        <div className="flex gap-1.5">
          {[true, true, true, true, false].map((passed, index) => (
            <motion.span
              key={index}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.55 + index * 0.06, type: "spring", stiffness: 300, damping: 18 }}
              className={cn(
                "h-2 w-2 rounded-full",
                passed ? "bg-yes" : "bg-no/60"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsensusStage() {
  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Final estimate" meta="confidence band 66–76%" />

      <div className="mt-4 rounded-xl border border-border bg-bg/60 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <span className="text-[0.68rem] text-muted">AI probability</span>
            <div className="flex items-baseline gap-2">
              <AnimatedNumber
                value={71}
                suffix="%"
                className="font-mono text-5xl font-semibold tracking-[-0.04em] text-fg"
              />
              <span className="font-mono text-[0.65rem] text-yes">+9¢ edge</span>
            </div>
          </div>
          <span className="rounded-full border border-yes/25 bg-yes/10 px-2.5 py-1 font-mono text-[0.6rem] text-yes">
            high confidence
          </span>
        </div>

        <div className="relative mt-4 h-8">
          <div className="absolute inset-x-0 top-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "71%" }}
              transition={{ delay: 0.25, duration: 0.9, ease: EASE }}
              className="h-full rounded-full bg-gradient-to-r from-accent to-yes"
            />
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.85, type: "spring", stiffness: 300, damping: 20 }}
            className="absolute top-1 h-6 w-[2px] -translate-x-1/2 rounded-full bg-fg"
            style={{ left: "71%" }}
          />
          <div className="absolute inset-x-0 top-6 flex justify-between font-mono text-[0.58rem] text-muted">
            <span>0%</span>
            <span>Market 62¢</span>
            <span className="text-yes">AI 71%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          ["Agents aligned", "12 / 14"],
          ["Disagreement", "18% · low"],
          ["Confidence", "82%"],
        ].map(([label, value], index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + index * 0.08, duration: 0.35 }}
            className="rounded-lg border border-border bg-bg/60 px-3 py-2"
          >
            <div className="text-[0.6rem] text-muted">{label}</div>
            <div className="mt-0.5 font-mono text-sm font-medium text-fg">
              {value}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 text-[0.68rem] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-yes" />
        Consensus reached · no forced trade
      </div>
    </div>
  );
}

function RecommendationStage() {
  return (
    <div className="flex h-full flex-col">
      <StageHeading title="Trade plan" meta="risk-adjusted" />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-yes/25 bg-yes/[0.06] px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-yes/35 bg-yes/15 px-2.5 py-1 text-xs font-bold text-yes">
            LONG YES
          </span>
          <span className="text-[0.7rem] text-muted">71% AI vs 62¢ market</span>
        </div>
        <span className="font-mono text-sm font-semibold text-yes">+9¢</span>
      </motion.div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {[
          ["Entry zone", "60–64¢"],
          ["Stop", "54¢"],
          ["Target", "78¢"],
          ["Size", "4.5%"],
        ].map(([label, value], index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + index * 0.08, duration: 0.35 }}
            className="rounded-lg border border-border bg-bg/60 px-3 py-2.5"
          >
            <div className="text-[0.6rem] text-muted">{label}</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-fg">
              {value}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[0.68rem] text-muted"
      >
        <Check className="h-3.5 w-3.5 shrink-0 text-yes" />
        Fails closed: no trade if edge &lt; 3¢ or disagreement &gt; 30%
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="mt-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-bg/60 px-3 py-2.5 text-[0.68rem] text-muted"
      >
        <span>After the call</span>
        <span className="font-mono text-[0.62rem] text-yes">
          monitor entry · stop · target every 60s
        </span>
      </motion.div>
    </div>
  );
}

const STAGE_VIEWS = [
  DataCollectionStage,
  AgentsStage,
  SignalFusionStage,
  ThesisStage,
  CrossExamStage,
  ConsensusStage,
  RecommendationStage,
] as const;

const REF_IDS = PIPELINE_STAGES.map((_, index) => `pipeline-stage-${index}`);

export function PipelineShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const inView = useInView(sectionRef, { once: true, amount: 0.2 });
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!inView || !playing || reducedMotion) return;

    const isLastStage = active === PIPELINE_STAGES.length - 1;
    const timer = window.setTimeout(
      () => {
        setActive((current) => (current + 1) % PIPELINE_STAGES.length);
      },
      isLastStage ? STAGE_MS + 1200 : STAGE_MS
    );

    return () => window.clearTimeout(timer);
  }, [active, inView, playing, reducedMotion]);

  const stage = PIPELINE_STAGES[active];
  const StageView = STAGE_VIEWS[active];
  const progress = active / (PIPELINE_STAGES.length - 1);

  function selectStage(index: number) {
    setActive(index);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = (index + 1) % PIPELINE_STAGES.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = (index - 1 + PIPELINE_STAGES.length) % PIPELINE_STAGES.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = PIPELINE_STAGES.length - 1;
    }

    if (next === null) return;
    event.preventDefault();
    selectStage(next);
    tabRefs.current[next]?.focus();
  }

  function handleControl() {
    setPlaying((current) => !current);
  }

  const controlLabel = playing ? "Pause" : "Play";
  const ControlIcon = playing ? Pause : Play;

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={sectionRef}
        className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,410px)_minmax(0,1fr)]"
      >
        <div className="order-1 lg:hidden">
          <div className="rounded-2xl border border-border bg-surface px-3 py-3">
            <div className="relative flex items-center justify-between">
              <div
                className="absolute left-[18px] right-[18px] top-1/2 h-px -translate-y-1/2 bg-border"
                aria-hidden="true"
              />
              <motion.div
                className="absolute left-[18px] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-accent via-ai to-yes"
                animate={{ width: `calc((100% - 36px) * ${progress})` }}
                transition={{ duration: 0.45, ease: EASE }}
                aria-hidden="true"
              />
              {PIPELINE_STAGES.map((item, index) => {
                const isActive = index === active;
                const isDone = index < active;

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => selectStage(index)}
                    aria-label={`Stage ${index + 1}: ${item.label}`}
                    aria-current={isActive ? "step" : undefined}
                    className={cn(
                      "relative z-10 flex h-9 w-9 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-full border font-mono text-[0.72rem] font-semibold transition-colors",
                      isActive
                        ? "border-accent bg-accent text-white shadow-[0_6px_18px_-8px_oklch(62%_0.20_260_/_0.8)]"
                        : isDone
                          ? "border-yes/30 bg-yes/10 text-yes"
                          : "border-border bg-surface text-muted"
                    )}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="order-3 hidden lg:order-1 lg:block">
          <div className="relative">
            <div className="absolute bottom-7 left-7 top-7 w-px bg-border" aria-hidden="true">
              <motion.div
                className="w-px bg-gradient-to-b from-accent via-ai to-yes"
                animate={{ height: `${Math.max(progress * 100, 2)}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>

            <div
              className="relative flex flex-col gap-1"
              role="tablist"
              aria-label="Analysis pipeline stages"
              aria-orientation="vertical"
            >
              {PIPELINE_STAGES.map((item, index) => {
                const isActive = index === active;
                const isDone = index < active;

                return (
                  <button
                    key={item.label}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    type="button"
                    role="tab"
                    id={REF_IDS[index]}
                    aria-selected={isActive}
                    aria-controls="pipeline-stage-panel"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => selectStage(index)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    className={cn(
                      "group relative flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors",
                      isActive ? "text-fg" : "text-muted hover:bg-surface/60"
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="pipeline-active-stage"
                        className="absolute inset-0 rounded-xl border border-accent/35 bg-surface shadow-[var(--shadow-sm)]"
                        transition={{ duration: 0.3, ease: EASE }}
                      />
                    )}

                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[0.62rem] font-semibold transition-colors",
                        isActive
                          ? "border-accent bg-accent text-white shadow-[0_6px_18px_-8px_oklch(62%_0.20_260_/_0.8)]"
                          : isDone
                            ? "border-yes/30 bg-yes/10 text-yes"
                            : "border-border bg-surface text-muted"
                      )}
                    >
                      {isDone ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        String(index + 1).padStart(2, "0")
                      )}
                    </span>

                    <span className="relative z-10 min-w-0">
                      <span
                        className={cn(
                          "block text-sm font-medium",
                          isActive ? "text-fg" : "text-muted"
                        )}
                      >
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[0.72rem] leading-snug text-muted/75">
                        {item.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="order-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)] lg:order-2">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">
                Stage {String(active + 1).padStart(2, "0")} / 07
              </div>
              <div className="mt-1 font-display text-lg font-semibold text-fg">
                {stage.label}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[0.6rem] text-muted">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    playing ? "animate-pulse bg-yes" : "bg-muted"
                  )}
                />
                {playing ? "running" : "paused"}
              </span>
              <button
                type="button"
                onClick={handleControl}
                aria-label={
                  playing
                    ? "Pause the pipeline animation"
                    : "Play the pipeline animation"
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[0.68rem] font-medium text-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                <ControlIcon className="h-3 w-3" aria-hidden="true" />
                {controlLabel}
              </button>
            </div>
          </div>

          <div className="h-px bg-border">
            <motion.div
              className="h-px bg-gradient-to-r from-accent via-ai to-yes"
              animate={{ width: `${((active + 1) / PIPELINE_STAGES.length) * 100}%` }}
              transition={{ duration: 0.45, ease: EASE }}
            />
          </div>

          <div
            id="pipeline-stage-panel"
            role="tabpanel"
            aria-labelledby={REF_IDS[active]}
            aria-live="polite"
            className="relative h-[420px] overflow-hidden p-5 sm:h-[440px] sm:p-6"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="h-full"
              >
                <StageView />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-5 py-2.5 font-mono text-[0.6rem] text-muted/70">
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            All 14 agents run on every analysis · no shortcuts
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
