'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Expandable } from '@/components/ui/Expandable';
import { InfoHint } from '@/components/ui/InfoHint';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { useAnalysisHistoryPaginated, useAnalysisDetail, type AnalysisResultSummary } from '@/hooks/useAnalysisResults';
import { useAllAnalysisProgress, type AnalysisProgress } from '@/hooks/useAnalysisProgress';
import { useAnalysisSubscriptions, useCancelAnalysisSubscription, type AnalysisSubscription } from '@/hooks/useAnalysisSubscriptions';
import { useSubscription } from '@/hooks/useSubscription';
import { useAgentAccuracy } from '@/hooks/useAgentAccuracy';
import useInfiniteScroll from '@/hooks/useInfiniteScroll';
import { cn } from '@/utils/classNames';
import { BarChart3, Lightbulb, Microscope, Plus, X } from 'lucide-react';

// ─── Constants ──────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'Market Ingestion',
  'Memory Retrieval',
  'Web Research',
  'Agent Selection',
  'Intelligence Agents',
  'Signal Fusion',
  'Thesis Construction',
  'Cross-Examination',
  'Consensus Engine',
  'Risk Philosophy',
  'Recommendation',
] as const;

const AGENT_ABBREVIATIONS: Record<string, string> = {
  'Polling Intel': 'P',
  'Polling Intelligence': 'PI',
  'Momentum': 'Mo',
  'News Impact': 'N',
  'Breaking News': 'BN',
  'Historical': 'H',
  'Historical Patterns': 'HP',
  'Sentiment': 'S',
  'Media Sentiment': 'MS',
  'Social Sentiment': 'SS',
  'Social': 'So',
  'Narrative': 'Na',
  'Narrative Velocity': 'NV',
  'Microstructure': 'Mi',
  'Market Microstructure': 'Mi',
  'Probability': 'Pr',
  'Probability Baseline': 'PB',
  'Catalyst': 'Ca',
  'Catalyst Identification': 'CI',
  'Mean Reversion': 'MR',
  'Tail Risk': 'TR',
  'Risk Assessment': 'RA',
  'Event Impact': 'EI',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRecommendationLabel(rec: string): string {
  switch (rec) {
    case 'LONG_YES': return 'BUY YES';
    case 'LONG_NO': return 'BUY NO';
    case 'NO_TRADE': return 'NO TRADE';
    default: return rec;
  }
}

function getRecommendationTone(rec: string): 'yes' | 'no' | 'warning' {
  switch (rec) {
    case 'LONG_YES': return 'yes';
    case 'LONG_NO': return 'no';
    case 'NO_TRADE': return 'warning';
    default: return 'warning';
  }
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Running Analysis Card ──────────────────────────────────────────────────

function RunningAnalysisCard({ progress, marketQuestion }: { progress: AnalysisProgress; marketQuestion?: string }) {
  const currentStage = progress.stage;
  const [elapsed, setElapsed] = useState(0);

  // Fetch market metadata (slug + image) for the running analysis
  const { data: marketMeta } = useMarketMeta(progress.marketId || '');

  useEffect(() => {
    const startTime = new Date(progress.timestamp).getTime();
    function tick() {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [progress.timestamp]);

  const displayName = marketQuestion
    || (progress.marketId ? `Market ${progress.marketId.slice(0, 8)}…` : 'Analysis');

  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
            {marketMeta?.image ? (
              <img src={marketMeta.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <Microscope className="h-4 w-4 text-ai" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold text-fg">{displayName}</p>
            <p className="mt-0.5 text-[0.6rem] text-muted">
              Stage {currentStage + 1} of {progress.totalStages}
              {elapsed > 0 ? ` · ${elapsed}s elapsed` : ''}
            </p>
          </div>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ai/30 bg-ai/10 px-2 py-1 text-[0.6rem] font-medium text-ai">
          <span className="h-2 w-2 animate-spin rounded-full border-[1.5px] border-ai border-t-transparent" />
          Analyzing
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1">
        {PIPELINE_STAGES.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < currentStage
                ? 'bg-ai'
                : i === currentStage
                  ? 'animate-[stageBlink_1s_infinite] bg-ai'
                  : 'bg-surface-2'
            )}
          />
        ))}
      </div>

      <p
        className="mt-1.5 text-[0.6rem] text-muted"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {progress.stageName}
      </p>
    </div>
  );
}

// ─── Analysis Result Card ───────────────────────────────────────────────────

interface MarketMeta {
  slug: string | null;
  image: string | null;
  clobTokenIds: string | null;
  outcomePrices: string | null;
}

function useMarketMeta(conditionId: string) {
  return useQuery<MarketMeta>({
    queryKey: ['market-meta', conditionId],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/market-by-condition?conditionId=${conditionId}`);
      if (!response.ok) return { slug: null, image: null, clobTokenIds: null, outcomePrices: null };
      const market = await response.json();
      return {
        slug: market?.market_slug || market?.slug || null,
        image: market?.image || market?.icon || null,
        clobTokenIds: market?.clobTokenIds || null,
        outcomePrices: market?.outcomePrices || null,
      };
    },
    enabled: !!conditionId,
    staleTime: 24 * 60 * 60 * 1000, // market metadata doesn't change often - cache 24h
    retry: 1,
  });
}

function AnalysisCard({
  analysis,
}: {
  analysis: AnalysisResultSummary;
}) {
  const recLabel = getRecommendationLabel(analysis.recommendation);
  const recTone = getRecommendationTone(analysis.recommendation);

  // Resolve condition_id → slug + image via CLOB API for proper routing and display
  const { data: marketMeta } = useMarketMeta(analysis.marketId);
  const marketHref = `/markets/${marketMeta?.slug || analysis.marketId}`;
  const marketImage = marketMeta?.image || null;

  // Fetch live token prices for current YES/NO display
  const { data: livePrices } = useQuery<{ yes: number; no: number } | null>({
    queryKey: ['insight-live-price', marketMeta?.clobTokenIds],
    queryFn: async () => {
      if (!marketMeta?.clobTokenIds) return null;
      const tokenIds = JSON.parse(marketMeta.clobTokenIds);
      if (!tokenIds[0]) return null;
      const response = await fetch('/api/polymarket/public-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds }),
      });
      if (!response.ok) return null;
      const priceMap = await response.json();
      const yesPrice = priceMap[tokenIds[0]]?.midPrice;
      if (yesPrice == null) return null;
      return { yes: Math.round(yesPrice * 100), no: Math.round((1 - yesPrice) * 100) };
    },
    enabled: !!marketMeta?.clobTokenIds,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Current live price (or fallback to outcomePrices from Gamma)
  const liveYesCents = livePrices?.yes ?? (() => {
    if (!marketMeta?.outcomePrices) return null;
    try {
      const prices = JSON.parse(marketMeta.outcomePrices);
      return prices[0] ? Math.round(parseFloat(prices[0]) * 100) : null;
    } catch { return null; }
  })();
  const liveNoCents = liveYesCents != null ? 100 - liveYesCents : null;

  // Fetch full detail for this analysis (lazy - TanStack Query handles caching)
  const { data: detail } = useAnalysisDetail(analysis.analysisId);

  // Use real data from detail when available, derive from summary as fallback
  const marketProb = detail?.metadata?.marketProbability ?? 0;
  const consensusProb = detail?.metadata?.consensusProbability ?? analysis.consensusProbability;
  const edge = detail?.metadata?.edge ?? (consensusProb - marketProb);
  const agentsUsed = detail?.metadata?.agentsUsed ?? [];
  const agentSignals = detail?.agentSignals ?? [];
  const bullThesis = detail?.bullThesis;
  const bearThesis = detail?.bearThesis;
  const crossExamination = detail?.crossExamination;

  // Convert to cents for display
  const aiCents = Math.round(consensusProb * 100);
  const marketCents = Math.round(marketProb * 100);
  const isNo = analysis.recommendation === 'LONG_NO';

  // Edge from the traded token's perspective:
  // Backend edge = consensus - market (always YES-space).
  // For LONG_NO, the trader's edge is the inverse (NO is underpriced → positive edge).
  const displayEdge = isNo ? -edge : edge;
  const displayEdgeCents = Math.round(Math.abs(edge) * 100);

  // For the edge visualization bar, show values in the traded token's space
  const barAiCents = isNo ? Math.round((1 - consensusProb) * 100) : aiCents;
  const barMarketCents = isNo ? Math.round((1 - marketProb) * 100) : marketCents;

  // Recurring badge from subscriptions data
  const { data: subscriptions } = useAnalysisSubscriptions();
  const activeSub = subscriptions?.find((s) => s.marketId === analysis.marketId && s.status === 'active');

  return (
    <article className="px-4 py-4 sm:px-5">
      {/* Top row: market name + recommendation pill */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <Link
          href={marketHref}
          className="text-[0.875rem] sm:text-[0.9375rem] font-semibold flex items-center gap-2 hover:text-accent transition-colors min-w-0"
        >
          <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0 overflow-hidden">
            {marketImage ? (
              <img src={marketImage} alt="" className="w-full h-full object-cover" />
            ) : (
              <BarChart3 className="h-4 w-4 text-muted" aria-hidden="true" />
            )}
          </span>
          <span className="line-clamp-2">{analysis.marketQuestion}</span>
        </Link>
        <Badge tone={recTone} size="sm" className="shrink-0">
          {recLabel}
        </Badge>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 sm:gap-4 text-[0.7rem] sm:text-[0.75rem] text-muted mb-3">
        {liveYesCents != null && (
          <span>
            Live:{' '}
            {isNo ? (
              <>
                <span className="font-mono text-no tabular-nums">{liveNoCents}¢</span>
                {' / '}
                <span className="font-mono text-yes tabular-nums">{liveYesCents}¢</span>
              </>
            ) : (
              <>
                <span className="font-mono text-yes tabular-nums">{liveYesCents}¢</span>
                {' / '}
                <span className="font-mono text-no tabular-nums">{liveNoCents}¢</span>
              </>
            )}
          </span>
        )}
        <span>
          Edge:{' '}
          <span className={cn(
            'font-mono tabular-nums',
            displayEdge > 0 ? 'text-yes' : displayEdge < 0 ? 'text-no' : 'text-muted'
          )}>
            {displayEdge > 0 ? '+' : displayEdge < 0 ? '-' : '~'}{displayEdgeCents}¢
          </span>
        </span>
        <span>
          Confidence:{' '}
          <span className="font-mono text-fg tabular-nums">
            {Math.round(analysis.confidence * 100)}%
          </span>
        </span>
        <span className="text-muted/80">{formatTimeAgo(analysis.executedAt)}</span>
        <span className="hidden xs:inline">
          Agents: <span className="font-mono text-fg tabular-nums">{agentsUsed.length || 14}</span>
        </span>
        {(analysis.wasCachedDelivery || activeSub) && (
          <span className="inline-flex items-center gap-1 text-accent bg-accent/8 px-2 py-0.5 rounded text-[0.6rem] sm:text-[0.65rem]">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {activeSub?.intervalSeconds ? `Every ${formatInterval(activeSub.intervalSeconds)}` : 'Recurring'}
          </span>
        )}
      </div>

      {/* Edge visualization */}
      <div className="mb-4">
        <div className="relative h-6 sm:h-8 bg-surface-2 rounded-lg overflow-hidden">
          {/* Edge fill - the zone between market and AI */}
          {analysis.recommendation !== 'NO_TRADE' && barMarketCents > 0 && (
            <div
              className={cn(
                'absolute top-0 h-full rounded-sm',
                displayEdge > 0
                  ? 'bg-gradient-to-r from-yes/20 to-yes/5'
                  : 'bg-gradient-to-r from-no/5 to-no/20'
              )}
              style={{
                left: `${Math.min(barMarketCents, barAiCents)}%`,
                width: `${Math.max(Math.abs(barAiCents - barMarketCents), 2)}%`,
              }}
            />
          )}
          {/* Market marker */}
          {barMarketCents > 0 && (
            <div
              className="absolute top-0 h-full w-[2px] bg-muted/80"
              style={{ left: `${barMarketCents}%` }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-muted border border-surface-2" />
            </div>
          )}
          {/* AI marker */}
          <div
            className="absolute top-0 h-full w-[2px] bg-ai shadow-[0_0_6px_var(--ai)]"
            style={{ left: `${barAiCents}%` }}
          >
            <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-ai border border-surface-2 shadow-[0_0_4px_var(--ai)]" />
          </div>
        </div>
        {/* Labels positioned directly under their markers */}
        <div className="relative h-4 mt-1">
          <span className="absolute left-0 text-[0.55rem] sm:text-[0.6rem] text-muted">0%</span>
          {analysis.recommendation === 'NO_TRADE' && Math.abs(edge) < 0.03 ? (
            <span
              className="absolute text-[0.55rem] sm:text-[0.6rem] text-muted font-medium -translate-x-1/2"
              style={{ left: `${Math.round((barMarketCents + barAiCents) / 2)}%` }}
            >
              <span className="hidden sm:inline">AI ≈ Market (no edge)</span>
              <span className="sm:hidden">No edge</span>
            </span>
          ) : (
            <>
              {barMarketCents > 0 && (
                <span
                  className="absolute text-[0.55rem] sm:text-[0.6rem] text-muted -translate-x-1/2"
                  style={{ left: `${barMarketCents}%` }}
                >
                  <span className="hidden sm:inline">Market{isNo ? ' (NO)' : ''} </span><span className="font-mono font-medium text-fg">{barMarketCents}¢</span>
                </span>
              )}
              <span
                className="absolute text-[0.55rem] sm:text-[0.6rem] text-ai font-medium -translate-x-1/2"
                style={{ left: `${barAiCents}%` }}
              >
                AI{isNo ? ' (NO)' : ''} <span className="font-mono">{barAiCents}¢</span>
              </span>
            </>
          )}
          <span className="absolute right-0 text-[0.55rem] sm:text-[0.6rem] text-muted">100%</span>
        </div>
      </div>

      {/* 14-agent consensus row - real data */}
      <div className="flex items-center gap-1.5 mb-1.5 text-[0.6rem] text-muted">
        Agent consensus
        <InfoHint label="What agent signals mean">
          Each circle is one agent. Green = leans YES, red = leans NO, grey =
          neutral. Tap or hover a circle to see the agent, its predicted outcome,
          and its confidence. Neutral agents are left out of the final signal.
        </InfoHint>
      </div>
      <div className="flex gap-0.5 sm:gap-1 flex-wrap mb-3">
        {agentSignals.length > 0 ? (
          agentSignals.map((signal) => {
            const isUp = signal.direction === 'YES';
            const isDown = signal.direction === 'NO';
            const abbrev = AGENT_ABBREVIATIONS[formatAgentDisplayName(signal.agentName)]
              || signal.agentName.slice(0, 2).toUpperCase();

            return (
              <div
                key={signal.agentName}
                className={cn(
                  'w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[0.5rem] sm:text-[0.55rem] font-bold border-[1.5px]',
                  isUp && 'border-yes text-yes bg-yes/8',
                  isDown && 'border-no text-no bg-no/8',
                  !isUp && !isDown && 'border-muted text-muted bg-muted/8'
                )}
                title={`${formatAgentDisplayName(signal.agentName)} - ${signal.direction} (${Math.round(signal.confidence * 100)}%)`}
              >
                {abbrev}
              </div>
            );
          })
        ) : (
          // Fallback: show placeholder dots when detail hasn't loaded
          Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-surface-2 animate-pulse"
            />
          ))
        )}
      </div>

      {/* Bull vs Bear debate (expandable) - real data */}
      {(bullThesis || bearThesis) ? (
        <Expandable summary="Bull vs Bear Debate" meta={formatTimeAgo(analysis.executedAt)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {bullThesis && (
              <div>
                <h5 className="text-[0.7rem] font-semibold text-yes mb-1">
                  Bull Case
                  {agentSignals.length > 0 && (
                    <span className="font-normal text-muted ml-1">
                      ({agentSignals.filter(s => s.direction === 'YES').length} agents)
                    </span>
                  )}
                </h5>
                <ul className="space-y-1">
                  {bullThesis.keyArguments.map((arg, i) => (
                    <li key={i} className="text-[0.7rem] sm:text-[0.75rem] text-muted leading-relaxed flex gap-1.5">
                      <span className="text-yes shrink-0">•</span>
                      <span>{arg}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {bearThesis && (
              <div>
                <h5 className="text-[0.7rem] font-semibold text-no mb-1">
                  Bear Case
                  {agentSignals.length > 0 && (
                    <span className="font-normal text-muted ml-1">
                      ({agentSignals.filter(s => s.direction === 'NO').length} agents)
                    </span>
                  )}
                </h5>
                <ul className="space-y-1">
                  {bearThesis.keyArguments.map((arg, i) => (
                    <li key={i} className="text-[0.7rem] sm:text-[0.75rem] text-muted leading-relaxed flex gap-1.5">
                      <span className="text-no shrink-0">•</span>
                      <span>{arg}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {crossExamination && (
            <div className="text-center mt-3 pt-2 border-t border-border/50 text-[0.65rem] sm:text-[0.7rem] text-muted">
              Cross-examination: Bull <span className="font-mono font-semibold text-yes">{crossExamination.bullScore}/10</span>
              {' · '}
              Bear <span className="font-mono font-semibold text-no">{crossExamination.bearScore}/10</span>
            </div>
          )}
        </Expandable>
      ) : analysis.recommendation === 'NO_TRADE' ? (
        <Expandable summary="Why No Trade" meta={formatTimeAgo(analysis.executedAt)}>
          <p className="text-[0.7rem] sm:text-[0.75rem] text-muted leading-relaxed">
            High disagreement among agents - insufficient conviction for a recommendation.
            {detail?.metadata?.disagreementIndex != null && (
              <span className="font-mono ml-1">
                (disagreement: {Math.round(detail.metadata.disagreementIndex * 100)}%)
              </span>
            )}
          </p>
        </Expandable>
      ) : null}
    </article>
  );
}

function formatAgentDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Skeleton Components ────────────────────────────────────────────────────

function AnalysisCardSkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-surface-2 shrink-0" />
          <div className="h-4 w-32 sm:w-48 rounded bg-surface-2" />
        </div>
        <div className="h-5 w-16 rounded bg-surface-2 shrink-0" />
      </div>
      <div className="flex flex-wrap gap-3 sm:gap-4 mb-3">
        <div className="h-3 w-14 sm:w-16 rounded bg-surface-2" />
        <div className="h-3 w-16 sm:w-20 rounded bg-surface-2" />
        <div className="h-3 w-12 sm:w-14 rounded bg-surface-2 hidden xs:block" />
      </div>
      <div className="h-6 sm:h-7 w-full rounded bg-surface-2 mb-3" />
      <div className="flex gap-0.5 sm:gap-1 flex-wrap">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

// ─── Summary & Upcoming ─────────────────────────────────────────────────────

function InsightsSummary({
  runningCount,
  analysisTotal,
}: {
  runningCount: number;
  analysisTotal: number;
}) {
  const { data: subscription } = useSubscription();
  const { data: accuracyData } = useAgentAccuracy();
  const agents = accuracyData?.agents ?? [];
  const totalSignals = agents.reduce((sum, agent) => sum + agent.totalSignals, 0);
  const avgAccuracy =
    totalSignals > 0
      ? agents.reduce((sum, agent) => sum + agent.accuracy * agent.totalSignals, 0) /
        totalSignals
      : null;

  const creditsLabel = subscription
    ? subscription.plan === 'elite'
      ? '∞'
      : `${subscription.creditsRemaining} / ${subscription.creditsMonthlyLimit}`
    : '-';
  const resetDate = subscription
    ? new Date(subscription.billingCycleEnd).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-4 sm:divide-y-0">
      <InsightStat
        label="Running now"
        value={String(runningCount)}
        caption={runningCount > 0 ? 'live analyses' : 'nothing running'}
        tone={runningCount > 0 ? 'ai' : 'fg'}
      />
      <InsightStat
        label="Analyses"
        value={String(analysisTotal)}
        caption="on record"
      />
      <InsightStat
        label="Credits"
        value={creditsLabel}
        caption={resetDate ? `resets ${resetDate}` : 'monthly balance'}
      />
      <InsightStat
        label="Agent accuracy"
        value={avgAccuracy != null ? `${Math.round(avgAccuracy)}%` : '-'}
        caption={avgAccuracy != null ? '30-day weighted' : 'awaiting resolved calls'}
        tone={
          avgAccuracy == null
            ? 'fg'
            : avgAccuracy >= 60
              ? 'yes'
              : avgAccuracy < 50
                ? 'no'
                : 'fg'
        }
      />
    </div>
  );
}

function InsightStat({
  label,
  value,
  caption,
  tone = 'fg',
}: {
  label: string;
  value: string;
  caption: string;
  tone?: 'fg' | 'yes' | 'no' | 'ai';
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[0.62rem] text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-bold tabular-nums',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'ai' && 'text-ai',
          tone === 'fg' && 'text-fg'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[0.55rem] text-muted">{caption}</p>
    </div>
  );
}

function UpcomingDeliveriesPanel() {
  const { data: subscriptions, isLoading } = useAnalysisSubscriptions();
  const { mutate: cancelSubscription, isPending: isCancelling } = useCancelAnalysisSubscription();

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-fg">Upcoming analyses</h2>
          <p className="text-[0.6rem] text-muted">Recurring runs you have scheduled</p>
        </div>
        {!isLoading && subscriptions && subscriptions.length > 0 && (
          <span className="font-mono text-[0.6rem] text-muted">
            {subscriptions.length} scheduled
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3 px-4 py-4">
          <div className="h-10 rounded bg-surface-2" />
          <div className="h-10 rounded bg-surface-2" />
          <div className="h-10 rounded bg-surface-2" />
        </div>
      ) : !subscriptions || subscriptions.length === 0 ? (
        <p className="px-4 py-5 text-center text-[0.65rem] leading-relaxed text-muted">
          No recurring analyses scheduled. Set one up from any market page.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {subscriptions.map((sub) => (
            <UpcomingDeliveryRow
              key={sub.id}
              subscription={sub}
              onCancel={() => cancelSubscription(sub.id)}
              isCancelling={isCancelling}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentAccuracyPanel() {
  const { data, isLoading } = useAgentAccuracy();
  const agents = data?.agents ?? [];
  const totalSignals = agents.reduce((sum, agent) => sum + agent.totalSignals, 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-fg">Agent accuracy</h2>
          <p className="text-[0.6rem] text-muted">30-day leaderboard</p>
        </div>
        {totalSignals > 0 && (
          <span className="font-mono text-[0.6rem] text-muted">
            {totalSignals} signals
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3 px-4 py-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-surface-2" />
              <div className="h-1 rounded-full bg-surface-2" />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="px-4 py-5 text-center text-[0.65rem] leading-relaxed text-muted">
          Accuracy appears after recommendations resolve against the market.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {agents.slice(0, 6).map((agent, index) => {
            const barColor =
              agent.accuracy >= 70
                ? 'bg-yes'
                : agent.accuracy >= 50
                  ? 'bg-ai'
                  : 'bg-no';
            const textColor =
              agent.accuracy >= 70
                ? 'text-yes'
                : agent.accuracy >= 50
                  ? 'text-fg'
                  : 'text-no';

            return (
              <div key={agent.name} className="flex items-center gap-2.5 px-4 py-2.5">
                <span className="w-4 shrink-0 text-right font-mono text-[0.55rem] text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.72rem] text-fg">
                      {formatAgentDisplayName(agent.name)}
                    </span>
                    <span className={cn('shrink-0 font-mono text-[0.65rem] font-semibold', textColor)}>
                      {Math.round(agent.accuracy)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn('h-full rounded-full', barColor)}
                      style={{ width: `${Math.min(agent.accuracy, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function UpcomingDeliveryRow({
  subscription,
  onCancel,
  isCancelling,
}: {
  subscription: AnalysisSubscription;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const [timeUntilNext, setTimeUntilNext] = useState<string>('');
  const { data: marketMeta } = useMarketMeta(subscription.marketId);
  const marketHref = `/markets/${marketMeta?.slug || subscription.marketId}`;

  useEffect(() => {
    function update() {
      if (!subscription.nextScheduledRun) {
        // Compute next delivery from interval if schedule not available
        if (subscription.intervalSeconds) {
          const createdMs = new Date(subscription.createdAt).getTime();
          const intervalMs = subscription.intervalSeconds * 1000;
          const elapsed = Date.now() - createdMs;
          const nextMs = createdMs + Math.ceil(elapsed / intervalMs) * intervalMs;
          const diff = nextMs - Date.now();
          setTimeUntilNext(diff > 0 ? formatCountdown(diff) : 'Due now');
        } else {
          setTimeUntilNext('-');
        }
        return;
      }

      const diff = new Date(subscription.nextScheduledRun).getTime() - Date.now();
      if (diff <= 0) {
        setTimeUntilNext('Due now');
      } else {
        setTimeUntilNext(formatCountdown(diff));
      }
    }

    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [subscription.nextScheduledRun, subscription.intervalSeconds, subscription.createdAt]);

  const intervalLabel = subscription.intervalSeconds
    ? formatInterval(subscription.intervalSeconds)
    : '';

  const displayName = subscription.marketQuestion
    || `Market ${subscription.marketId.slice(0, 8)}…`;

  return (
    <div className="group flex items-center gap-2 px-4 py-3 sm:px-5">
      <div className="flex-1 min-w-0">
        <Link
          href={marketHref}
          className="text-[0.75rem] font-medium truncate block hover:text-accent transition-colors"
          title={subscription.marketQuestion || subscription.marketId}
        >
          {displayName}
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[0.6rem] text-muted font-mono">
            Every {intervalLabel}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[0.65rem] font-mono text-ai whitespace-nowrap">
          {timeUntilNext}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isCancelling}
          className="rounded px-1.5 py-0.5 text-[0.6rem] text-muted opacity-60 transition-opacity hover:text-no group-hover:opacity-100"
          title="Cancel subscription"
          aria-label={`Cancel recurring analysis for ${displayName}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function formatCountdown(diffMs: number): string {
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `in ${days}d ${remainingHours}h` : `in ${days}d`;
}

function formatInterval(seconds: number): string {
  if (seconds >= 86400) return `${seconds / 86400}d`;
  if (seconds >= 3600) return `${seconds / 3600}h`;
  return `${seconds / 60}m`;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const { plan } = useCurrentPlan();
  const isFree = plan === 'free';

  // Running analysis progress (tracks ALL in-flight analyses simultaneously)
  const runningAnalyses = useAllAnalysisProgress();

  // Recent analyses with infinite scroll
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAnalysisHistoryPaginated();

  const { targetRef, resetFetching } = useInfiniteScroll(
    () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    { rootMargin: '200px' }
  );

  // Reset fetching state when new data arrives
  useEffect(() => {
    if (!isFetchingNextPage) {
      resetFetching();
    }
  }, [isFetchingNextPage, resetFetching]);

  const analyses: AnalysisResultSummary[] = (() => {
    const all = data?.pages.flatMap((page) => page.items ?? []).filter(Boolean) ?? [];
    const seen = new Set<string>();
    return all.filter((a) => {
      if (seen.has(a.analysisId)) return false;
      seen.add(a.analysisId);
      return true;
    });
  })();
  const analysisTotal = data?.pages[0]?.totalCount ?? analyses.length;

  return (
    <AppShell>
      <div className="w-full">
        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
                Insights
              </h1>
              <p className="mt-2 text-sm text-muted">
                Every AI run, the signals behind it, and what is queued next.
              </p>
            </div>

            <Link href="/markets" className="w-fit">
              <Button variant="ai" size="md" className="h-10">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New analysis
              </Button>
            </Link>
          </div>
        </header>

        {isFree && (
          <div className="mt-5">
            <UpgradePrompt
              variant="free-to-starter"
              message={
                <>
                  You&apos;re on the <strong>Free plan</strong> - one-time analysis
                  only. Upgrade to unlock recurring analysis and full debate access.
                </>
              }
            />
          </div>
        )}
        {plan === 'starter' && (
          <div className="mt-5">
            <UpgradePrompt
              variant="starter-to-pro"
              message={
                <>
                  Unlock <strong>sub-daily intervals</strong> (1h, 4h, 12h) and
                  priority queue with Pro.
                </>
              }
            />
          </div>
        )}

        <InsightsSummary
          runningCount={runningAnalyses.length}
          analysisTotal={analysisTotal}
        />

        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <aside className="contents min-w-0 lg:sticky lg:top-[72px] lg:col-start-2 lg:row-start-1 lg:block lg:self-start lg:space-y-4">
            <div className="order-1 lg:order-none">
              <UpcomingDeliveriesPanel />
            </div>
            <div className="order-3 lg:order-none">
              <AgentAccuracyPanel />
            </div>
          </aside>

          <div className="order-2 min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 lg:order-none">
            {runningAnalyses.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-ai/25 bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-ai/15 bg-ai/[0.04] px-4 py-3.5 sm:px-5">
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Live now</h2>
                    <p className="text-[0.6rem] text-muted">
                      Running the 14-agent pipeline
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ai/30 bg-ai/10 px-2 py-0.5 font-mono text-[0.6rem] text-ai">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
                    {runningAnalyses.length} running
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {runningAnalyses.map((progress) => (
                    <RunningAnalysisCard
                      key={progress.analysisId || progress.marketId}
                      progress={progress}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Recent analyses</h2>
                  <p className="text-[0.6rem] text-muted">
                    {analysisTotal} on record
                  </p>
                </div>
                <span className="hidden text-[0.6rem] text-muted sm:inline">
                  Newest first
                </span>
              </div>

              {isLoading ? (
                <div className="divide-y divide-border/60">
                  <AnalysisCardSkeleton />
                  <AnalysisCardSkeleton />
                  <AnalysisCardSkeleton />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <p className="text-sm text-muted">
                    {error instanceof Error ? error.message : 'Failed to load analyses'}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.location.reload()}
                  >
                    Retry
                  </Button>
                </div>
              ) : analyses.length === 0 ? (
                <EmptyState
                  icon={Lightbulb}
                  title="No analyses yet"
                  description="Run your first analysis from any market page to see results, signals, and reasoning here."
                  action={
                    <Link
                      href="/markets"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-border-strong hover:bg-surface-2"
                    >
                      Explore markets
                    </Link>
                  }
                />
              ) : (
                <>
                  <div className="divide-y divide-border/60">
                    {analyses.map((analysis) => (
                      <AnalysisCard key={analysis.analysisId} analysis={analysis} />
                    ))}
                  </div>

                  {hasNextPage && (
                    <div
                      ref={targetRef}
                      className="border-t border-border/60 py-4 text-center"
                    >
                      {isFetchingNextPage && (
                        <span className="text-[0.7rem] text-muted">Loading more…</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}
