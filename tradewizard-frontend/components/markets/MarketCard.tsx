'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Clock, Lock, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import {
  useAnalysisProgress,
  type AnalysisProgress,
} from '@/hooks/useAnalysisProgress';
import { cn } from '@/utils/classNames';
import {
  formatMarketEndDate,
  formatMarketVolume,
  formatTimeAgo,
  getYesProbability,
} from '@/utils/marketDisplay';
import type { PolymarketMarket } from '@/hooks/useMarkets';
import type { AnalysisResultSummary } from '@/hooks/useAnalysisResults';

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

export type MarketCardSide = 'yes' | 'no';

export interface MarketCardProps {
  market: PolymarketMarket;
  analysis?: AnalysisResultSummary | null;
  nextAnalysisIn?: string | null;
  onRequestAnalysis(marketId: string): void;
  onBuy(slug: string, side: MarketCardSide): void;
  /** `grid` is the multi-column card; `carousel` is the compact trending card. */
  variant?: 'grid' | 'carousel';
}

function InlineProgressBar({ progress }: { progress: AnalysisProgress }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = new Date(progress.timestamp).getTime();
    function tick() {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [progress.timestamp]);

  const currentStage = progress.stage;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ai/30 bg-gradient-to-r from-ai/[0.06] to-transparent p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-ai">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ai opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ai" />
          </span>
          Analyzing…
        </span>
        <span className="font-mono text-[0.6rem] tabular-nums text-muted">
          {elapsed}s · {currentStage}/{progress.totalStages}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        {PIPELINE_STAGES.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < currentStage
                ? 'bg-ai'
                : i === currentStage
                  ? 'animate-pulse bg-ai'
                  : 'bg-surface-2'
            )}
          />
        ))}
      </div>
      <p className="text-[0.6rem] text-muted" role="status" aria-live="polite" aria-atomic="true">
        {progress.stageName}
      </p>
    </div>
  );
}

