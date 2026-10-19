'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Expandable } from '@/components/ui/Expandable';
import { InfoHint } from '@/components/ui/InfoHint';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { useAnalysisHistoryPaginated, useAnalysisDetail, type AnalysisResultSummary, type AnalysisResultDetail } from '@/hooks/useAnalysisResults';
import { useAllAnalysisProgress, type AnalysisProgress } from '@/hooks/useAnalysisProgress';
import { useAnalysisSubscriptions, useCancelAnalysisSubscription, type AnalysisSubscription } from '@/hooks/useAnalysisSubscriptions';
import { useSubscription } from '@/hooks/useSubscription';
import { useAgentAccuracy } from '@/hooks/useAgentAccuracy';
import useInfiniteScroll from '@/hooks/useInfiniteScroll';
import { cn } from '@/utils/classNames';

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

// Mock agent accuracy data (since useAgentSignals is legacy/empty)
const MOCK_AGENT_ACCURACY = [
  { name: 'Polling Intel', accuracy: 88 },
  { name: 'Historical Pattern', accuracy: 82 },
  { name: 'News Impact', accuracy: 79 },
  { name: 'Momentum', accuracy: 76 },
  { name: 'Sentiment', accuracy: 71 },
  { name: 'Tail Risk', accuracy: 64 },
];

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
    <div className="running-card-gradient rounded-[12px] p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="text-[0.9375rem] font-semibold flex items-center gap-2 min-w-0">
          <span className="w-9 h-9 rounded-[7px] bg-surface-2 flex items-center justify-center shrink-0 overflow-hidden">
            {marketMeta?.image ? (
              <img src={marketMeta.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-base">🔬</span>
            )}
          </span>
          <span className="line-clamp-2">{displayName}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-ai bg-ai/15 px-2 py-1 rounded shrink-0">
          <span className="w-2 h-2 border-[1.5px] border-ai border-t-transparent rounded-full animate-spin" />
          Analyzing
        </span>
      </div>

      {/* Mini pipeline - 11 fixed-width stage bars */}
      <div className="flex gap-1.5 items-center flex-wrap mb-2.5">
        {PIPELINE_STAGES.map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-7 h-1 rounded-sm',
              i < currentStage
                ? 'bg-ai'
                : i === currentStage
                  ? 'bg-ai animate-[stageBlink_1s_infinite]'
                  : 'bg-surface-2'
            )}
          />
        ))}
      </div>

      <p className="text-[0.7rem] text-muted mt-2.5">
        Stage {currentStage + 1} of {progress.totalStages} - {progress.stageName}
        {elapsed > 0 && ` · ${elapsed}s elapsed`}
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
    <Card className="p-4 sm:p-5 mb-4">
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
              <span className="text-sm sm:text-base">📊</span>
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
    </Card>
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
    <div className="animate-pulse rounded-[12px] border border-border bg-surface p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-2 mb-3">
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

// ─── Sidebar Cards ──────────────────────────────────────────────────────────

function CreditUsageCard() {
  const { data: subscription } = useSubscription();

  if (!subscription) {
    return (
      <Card className="p-4 sm:p-5 mb-4">
        <h3 className="text-[0.8125rem] font-semibold mb-4">Credit Usage</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-full rounded bg-surface-2" />
          <div className="h-1.5 w-full rounded bg-surface-2" />
          <div className="h-3 w-3/4 rounded bg-surface-2" />
        </div>
      </Card>
    );
  }

  const { creditsRemaining, creditsMonthlyLimit, billingCycleEnd, plan } = subscription;
  const usedThisMonth = creditsMonthlyLimit - creditsRemaining;
  const usagePercent = plan === 'elite' ? 100 : Math.min(100, (usedThisMonth / creditsMonthlyLimit) * 100);
  const resetDate = new Date(billingCycleEnd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <Card className="p-4 sm:p-5 mb-4">
      <h3 className="text-[0.8125rem] font-semibold mb-3 sm:mb-4">Credit Usage</h3>
      <div className="space-y-2.5 sm:space-y-3">
        <div className="flex justify-between text-[0.75rem] sm:text-[0.8rem]">
          <span className="text-muted">Balance</span>
          <span className="font-mono tabular-nums">
            {plan === 'elite' ? '∞' : `${creditsRemaining} / ${creditsMonthlyLimit}`}
          </span>
        </div>
        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-ai transition-[width] duration-300"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[0.75rem] sm:text-[0.8rem]">
          <span className="text-muted">Used this month</span>
          <span className="font-mono tabular-nums">{usedThisMonth}</span>
        </div>
        <div className="flex justify-between text-[0.75rem] sm:text-[0.8rem]">
          <span className="text-muted">Resets</span>
          <span className="font-mono tabular-nums">{resetDate}</span>
        </div>
      </div>
    </Card>
  );
}