export function MarketCard({
  market,
  analysis,
  nextAnalysisIn,
  onRequestAnalysis,
  onBuy,
  variant = 'grid',
}: MarketCardProps) {
  const compact = variant === 'carousel';
  const { has } = useCurrentPlan();
  const yesCents = getYesProbability(market);
  const noCents = 100 - yesCents;
  const imageUrl = market.image || market.icon;
  const marketKey = market.conditionId || market.id;
  const isClosed = market.closed === true;

  const progress = useAnalysisProgress({ marketId: marketKey });
  const isRunning = !!progress && progress.status === 'running';

  const hasAnalysis = !!analysis;
  const isYes = analysis?.recommendation === 'LONG_YES';
  const isNo = analysis?.recommendation === 'LONG_NO';
  const aiCents = hasAnalysis
    ? isNo
      ? Math.round((1 - analysis.consensusProbability) * 100)
      : Math.round(analysis.consensusProbability * 100)
    : 0;
  const edgeCents = hasAnalysis
    ? isNo
      ? Math.abs(aiCents - noCents)
      : Math.abs(aiCents - yesCents)
    : 0;
  const recLabel =
    analysis?.recommendation === 'LONG_YES'
      ? 'Buy Yes'
      : analysis?.recommendation === 'LONG_NO'
        ? 'Buy No'
        : 'No Trade';

  const borderClass = isRunning
    ? 'border-ai/40'
    : hasAnalysis
      ? 'border-ai/30 hover:border-ai/50'
      : 'border-border hover:border-border-strong';

  const cardClass = compact
    ? cn(
        'flex w-[260px] flex-shrink-0 flex-col overflow-hidden rounded-[12px] border bg-surface transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:w-[300px]',
        borderClass
      )
    : cn(
        'group flex flex-col gap-3 rounded-[12px] border bg-surface p-4 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5',
        borderClass
      );

  const statusBadge = (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider',
        isRunning ? 'bg-ai/15 text-ai' : 'bg-ai/10 text-ai'
      )}
    >
      {isRunning ? 'Analyzing' : hasAnalysis ? 'Analyzed' : 'AI Ready'}
    </span>
  );

  const priceValues = (
    <div className={cn('flex shrink-0 items-center gap-2', compact && 'gap-1.5')}>
      {isNo ? (
        <>
          <span className={cn('font-mono font-bold text-no tabular-nums', compact ? 'text-[1.125rem]' : 'text-sm')}>
            {noCents}¢
          </span>
          <span className="text-xs text-muted">/</span>
          <span className={cn('font-mono font-bold text-yes tabular-nums', compact ? 'text-[1.125rem]' : 'text-sm')}>
            {yesCents}¢
          </span>
        </>
      ) : (
        <>
          <span className={cn('font-mono font-bold text-yes tabular-nums', compact ? 'text-[1.125rem]' : 'text-sm')}>
            {yesCents}¢
          </span>
          <span className="text-xs text-muted">/</span>
          <span className={cn('font-mono font-bold text-no tabular-nums', compact ? 'text-[1.125rem]' : 'text-sm')}>
            {noCents}¢
          </span>
        </>
      )}
    </div>
  );

  const analyzedBody = analysis && (
    <>
      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border border-ai/20 bg-ai/[0.06] p-3',
          compact && 'gap-1.5 p-2.5'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'rounded px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide',
              compact && 'text-[0.625rem]',
              isYes && 'bg-yes/12 text-yes',
              isNo && 'bg-no/12 text-no',
              !isYes && !isNo && 'bg-surface-2 text-muted'
            )}
          >
            {recLabel}
          </span>
          <span className={cn('font-mono text-[0.6875rem] text-ai tabular-nums', compact && 'text-[0.625rem]')}>
            +{edgeCents}¢ edge · {aiCents}% AI
          </span>
        </div>
        <p
          className={cn(
            'text-[0.6875rem] leading-relaxed text-muted line-clamp-2',
            compact && 'text-[0.625rem] line-clamp-1'
          )}
        >
          {Math.round(analysis.confidence * 100)}% confidence · Analyzed{' '}
          {formatTimeAgo(analysis.executedAt)}
        </p>
      </div>

      <div className={cn('flex items-stretch gap-2', compact && 'gap-1.5')}>
        <button
          type="button"
          onClick={() => onBuy(market.slug, 'yes')}
          disabled={isClosed}
          className={cn(
            'flex-1 rounded-md font-semibold transition-colors',
            compact ? 'py-[0.4rem] text-[0.6875rem]' : 'py-2.5 text-[0.8rem]',
            isClosed
              ? 'cursor-not-allowed bg-surface-2 text-muted opacity-50'
              : isYes
                ? 'bg-yes text-white shadow-[0_2px_8px_oklch(72%_0.16_155_/_0.3)]'
                : 'bg-yes/12 text-yes hover:bg-yes/20'
          )}
        >
          {isYes && <Sparkles className="mr-1 inline h-3 w-3" aria-hidden="true" />}
          Buy Yes {yesCents}¢
        </button>
        <button
          type="button"
          onClick={() => onBuy(market.slug, 'no')}
          disabled={isClosed}
          className={cn(
            'flex-1 rounded-md font-semibold transition-colors',
            compact ? 'py-[0.4rem] text-[0.6875rem]' : 'py-2.5 text-[0.8rem]',
            isClosed
              ? 'cursor-not-allowed bg-surface-2 text-muted opacity-50'
              : isNo
                ? 'bg-no text-white shadow-[0_2px_8px_oklch(65%_0.18_25_/_0.3)]'
                : 'bg-no/12 text-no hover:bg-no/20'
          )}
        >
          {isNo && <Sparkles className="mr-1 inline h-3 w-3" aria-hidden="true" />}
          Buy No {noCents}¢
        </button>
        <button
          type="button"
          onClick={() => onRequestAnalysis(marketKey)}
          disabled={isClosed}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
            compact ? 'px-2.5 py-[0.4rem] text-[0.6rem]' : 'px-3 py-1.5 text-[0.65rem]',
            isClosed
              ? 'cursor-not-allowed border-border bg-surface-2 text-muted opacity-50'
              : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg'
          )}
          title={isClosed ? 'Market resolved' : 'Refresh analysis'}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {!compact && '1 cr'}
        </button>
      </div>

      {nextAnalysisIn && (
        <div
          className={cn(
            'flex items-center gap-2 pt-0.5 text-ai',
            compact ? 'text-[0.6rem]' : 'text-[0.675rem]'
          )}
        >
          <Clock className="h-3 w-3 opacity-70" aria-hidden="true" />
          Next analysis in{' '}
          <span className="font-mono font-semibold tabular-nums">{nextAnalysisIn}</span>
        </div>
      )}

      {!has('starter') && (
        <p className="whitespace-nowrap text-[0.675rem] text-muted">
          <Lock className="inline h-3 w-3 opacity-60" aria-hidden="true" /> Recurring
          analysis ·{' '}
          <Link href="/account/subscription" className="font-medium text-accent hover:underline">
            Upgrade to Starter+
          </Link>
        </p>
      )}
      {has('starter') && !has('pro') && !nextAnalysisIn && (
        <p className="whitespace-nowrap text-[0.675rem] text-muted">
          <Zap className="inline h-3 w-3 opacity-60" aria-hidden="true" /> Sub-daily
          intervals ·{' '}
          <Link href="/account/subscription" className="font-medium text-accent hover:underline">
            Go Pro
          </Link>
        </p>
      )}
    </>
  );

  const unanalyzedBody = (
    <>
      <button
        type="button"
        onClick={() => onRequestAnalysis(marketKey)}
        disabled={isClosed}
        className={cn(
          'flex w-full items-center justify-center gap-1.5 font-bold text-white transition-all',
          compact ? 'mt-1 rounded-[6px] py-2 text-[0.65rem]' : 'rounded-lg py-2.5 text-xs',
          isClosed
            ? 'cursor-not-allowed bg-surface-2 text-muted opacity-50'
            : 'hover:-translate-y-px'
        )}
        style={
          isClosed
            ? undefined
            : {
                background:
                  'linear-gradient(135deg, oklch(58% 0.22 295), oklch(55% 0.20 270))',
                boxShadow: '0 2px 12px oklch(58% 0.18 295 / .35)',
              }
        }
        aria-label={isClosed ? 'Market resolved' : `Get AI analysis for ${market.question}`}
      >
        {!isClosed && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        {isClosed ? 'Market Resolved' : 'Get Analysis'}
        {!isClosed && <span className="font-medium opacity-85">· 1 credit</span>}
      </button>

      <div className={cn('flex gap-2', compact && 'gap-1.5')}>
        <button
          type="button"
          onClick={() => onBuy(market.slug, 'yes')}
          disabled={isClosed}
          className={cn(
            'flex-1 rounded-md font-semibold transition-colors',
            compact ? 'rounded-[6px] py-[0.4rem] text-[0.6875rem]' : 'py-2 text-xs',
            isClosed
              ? 'cursor-not-allowed bg-surface-2 text-muted opacity-50'
              : 'bg-yes/12 text-yes hover:bg-yes/20'
          )}
          aria-label={`Buy Yes at ${yesCents} cents`}
        >
          Yes {yesCents}¢
        </button>
        <button
          type="button"
          onClick={() => onBuy(market.slug, 'no')}
          disabled={isClosed}
          className={cn(
            'flex-1 rounded-md font-semibold transition-colors',
            compact ? 'rounded-[6px] py-[0.4rem] text-[0.6875rem]' : 'py-2 text-xs',
            isClosed
              ? 'cursor-not-allowed bg-surface-2 text-muted opacity-50'
              : 'bg-no/12 text-no hover:bg-no/20'
          )}
          aria-label={`Buy No at ${noCents} cents`}
        >
          No {noCents}¢
        </button>
      </div>

      {!has('starter') && (
        <p className="whitespace-nowrap text-[0.675rem] text-muted">
          <Lock className="inline h-3 w-3 opacity-60" aria-hidden="true" /> Recurring
          analysis ·{' '}
          <Link href="/account/subscription" className="font-medium text-accent hover:underline">
            Upgrade to Starter+
          </Link>
        </p>
      )}
    </>
  );

  const body = isRunning ? (
    <InlineProgressBar progress={progress} />
  ) : hasAnalysis ? (
    analyzedBody
  ) : (
    unanalyzedBody
  );

  if (compact) {
    return (
      <div className={cardClass} style={{ scrollSnapAlign: 'start' }}>
        <div className="relative h-[120px] w-full overflow-hidden bg-gradient-to-br from-surface-2 to-surface sm:h-[140px]">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="block h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BarChart3 className="h-8 w-8 text-muted/50" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <span className="text-[0.625rem] font-medium uppercase tracking-wider text-muted">
            {market.eventTitle || 'Politics'}
          </span>
          <Link href={`/markets/${market.slug}`} className="hover:underline">
            <h3 className="line-clamp-2 text-[0.8125rem] font-semibold leading-[1.4]">
              {market.question}
            </h3>
          </Link>

          {(market.volume || market.endDate || market.endDateIso) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.65rem] text-muted">
              {market.volume && <span>{formatMarketVolume(market.volume)} vol</span>}
              {(market.endDate || market.endDateIso) && (
                <span>Ends {formatMarketEndDate(market.endDateIso || market.endDate)}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <ProbabilityBar cents={isNo ? noCents : yesCents} variant="thin" className="flex-1" />
            {priceValues}
          </div>

          <div className="flex flex-col gap-2 pt-1">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className="flex items-start gap-3">
        {imageUrl ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border sm:h-12 sm:w-12">
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-border sm:h-12 sm:w-12">
            <BarChart3 className="h-5 w-5 text-muted/60" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/markets/${market.slug}`} className="hover:underline">
            <h3 className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug">
              {market.question}
            </h3>
          </Link>
        </div>
        {statusBadge}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {market.eventTitle && <span className="max-w-[200px] truncate">{market.eventTitle}</span>}
        {market.volume && <span>{formatMarketVolume(market.volume)} vol</span>}
        {(market.endDate || market.endDateIso) && (
          <span>Ends {formatMarketEndDate(market.endDateIso || market.endDate)}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ProbabilityBar cents={isNo ? noCents : yesCents} variant="thick" className="flex-1" />
        {priceValues}
      </div>

      {body}
    </div>
  );
}