function AgentAccuracyCard() {
  const { data, isLoading } = useAgentAccuracy();
  const agents = data?.agents ?? [];

  // Fallback to mock data only when the API returns empty (no resolved markets yet)
  const displayAgents = agents.length > 0
    ? agents
    : MOCK_AGENT_ACCURACY.map((a) => ({
        name: a.name,
        accuracy: a.accuracy,
        totalSignals: 0,
        correctSignals: 0,
        avgConfidence: 0,
        lastUpdatedAt: '',
      }));

  const isRealData = agents.length > 0;

  return (
    <Card className="p-4 sm:p-5 mb-4">
      <h3 className="text-[0.8125rem] font-semibold mb-3 sm:mb-4">
        Agent Accuracy (30d)
        {!isRealData && !isLoading && (
          <span className="ml-1.5 text-[0.6rem] font-normal text-muted">(estimated)</span>
        )}
      </h3>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse flex items-center gap-2 py-1.5">
              <div className="h-3 w-20 rounded bg-surface-2 flex-1" />
              <div className="h-1 w-12 rounded bg-surface-2" />
              <div className="h-3 w-8 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0">
          {displayAgents.map((agent) => (
            <div
              key={agent.name}
              className="flex items-center gap-2 sm:gap-2.5 py-1.5 sm:py-2 border-b border-border/50 last:border-b-0"
            >
              <span className="text-[0.7rem] sm:text-[0.75rem] flex-1 truncate">{agent.name}</span>
              <div className="w-10 sm:w-12 h-1 bg-surface-2 rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-ai rounded-full"
                  style={{ width: `${agent.accuracy}%` }}
                />
              </div>
              <span className="font-mono text-[0.7rem] sm:text-[0.75rem] font-semibold text-yes tabular-nums w-8 text-right shrink-0">
                {Math.round(agent.accuracy)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {isRealData && agents.length > 0 && (
        <p className="text-[0.6rem] text-muted mt-2 pt-2 border-t border-border/50">
          Based on {agents.reduce((sum, a) => sum + a.totalSignals, 0)} total signals across resolved recommendations
        </p>
      )}
    </Card>
  );
}

function UpcomingAnalysesSection() {
  const { data: subscriptions, isLoading } = useAnalysisSubscriptions();
  const { mutate: cancelSubscription, isPending: isCancelling } = useCancelAnalysisSubscription();

  // Only visible on mobile/tablet (hidden on desktop where sidebar shows the same data)
  if (isLoading) {
    return (
      <section className="mb-6 lg:hidden">
        <h2 className="text-[0.75rem] text-muted uppercase tracking-wider font-semibold mb-3">
          Upcoming Analyses
        </h2>
        <Card className="p-4 sm:p-5 animate-pulse">
          <div className="h-10 rounded bg-surface-2 mb-2" />
          <div className="h-10 rounded bg-surface-2" />
        </Card>
      </section>
    );
  }

  if (!subscriptions || subscriptions.length === 0) return null;

  return (
    <section className="mb-6 lg:hidden">
      <h2 className="text-[0.75rem] text-muted uppercase tracking-wider font-semibold mb-3">
        Upcoming Analyses
        <span className="ml-2 text-[0.6rem] font-normal text-muted">
          {subscriptions.length} scheduled
        </span>
      </h2>
      <Card className="p-4 sm:p-5">
        <div className="space-y-0">
          {subscriptions.map((sub) => (
            <UpcomingDeliveryRow
              key={sub.id}
              subscription={sub}
              onCancel={() => cancelSubscription(sub.id)}
              isCancelling={isCancelling}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

function UpcomingDeliveriesCard() {
  const { data: subscriptions, isLoading } = useAnalysisSubscriptions();
  const { mutate: cancelSubscription, isPending: isCancelling } = useCancelAnalysisSubscription();

  if (isLoading) {
    return (
      <Card className="p-4 sm:p-5">
        <h3 className="text-[0.8125rem] font-semibold mb-4">Upcoming Analyses</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-10 rounded bg-surface-2" />
          <div className="h-10 rounded bg-surface-2" />
          <div className="h-10 rounded bg-surface-2" />
        </div>
      </Card>
    );
  }

  if (!subscriptions || subscriptions.length === 0) {
    return (
      <Card className="p-4 sm:p-5">
        <h3 className="text-[0.8125rem] font-semibold mb-4">Upcoming Analyses</h3>
        <p className="text-[0.75rem] text-muted text-center py-3">
          No recurring analyses scheduled. Set one up from any market page.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="text-[0.8125rem] font-semibold mb-3 sm:mb-4">
        Upcoming Analyses
        <span className="ml-2 text-[0.65rem] font-normal text-muted">
          {subscriptions.length} active
        </span>
      </h3>
      <div className="space-y-0">
        {subscriptions.map((sub) => (
          <UpcomingDeliveryRow
            key={sub.id}
            subscription={sub}
            onCancel={() => cancelSubscription(sub.id)}
            isCancelling={isCancelling}
          />
        ))}
      </div>
    </Card>
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
    <div className="flex items-center gap-2 py-2.5 border-b border-border/50 last:border-b-0 group">
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
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[0.6rem] text-muted hover:text-no px-1.5 py-0.5 rounded"
          title="Cancel subscription"
          aria-label={`Cancel recurring analysis for ${displayName}`}
        >
          ✕
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

  return (
    <AppShell>
      {/* Page Header */}
      <div>
        <div className="flex items-center justify-between mb-5 sm:mb-6 gap-3">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
            AI Insights
          </h1>
          <Link href="/markets">
            <Button variant="ai" size="md" className="shrink-0 text-sm sm:text-base">
              <span className="hidden sm:inline">+ New Analysis</span>
              <span className="sm:hidden">+ Analyze</span>
            </Button>
          </Link>
        </div>

      {/* Upgrade Prompt */}
      {isFree && (
        <div className="mb-5 sm:mb-6">
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
        <div className="mb-5 sm:mb-6">
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

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] gap-5 sm:gap-6 items-start">
        {/* Left column */}
        <div>
          {/* Recent analyses */}
          <section>
            <h2 className="text-[0.75rem] text-muted uppercase tracking-wider font-semibold mb-3">
              Recent Analyses
            </h2>

            {/* Running analyses - shown at the top of the feed */}
            {runningAnalyses.length > 0 && runningAnalyses.map((progress) => (
              <RunningAnalysisCard
                key={progress.analysisId || progress.marketId}
                progress={progress}
              />
            ))}

            {/* Upcoming analyses (mobile-visible - sidebar hidden on mobile) */}
            <UpcomingAnalysesSection />

            {isLoading ? (
              <>
                <AnalysisCardSkeleton />
                <AnalysisCardSkeleton />
                <AnalysisCardSkeleton />
              </>
            ) : error ? (
              <Card className="p-8 text-center">
                <p className="text-muted mb-4">
                  {error instanceof Error
                    ? error.message
                    : 'Failed to load analyses'}
                </p>
                <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              </Card>
            ) : analyses.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted mb-2">No analyses yet</p>
                <p className="text-[0.75rem] text-muted">
                  Run your first analysis from any market page to see results here.
                </p>
              </Card>
            ) : (
              <>
                {analyses.map((analysis) => (
                  <AnalysisCard
                    key={analysis.analysisId}
                    analysis={analysis}
                  />
                ))}

                {/* Infinite scroll trigger */}
                {hasNextPage && (
                  <div ref={targetRef} className="py-4 text-center">
                    {isFetchingNextPage && (
                      <span className="text-[0.75rem] text-muted">
                        Loading more…
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* Right sidebar - sticky on desktop, hidden on mobile/tablet */}
        <aside className="hidden lg:block lg:sticky lg:top-[72px] space-y-0">
          <CreditUsageCard />
          <AgentAccuracyCard />
          <UpcomingDeliveriesCard />
        </aside>
      </div>

      {/* Mobile credit & schedule summary - visible only below lg */}
      <div className="lg:hidden mt-6 space-y-4">
        <CreditUsageCard />
        <AgentAccuracyCard />
      </div>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}
