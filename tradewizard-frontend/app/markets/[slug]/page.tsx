'use client';

import { useState, useMemo, useEffect, useId } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { Expandable } from '@/components/ui/Expandable';
import { InfoHint } from '@/components/ui/InfoHint';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';
import usePriceHistory, { type TimeRange, type PriceHistoryPoint } from '@/hooks/usePriceHistory';
import useOrderBook from '@/hooks/useOrderBook';
import { useMarketAnalysis, type MarketAnalysisResult } from '@/hooks/useMarketAnalysis';
import { useMarketAnalysisHistory } from '@/hooks/useMarketAnalysisHistory';
import { useAnalysisDetail } from '@/hooks/useAnalysisResults';
import { useMarketTradePerformance, type TradeOutcome } from '@/hooks/useMarketTradePerformance';
import { useAgentAccuracy } from '@/hooks/useAgentAccuracy';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/classNames';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  Flame,
  Scale,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { PolymarketMarket } from '@/hooks/useMarkets';

// Placeholder imports for components created in tasks 6.2–6.5
import { AIPanel } from '@/components/markets/AIPanel';
import { TradePanel, type TradeSide } from '@/components/markets/TradePanel';
import { AnalysisModal } from '@/components/markets/AnalysisModal';
import { PMActivationCard } from '@/components/markets/PMActivationCard';
import { Modal } from '@/components/ui/Modal';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getYesProbability(market: PolymarketMarket): number {
  if (market.realtimePrices) {
    const tokenIds = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : [];
    if (tokenIds[0] && market.realtimePrices[tokenIds[0]]) {
      return Math.round(market.realtimePrices[tokenIds[0]].midPrice * 100);
    }
  }
  if (market.outcomePrices) {
    try {
      const prices = JSON.parse(market.outcomePrices);
      if (prices[0]) return Math.round(parseFloat(prices[0]) * 100);
    } catch { }
  }
  return 50;
}

function formatVolume(vol: string | number | undefined): string {
  if (!vol) return '';
  const num = typeof vol === 'string' ? parseFloat(vol) : vol;
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function formatEndDate(date: string | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// Map display time ranges to hook TimeRange values
const TIME_RANGE_MAP: Record<string, TimeRange> = {
  '1H': '1H',
  '1D': '1D',
  '1W': '7D',
  '1M': '30D',
  ALL: '30D',
};

// ─── Market Masthead ────────────────────────────────────────────────────────

function ProbabilityRail({
  yesCents,
  aiCents,
  isClosed,
}: {
  yesCents: number;
  aiCents?: number | null;
  isClosed: boolean;
}) {
  const noCents = 100 - yesCents;

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-xs font-medium text-fg">Market probability</span>
        <span className="font-mono text-[0.65rem] text-muted">
          {isClosed ? 'Final' : 'Live'} · {yesCents}% YES
        </span>
      </div>

      <div className="relative mt-2.5 pt-6">
        {aiCents != null && (
          <div
            className="absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${Math.min(97, Math.max(3, aiCents))}%` }}
          >
            <span className="whitespace-nowrap font-mono text-[0.62rem] font-medium text-ai">
              AI fair {Math.round(aiCents)}¢
            </span>
            <span className="mt-1 h-3 w-px bg-ai" />
          </div>
        )}

        <div className="relative flex h-2 overflow-hidden rounded-full bg-no/25">
          <div
            className="h-full bg-yes transition-[width] duration-500"
            style={{ width: `${yesCents}%` }}
          />
          <div className="h-full flex-1 bg-no/45" />
        </div>

        <div className="mt-1.5 flex justify-between font-mono text-[0.6rem] text-muted/60">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        YES {yesCents} cents, NO {noCents} cents
        {aiCents != null ? `, AI fair value ${Math.round(aiCents)} cents` : ''}
      </div>
    </div>
  );
}

function QuoteTile({
  side,
  cents,
  picked,
}: {
  side: 'yes' | 'no';
  cents: number;
  picked: boolean;
}) {
  const isYes = side === 'yes';

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-1 flex-col justify-between px-4 py-3.5 sm:px-5 sm:py-4 lg:min-w-[148px]',
        isYes ? 'bg-yes/[0.06]' : 'bg-no/[0.04]'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.7rem] font-medium text-muted">
          {isYes ? 'YES' : 'NO'}
        </span>
        {picked && (
          <span className="inline-flex items-center gap-1 rounded-full border border-ai/30 bg-ai/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-ai">
            <span className="h-1 w-1 rounded-full bg-ai" aria-hidden="true" />
            AI pick
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-0.5">
        <span
          className={cn(
            'font-mono text-[2.35rem] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-[2.75rem]',
            isYes ? 'text-yes' : 'text-no'
          )}
        >
          {cents}
        </span>
        <span
          className={cn(
            'text-base font-semibold opacity-60',
            isYes ? 'text-yes' : 'text-no'
          )}
        >
          ¢
        </span>
      </div>
    </div>
  );
}

function MarketMasthead({
  market,
  analysis,
}: {
  market: PolymarketMarket;
  analysis: MarketAnalysisResult | null | undefined;
}) {
  const yesCents = getYesProbability(market);
  const noCents = 100 - yesCents;
  const isClosed = market.closed === true;
  const action = analysis?.action;
  const recLabel =
    action === 'LONG_YES' ? 'BUY YES' : action === 'LONG_NO' ? 'BUY NO' : 'NO TRADE';
  const consensus = analysis?.metadata?.consensusProbability;
  const rawEdge = analysis?.metadata?.edge ?? 0;
  const displayEdge = action === 'LONG_NO' ? -rawEdge : rawEdge;
  const aiCents =
    consensus != null && consensus > 0 ? Math.round(consensus * 100) : null;

  const coverImage =
    market.image ||
    (market.icon && /^https?:\/\//.test(market.icon) ? market.icon : null);
  const coverEmoji = !coverImage && market.icon ? market.icon : null;

  const facts = [
    { label: '24h volume', value: formatVolume(market.volume24hr ?? market.volume) },
    { label: 'Liquidity', value: formatVolume(market.liquidity) },
    {
      label: 'Ends',
      value: formatEndDate(market.endDateIso || market.endDate),
    },
    { label: 'Source', value: 'Polymarket' },
  ].filter((fact) => fact.value);

  return (
    <header className="relative border-b border-border pb-7 sm:pb-9">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted"
      >
        <Link href="/markets" className="transition-colors hover:text-fg">
          Markets
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="max-w-[240px] truncate sm:max-w-[420px]">
          {market.eventTitle || market.question}
        </span>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2 sm:h-[72px] sm:w-[72px]">
            {coverImage ? (
              <Image
                src={coverImage}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 640px) 56px, 72px"
                unoptimized
              />
            ) : coverEmoji ? (
              <span className="flex h-full items-center justify-center text-2xl">
                {coverEmoji}
              </span>
            ) : (
              <span className="flex h-full items-center justify-center">
                <BarChart3 className="h-6 w-6 text-muted/60" aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.65rem] font-medium',
                  isClosed
                    ? 'border-border bg-surface-2 text-muted'
                    : 'border-yes/25 bg-yes/10 text-yes'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isClosed ? 'bg-muted' : 'animate-pulse bg-yes'
                  )}
                  aria-hidden="true"
                />
                {isClosed ? 'Closed' : 'Live'}
              </span>

              {analysis && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.65rem] font-medium',
                    action === 'LONG_YES' && 'border-yes/25 bg-yes/[0.06] text-yes',
                    action === 'LONG_NO' && 'border-no/25 bg-no/[0.06] text-no',
                    action === 'NO_TRADE' && 'border-border bg-surface-2 text-muted'
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-ai" aria-hidden="true" />
                  AI read {recLabel.toLowerCase()}
                  {displayEdge !== 0 && (
                    <span className="font-mono opacity-80">
                      {displayEdge > 0 ? '+' : ''}
                      {(displayEdge * 100).toFixed(1)}¢
                    </span>
                  )}
                </span>
              )}

              <span className="text-xs text-muted">
                {market.eventTitle ? `${market.eventTitle}` : 'Prediction market'}
              </span>
            </div>

            <h1 className="mt-4 max-w-[24ch] font-display text-[clamp(1.9rem,4.2vw,3.15rem)] font-bold leading-[1.04] tracking-[-0.04em] text-fg">
              {market.question}
            </h1>
          </div>
        </div>

        <div className="flex w-full overflow-hidden rounded-2xl border border-border bg-surface/40 lg:w-auto">
          <QuoteTile side="yes" cents={yesCents} picked={action === 'LONG_YES'} />
          <div className="w-px bg-border" aria-hidden="true" />
          <QuoteTile side="no" cents={noCents} picked={action === 'LONG_NO'} />
        </div>
      </div>

      <div className="mt-7 max-w-3xl">
        <ProbabilityRail yesCents={yesCents} aiCents={aiCents} isClosed={isClosed} />
      </div>

      {facts.length > 0 && (
        <dl className="mt-6 flex flex-wrap items-center gap-y-2 text-xs">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-baseline gap-2 border-l border-border px-3 first:border-l-0 first:pl-0"
            >
              <dt className="text-muted">{fact.label}</dt>
              <dd className="font-mono text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

    </header>
  );
}

// ─── Market Details ─────────────────────────────────────────────────────────

function MarketDetails({ market }: { market: PolymarketMarket }) {
  const rows = [
    market.eventTitle && ['Event', market.eventTitle],
    (market.endDateIso || market.endDate) && [
      'Ends',
      formatEndDate(market.endDateIso || market.endDate),
    ],
    market.resolutionSource && ['Resolution', market.resolutionSource],
  ].filter(Boolean) as [string, string][];

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-fg">Market details</h2>
      <dl className="mt-2 divide-y divide-border/60">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-xs text-muted">{label}</dt>
            <dd
              className="min-w-0 break-words text-right text-xs leading-relaxed text-fg"
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <a
        href={`https://polymarket.com/market/${market.slug}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-fg"
      >
        View on Polymarket
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </section>
  );
}

// ─── Portfolio Manager Promo ────────────────────────────────────────────────

function PortfolioManagerTeaser() {
  const { data: personaSettings, isLoading: isPersonaLoading } = usePersonaSettings();
  const personaName =
    personaSettings?.persona?.name ??
    personaSettings?.description?.name ??
    'your persona';
  const personaRisk =
    personaSettings?.persona?.riskLevel ??
    personaSettings?.description?.riskLevel ??
    null;
  const personaTagline =
    personaSettings?.description?.tagline ??
    personaSettings?.description?.entryPhilosophy ??
    'Follows your selected entry, sizing, monitoring, and exit rules on this market.';
  const riskTone =
    personaRisk === 'aggressive'
      ? 'border-no/30 bg-no/10 text-no'
      : personaRisk === 'conservative'
        ? 'border-yes/30 bg-yes/10 text-yes'
        : 'border-warning/30 bg-warning/10 text-warning';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-dashed border-accent/35 bg-surface">
      <div
        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent via-accent/50 to-transparent"
        aria-hidden="true"
      />
      <div className="flex items-center gap-2.5 border-b border-dashed border-accent/15 px-4 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white shadow-[0_6px_18px_-8px_oklch(62%_0.20_260_/_0.8)]">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Autopilot</h2>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-accent">
              Pro
            </span>
          </div>
          <p className="text-[0.6rem] text-muted">
            Portfolio Manager · standby
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/[0.06] px-2 py-0.5 text-[0.55rem] font-medium text-accent">
          <span className="h-1 w-1 rounded-full bg-accent" aria-hidden="true" />
          Ready
        </span>
      </div>
      <div className="bg-gradient-to-b from-accent/[0.04] to-transparent p-4">
        {isPersonaLoading ? (
          <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <div className="rounded-lg border border-accent/15 bg-accent/[0.04] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">{personaName}</span>
              {personaRisk && (
                <span
                  className={cn(
                    'rounded-full border px-1.5 py-0.5 text-[0.55rem] font-medium capitalize',
                    riskTone
                  )}
                >
                  {personaRisk}
                </span>
              )}
            </div>
            <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">
              {personaTagline}
            </p>
          </div>
        )}
        <p className="mt-2 text-[0.65rem] leading-relaxed text-muted">
          Watches each new analysis and executes with hard stop-loss and
          take-profit rails.
        </p>
        <ul className="mt-2.5 space-y-1.5 text-[0.7rem] text-muted">
          {[
            'Hard stop-loss and take-profit rails',
            'Session loss limits plus a kill switch',
            'Every decision logged and visible',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <Link
          href="/account/subscription"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_-10px_oklch(62%_0.20_260_/_0.8)] transition-[filter] hover:brightness-110"
        >
          Unlock autopilot
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

// ─── Upgrade Nudge ──────────────────────────────────────────────────────────

function UpgradeNudge() {
  return (
    <div className="flex flex-col gap-2 border-y border-accent/20 bg-accent/[0.04] px-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p className="text-xs text-muted">
          <span className="font-medium text-fg">You&apos;re on Free.</span> Unlock
          recurring analysis, real-time alerts, and more credits.
        </p>
      </div>
      <Link
        href="/account/subscription"
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-fg"
      >
        See plans
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

// ─── Price Chart ────────────────────────────────────────────────────────────

type ChartTimeRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

function formatAxisTime(timestamp: string, range: ChartTimeRange): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  if (range === '1H' || range === '1D') {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChartPanel({
  conditionId,
  yesTokenId,
  noTokenId,
  aiCents,
  recommendation,
}: {
  conditionId: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  aiCents?: number | null;
  recommendation?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE' | null;
}) {
  const [timeRange, setTimeRange] = useState<ChartTimeRange>('1D');

  const hookTimeRange = TIME_RANGE_MAP[timeRange];
  const { data: priceHistory, isLoading, error } = usePriceHistory(
    conditionId,
    yesTokenId,
    hookTimeRange,
    {},
    noTokenId,
  );

  const yesData = priceHistory?.data ?? [];
  const noData = priceHistory?.noData ?? [];
  const primarySide: 'yes' | 'no' =
    recommendation === 'LONG_NO' && noData.length > 0 ? 'no' : 'yes';
  const primaryData = primarySide === 'yes' ? yesData : noData;
  const primaryLabel = primarySide === 'yes' ? 'YES' : 'NO';
  const primaryIsPick =
    (primarySide === 'yes' && recommendation === 'LONG_YES') ||
    (primarySide === 'no' && recommendation === 'LONG_NO');
  const lastPrimary =
    primaryData.length > 0
      ? primaryData[primaryData.length - 1].price * 100
      : null;
  const firstPrimary =
    primaryData.length > 0 ? primaryData[0].price * 100 : null;
  const primaryChange =
    lastPrimary != null && firstPrimary != null ? lastPrimary - firstPrimary : null;

  const chartTabs: { id: ChartTimeRange; label: string }[] = [
    { id: '1H', label: '1H' },
    { id: '1D', label: '1D' },
    { id: '1W', label: '1W' },
    { id: '1M', label: '1M' },
    { id: 'ALL', label: 'ALL' },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <div>
            <h2 className="text-sm font-semibold text-fg">Price history</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-muted">
              Polymarket midpoint · {primaryLabel} token
              {primaryIsPick && (
                <span className="inline-flex items-center gap-1 rounded-full border border-ai/30 bg-ai/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-ai">
                  <span className="h-1 w-1 rounded-full bg-ai" aria-hidden="true" />
                  AI pick
                </span>
              )}
            </p>
          </div>

          {lastPrimary != null && (
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  'font-mono text-xl font-bold tabular-nums',
                  primarySide === 'yes' ? 'text-yes' : 'text-no'
                )}
              >
                {lastPrimary.toFixed(1)}¢
              </span>
              {primaryChange != null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-mono text-[0.65rem] tabular-nums',
                    primaryChange >= 0 ? 'text-yes' : 'text-no'
                  )}
                >
                  {primaryChange >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                  )}
                  {Math.abs(primaryChange).toFixed(1)}¢
                </span>
              )}
            </div>
          )}
        </div>

        <Tabs
          tabs={chartTabs}
          active={timeRange}
          onChange={(id) => setTimeRange(id as ChartTimeRange)}
        />
      </div>

      <div className="relative h-[240px] border-t border-border/60 sm:h-[300px] lg:h-[340px]">
        {isLoading ? (
          <div className="flex h-full animate-pulse items-center justify-center text-sm text-muted">
            Loading chart…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-muted">
            <p>Unable to load price data</p>
            <p className="mt-1 text-xs opacity-60">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : primaryData.length > 0 ? (
          <ChartPlot
            yesData={yesData}
            noData={noData}
            aiCents={aiCents}
            timeRange={timeRange}
            primarySide={primarySide}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No price data available
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 px-4 py-3 sm:px-5">
        <span className="flex items-center gap-1.5 text-[0.65rem] text-muted">
          <span
            className={cn(
              'h-0.5 w-3 rounded-full',
              primarySide === 'yes' ? 'bg-yes' : 'bg-no'
            )}
          />
          <span className={primarySide === 'yes' ? 'text-fg' : 'text-muted'}>
            {primaryLabel}
          </span>
          {primaryIsPick && <span className="text-ai">AI pick</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[0.65rem] text-muted">
          <span
            className={cn(
              'w-3 border-t border-dashed',
              primarySide === 'yes' ? 'border-no/50' : 'border-yes/50'
            )}
          />
          <span className={primarySide === 'yes' ? 'text-muted' : 'text-fg'}>
            {primarySide === 'yes' ? 'NO' : 'YES'}
          </span>
        </span>
        {aiCents != null && (
          <span className="flex items-center gap-1.5 text-[0.65rem] text-muted">
            <span className="h-0.5 w-3 rounded-full border-t border-dashed border-ai" />
            AI fair value
          </span>
        )}
        {priceHistory?.dataSource === 'synthetic' && (
          <span className="ml-auto text-[0.65rem] text-muted/60">
            Simulated data
          </span>
        )}
      </div>
    </section>
  );
}

/** Price history with the AI-picked token as the primary series. */
function ChartPlot({
  yesData,
  noData,
  aiCents,
  timeRange,
  primarySide,
}: {
  yesData: PriceHistoryPoint[];
  noData: PriceHistoryPoint[];
  aiCents?: number | null;
  timeRange: ChartTimeRange;
  primarySide: 'yes' | 'no';
}) {
  const chartId = useId();
  const W = 1000;
  const H = 300;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 14;

  const primaryData = primarySide === 'yes' ? yesData : noData;
  const secondaryLabel = primarySide === 'yes' ? 'NO' : 'YES';

  function buildPath(data: PriceHistoryPoint[]): string {
    if (data.length === 0) return '';
    return data
      .map((point, i) => {
        const x = (i / Math.max(data.length - 1, 1)) * W;
        const y =
          PAD_TOP +
          (1 - Math.max(0, Math.min(1, point.price))) * (H - PAD_TOP - PAD_BOTTOM);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  const primaryPath = buildPath(primaryData);
  const secondaryPath = buildPath(primarySide === 'yes' ? noData : yesData);
  const last = primaryData[primaryData.length - 1];
  const lastX = W - 1;
  const lastY =
    PAD_TOP + (1 - Math.max(0, Math.min(1, last.price))) * (H - PAD_TOP - PAD_BOTTOM);

  const primaryColor =
    primarySide === 'yes' ? 'oklch(72% 0.16 155)' : 'oklch(65% 0.18 25)';
  const secondaryColor =
    primarySide === 'yes' ? 'oklch(65% 0.18 25)' : 'oklch(72% 0.16 155)';
  const aiPrimaryCents =
    primarySide === 'no' && aiCents != null ? 100 - aiCents : aiCents;
  const aiY =
    aiPrimaryCents != null
      ? PAD_TOP +
      (1 - Math.max(0, Math.min(100, aiPrimaryCents)) / 100) *
      (H - PAD_TOP - PAD_BOTTOM)
      : null;

  const startLabel = formatAxisTime(primaryData[0]?.timestamp, timeRange);
  const midLabel = formatAxisTime(
    primaryData[Math.floor(primaryData.length / 2)]?.timestamp,
    timeRange
  );
  const endLabel = formatAxisTime(last?.timestamp, timeRange);

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-label={`Price history chart with ${primarySide.toUpperCase()} as the primary token and ${secondaryLabel} as the secondary token`}
        role="img"
      >
        <defs>
          <linearGradient id={`${chartId}-primaryGradient`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.16" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[25, 50, 75].map((level) => {
          const y = PAD_TOP + (1 - level / 100) * (H - PAD_TOP - PAD_BOTTOM);
          return (
            <line
              key={level}
              x1={0}
              x2={W}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth="0.5"
              strokeDasharray={level === 50 ? '3 3' : '2 5'}
              vectorEffect="non-scaling-stroke"
              opacity={level === 50 ? 0.55 : 0.35}
            />
          );
        })}

        {aiY != null && (
          <line
            x1={0}
            x2={W}
            y1={aiY}
            y2={aiY}
            stroke="oklch(62% 0.18 295)"
            strokeWidth="1.25"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.75}
          />
        )}

        {primaryPath && (
          <path
            d={`${primaryPath} L ${W},${H} L 0,${H} Z`}
            fill={`url(#${chartId}-primaryGradient)`}
          />
        )}
        {primaryPath && (
          <path
            d={primaryPath}
            fill="none"
            stroke={primaryColor}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke={secondaryColor}
            strokeWidth="1.25"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.45}
          />
        )}

        <circle
          cx={lastX}
          cy={lastY}
          r="3.5"
          fill={primaryColor}
          stroke="var(--surface)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between py-2 pl-3 font-mono text-[0.58rem] text-muted/60">
        <span>100¢</span>
        <span>50¢</span>
        <span>0¢</span>
      </div>

      {aiY != null && (
        <span
          className="pointer-events-none absolute right-3 -translate-y-1/2 rounded border border-ai/30 bg-surface/90 px-1.5 py-0.5 font-mono text-[0.58rem] text-ai backdrop-blur-sm"
          style={{ top: `${(aiY / H) * 100}%` }}
        >
          AI {Math.round(aiPrimaryCents!)}¢
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-3 pb-1 font-mono text-[0.58rem] text-muted/60">
        <span>{startLabel}</span>
        <span className="hidden sm:inline">{midLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

// ─── Order Book Panel ───────────────────────────────────────────────────────

function OrderBookPanel({ market }: { market: PolymarketMarket }) {
  const isMobile = useIsMobile();
  const [isExpanded, setIsExpanded] = useState(true);

  // Extract token IDs
  const { yesTokenId, noTokenId } = useMemo(() => {
    if (!market.clobTokenIds) return { yesTokenId: null, noTokenId: null };
    try {
      const ids = JSON.parse(market.clobTokenIds);
      return { yesTokenId: ids[0] || null, noTokenId: ids[1] || null };
    } catch {
      return { yesTokenId: null, noTokenId: null };
    }
  }, [market.clobTokenIds]);

  // Fetch real order book data with WebSocket updates
  const { yesBook, noBook, isLoading, error } = useOrderBook(yesTokenId, noTokenId);

  // Collapse order book on mobile by default
  useEffect(() => {
    if (isMobile) {
      setIsExpanded(false);
    }
  }, [isMobile]);

  // Get top N levels from the order book
  const maxLevels = 6;
  const yesBids = yesBook?.bids?.slice(0, maxLevels) || [];
  const yesAsks = yesBook?.asks?.slice(0, maxLevels) || [];
  const noBids = noBook?.bids?.slice(0, maxLevels) || [];
  const noAsks = noBook?.asks?.slice(0, maxLevels) || [];

  // Calculate max size for depth visualization
  const allSizes = [
    ...yesBids.map((l) => parseFloat(l.size)),
    ...yesAsks.map((l) => parseFloat(l.size)),
    ...noBids.map((l) => parseFloat(l.size)),
    ...noAsks.map((l) => parseFloat(l.size)),
  ];
  const maxSize = Math.max(...allSizes, 1);

  const toCents = (price: string | undefined) =>
    price ? parseFloat(price) * 100 : null;
  const bestYesBid = toCents(yesBids[0]?.price);
  const bestYesAsk = toCents(yesAsks[0]?.price);
  const bestNoBid = toCents(noBids[0]?.price);
  const bestNoAsk = toCents(noAsks[0]?.price);

  const fmt = (value: number | null) =>
    value === null ? '-' : `${value.toFixed(1)}¢`;
  const mid = (bid: number | null, ask: number | null) =>
    bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const spread = (bid: number | null, ask: number | null) =>
    bid !== null && ask !== null ? Math.max(0, ask - bid) : null;

  const yesSpread = spread(bestYesBid, bestYesAsk);

  const renderSide = (
    token: 'yes' | 'no',
    bids: { price: string; size: string }[],
    asks: { price: string; size: string }[],
    bestBid: number | null,
    bestAsk: number | null,
    sideSpread: number | null
  ) => (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              token === 'yes' ? 'bg-yes' : 'bg-no'
            )}
          />
          <span
            className={cn(
              'text-xs font-semibold',
              token === 'yes' ? 'text-yes' : 'text-no'
            )}
          >
            {token.toUpperCase()}
          </span>
          <span className="font-mono text-[0.6rem] text-muted">
            mid {fmt(mid(bestBid, bestAsk))}
          </span>
        </div>
        <span className="font-mono text-[0.6rem] text-muted">
          spread {fmt(sideSpread)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between px-2.5 text-[0.58rem] text-muted/60">
        <span>Bids</span>
        <span>Size</span>
      </div>
      <div className="mt-0.5 space-y-0.5">
        {bids.length > 0 ? (
          bids.map((level, i) => (
            <OrderBookRow
              key={`${token}-bid-${i}`}
              price={level.price}
              size={level.size}
              maxSize={maxSize}
              side="bid"
              token={token}
              isBest={i === 0}
            />
          ))
        ) : (
          <div className="px-2.5 py-1 text-[0.65rem] text-muted">No bids</div>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between px-2.5 text-[0.58rem] text-muted/60">
        <span>Asks</span>
        <span>Size</span>
      </div>
      <div className="mt-0.5 space-y-0.5">
        {asks.length > 0 ? (
          asks.map((level, i) => (
            <OrderBookRow
              key={`${token}-ask-${i}`}
              price={level.price}
              size={level.size}
              maxSize={maxSize}
              side="ask"
              token={token}
              isBest={i === 0}
            />
          ))
        ) : (
          <div className="px-2.5 py-1 text-[0.65rem] text-muted">No asks</div>
        )}
      </div>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-fg">Order book</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[0.58rem] text-muted">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                isLoading ? 'bg-muted' : 'animate-pulse bg-yes'
              )}
            />
            {isLoading ? 'syncing' : 'live'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[0.62rem] text-muted sm:inline">
            YES spread {fmt(yesSpread)}
          </span>
          <ChevronRight
            className={cn(
              'h-4 w-4 text-muted transition-transform',
              isExpanded && 'rotate-90'
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      <div
        className={cn(
          'border-t border-border/60 transition-all',
          !isExpanded && 'hidden'
        )}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-sm text-muted">Loading order book…</div>
          </div>
        ) : error ? (
          <div className="py-4 text-center text-sm text-muted">
            Unable to load order book data
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              {renderSide('yes', yesBids, yesAsks, bestYesBid, bestYesAsk, yesSpread)}
              {renderSide(
                'no',
                noBids,
                noAsks,
                bestNoBid,
                bestNoAsk,
                spread(bestNoBid, bestNoAsk)
              )}
            </div>

            {yesBook?.tick_size && (
              <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 font-mono text-[0.58rem] text-muted sm:px-5">
                <span>Tick {yesBook.tick_size}</span>
                <span>Min order {yesBook.min_order_size}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Single row in the order book with depth visualization */
function OrderBookRow({
  price,
  size,
  maxSize,
  side,
  token,
  isBest = false,
}: {
  price: string;
  size: string;
  maxSize: number;
  side: 'bid' | 'ask';
  token: 'yes' | 'no';
  isBest?: boolean;
}) {
  const priceCents = (parseFloat(price) * 100).toFixed(1);
  const sizeNum = parseFloat(size);
  const depthPercent = Math.min((sizeNum / maxSize) * 100, 100);

  const bgColor = side === 'bid'
    ? (token === 'yes' ? 'bg-yes/10' : 'bg-no/10')
    : 'bg-muted/10';

  const textColor = side === 'bid'
    ? (token === 'yes' ? 'text-yes' : 'text-no')
    : 'text-muted';

  return (
    <div
      className={cn(
        'relative flex items-center justify-between overflow-hidden rounded px-2.5 py-[5px] text-[0.7rem]',
        isBest && 'bg-surface-2/50'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-0.5',
          isBest ? (token === 'yes' ? 'bg-yes' : 'bg-no') : 'bg-transparent'
        )}
        aria-hidden="true"
      />
      <div
        className={cn('absolute inset-y-0 left-0 opacity-25', bgColor)}
        style={{ width: `${depthPercent}%` }}
      />
      <span className={cn('relative z-10 font-mono tabular-nums', textColor)}>
        {priceCents}¢
      </span>
      <span className="relative z-10 font-mono tabular-nums text-muted">
        {sizeNum >= 1000
          ? `${(sizeNum / 1000).toFixed(1)}K`
          : Math.floor(sizeNum).toLocaleString()}
      </span>
    </div>
  );
}

// ─── Market Brief ───────────────────────────────────────────────────────────

function MarketBrief({ market }: { market: PolymarketMarket }) {
  const [expanded, setExpanded] = useState(false);
  const description = market.description?.trim();

  if (!description) return null;

  const isLong = description.length > 520;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-fg">The brief</h2>
        <a
          href={`https://polymarket.com/market/${market.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-accent transition-colors hover:text-fg"
        >
          Polymarket
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      <div className="border-t border-border/60 px-4 py-4 sm:px-5">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-7 text-muted',
            !expanded && isLong && 'line-clamp-[9]'
          )}
        >
          {description}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 text-xs font-semibold text-accent transition-colors hover:text-fg"
          >
            {expanded ? 'Show less' : 'Read full brief'}
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Analysis History Panel ─────────────────────────────────────────────────

function AnalysisHistoryPanel({ marketId, conditionId }: { marketId: string | null; conditionId: string | null; yesTokenId?: string | null }) {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMarketAnalysisHistory(marketId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'performance' | 'agents'>('timeline');

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  if (!marketId) return null;

  const tabs = [
    { id: 'timeline' as const, label: 'Timeline' },
    { id: 'performance' as const, label: 'AI vs market' },
    { id: 'agents' as const, label: 'Agent accuracy' },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-fg">Track record</h2>
          <p className="text-[0.65rem] text-muted">
            {totalCount > 0
              ? `${totalCount} recorded run${totalCount === 1 ? '' : 's'} on this market`
              : 'Every AI run on this market, in order'}
          </p>
        </div>

        <div className="flex w-fit gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-surface text-fg shadow-[var(--shadow-sm)]'
                  : 'text-muted hover:text-fg'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border/60">
        {activeTab === 'timeline' && (
          <div className="p-4 sm:p-5">
            {isLoading ? (
              <div className="animate-pulse space-y-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2 sm:pl-[132px]">
                    <div className="h-3 w-24 rounded bg-surface-2" />
                    <div className="h-3 w-2/3 rounded bg-surface-2" />
                    <div className="h-3 w-1/2 rounded bg-surface-2" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <BarChart3 className="h-5 w-5 text-muted/50" aria-hidden="true" />
                <p className="text-sm font-medium text-fg">No runs yet</p>
                <p className="max-w-[300px] text-xs leading-relaxed text-muted">
                  Run an analysis to start a track record for this market.
                </p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border/60">
                  {items.map((item, idx) => (
                    <TimelineEntry
                      key={item.analysisId}
                      item={item}
                      isLatest={idx === 0}
                      isExpanded={expandedId === item.analysisId}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === item.analysisId ? null : item.analysisId
                        )
                      }
                    />
                  ))}
                </div>

                {hasNextPage && (
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className={cn(
                      'mt-4 w-full rounded-lg border border-border py-2 text-xs font-medium',
                      'text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  >
                    {isFetchingNextPage
                      ? 'Loading…'
                      : `Load more (${totalCount - items.length} remaining)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="p-4 sm:p-5">
            <PerformanceSummary items={items} conditionId={conditionId} />
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="p-4 sm:p-5">
            <MarketAgentPerformance conditionId={conditionId} />
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Timeline Entry ─────────────────────────────────────────────────────────

interface TimelineEntryProps {
  item: {
    analysisId: string;
    marketId: string;
    marketQuestion: string;
    recommendation: string;
    consensusProbability: number;
    confidence: number;
    executedAt: string;
    wasCachedDelivery: boolean;
  };
  isLatest: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function TimelineEntry({ item, isLatest, isExpanded, onToggle }: TimelineEntryProps) {
  const recLabel =
    item.recommendation === 'LONG_YES'
      ? 'BUY YES'
      : item.recommendation === 'LONG_NO'
        ? 'BUY NO'
        : 'NO TRADE';
  const recTone: 'yes' | 'no' | 'warning' =
    item.recommendation === 'LONG_YES'
      ? 'yes'
      : item.recommendation === 'LONG_NO'
        ? 'no'
        : 'warning';

  const date = new Date(item.executedAt);
  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fairCents =
    item.recommendation === 'LONG_NO'
      ? Math.round((1 - item.consensusProbability) * 100)
      : Math.round(item.consensusProbability * 100);

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-5">
        <div className="flex items-center gap-2 sm:block">
          <div className="font-mono text-[0.68rem] text-fg">{dateStr}</div>
          <div className="font-mono text-[0.6rem] text-muted">{timeStr}</div>
          {isLatest && (
            <span className="ml-auto rounded border border-ai/25 bg-ai/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-ai sm:mt-1.5 sm:inline-flex">
              Latest
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={recTone} size="sm">
              {recLabel}
            </Badge>
            <span className="font-mono text-[0.65rem] text-muted">
              Confidence <span className="text-fg">{Math.round(item.confidence * 100)}%</span>
            </span>
            <span className="font-mono text-[0.65rem] text-muted">
              Fair <span className="text-fg">{fairCents}¢</span>
            </span>
            {item.wasCachedDelivery && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.55rem] text-muted">
                cached
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="mt-2 inline-flex items-center gap-1 text-[0.68rem] font-medium text-accent transition-colors hover:text-fg"
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Hide report' : 'Open report'}
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                isExpanded && 'rotate-90'
              )}
              aria-hidden="true"
            />
          </button>

          {isExpanded && (
            <div className="mt-3">
              <AnalysisHistoryDetail analysisId={item.analysisId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Expanded Detail (lazy-loads full analysis with agent signals) ───────────

function AnalysisHistoryDetail({ analysisId }: { analysisId: string }) {
  const { data, isLoading, isError } = useAnalysisDetail(analysisId);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 rounded-lg border border-border p-4">
        <div className="h-4 w-2/3 rounded bg-surface-2" />
        <div className="h-3 w-1/2 rounded bg-surface-2" />
        <div className="h-20 rounded bg-surface-2" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted">Could not load analysis details.</p>
      </div>
    );
  }

  // Normalise agent signals (API may return snake_case from S3)
  const agentSignals = (data.agentSignals ?? []).map((s: any) => ({
    agentName: s.agentName ?? s.agent_name ?? '',
    direction: s.direction ?? 'NEUTRAL',
    confidence: s.confidence ?? 0,
    fairProbability: s.fairProbability ?? s.fair_probability ?? 0,
    keyDrivers: s.keyDrivers ?? s.key_drivers ?? [],
    riskFactors: s.riskFactors ?? s.risk_factors ?? [],
    timestamp: s.timestamp,
  }));

  const bullThesis = data.bullThesis ?? (data as any).bull_thesis;
  const bearThesis = data.bearThesis ?? (data as any).bear_thesis;

  return (
    <div className="rounded-lg border border-border p-4 space-y-4 bg-surface-2/30">
      {/* Summary explanation */}
      {data.explanation?.summary && (
        <p className="text-sm text-fg/80 leading-relaxed">{data.explanation.summary}</p>
      )}

      {/* Quick stats */}
      <div className="flex flex-wrap gap-4 text-xs">
        {data.expectedValue !== undefined && (
          <div>
            <span className="text-muted">EV: </span>
            <span className={cn('font-mono font-medium', data.expectedValue >= 0 ? 'text-yes' : 'text-no')}>
              {data.expectedValue >= 0 ? '+' : ''}{(data.expectedValue * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {data.winProbability !== undefined && (
          <div>
            <span className="text-muted">Win Prob: </span>
            <span className="font-mono font-medium">{Math.round(data.winProbability * 100)}%</span>
          </div>
        )}
        {data.entryZone && (
          <div>
            <span className="text-muted">Entry: </span>
            <span className="font-mono">{Math.round(data.entryZone[0] * 100)}–{Math.round(data.entryZone[1] * 100)}¢</span>
          </div>
        )}
        {data.targetZone && (
          <div>
            <span className="text-muted">Target: </span>
            <span className="font-mono">{Math.round(data.targetZone[0] * 100)}–{Math.round(data.targetZone[1] * 100)}¢</span>
          </div>
        )}
      </div>

      {/* Bull / Bear Thesis */}
      {bullThesis && bearThesis && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="rounded-lg border border-yes/20 bg-yes/5 p-3">
            <h4 className="text-xs font-semibold text-yes mb-1.5">Bull Thesis</h4>
            <ul className="space-y-1">
              {(bullThesis.keyArguments ?? bullThesis.key_arguments ?? []).slice(0, 3).map((arg: string, i: number) => (
                <li key={i} className="text-xs text-fg/80 flex gap-1.5">
                  <span className="text-yes shrink-0">•</span>
                  <span className="leading-relaxed">{arg}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-no/20 bg-no/5 p-3">
            <h4 className="text-xs font-semibold text-no mb-1.5">Bear Thesis</h4>
            <ul className="space-y-1">
              {(bearThesis.keyArguments ?? bearThesis.key_arguments ?? []).slice(0, 3).map((arg: string, i: number) => (
                <li key={i} className="text-xs text-fg/80 flex gap-1.5">
                  <span className="text-no shrink-0">•</span>
                  <span className="leading-relaxed">{arg}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Agent Signals */}
      {agentSignals.length > 0 && (
        <div>
          <Expandable
            summary={
              <span className="flex items-center gap-1.5">
                Agent Signals
                <InfoHint label="What agent signals mean">
                  Each agent predicts the outcome it thinks is most likely (YES
                  or NO) and how confident it is. The ¢ figure is that
                  outcome&apos;s <strong className="text-fg">fair value</strong>.
                  If it is above the market price, the agent sees that side as
                  underpriced. NEUTRAL agents are left out of the final score.
                </InfoHint>
              </span>
            }
            meta={`${agentSignals.length} agents`}
            defaultOpen={false}
          >
            <div className="space-y-3 pt-1">
              {agentSignals.map((signal: AgentSignalData) => (
                <AgentSignalRow key={signal.agentName} signal={signal} />
              ))}
            </div>
          </Expandable>
        </div>
      )}

      {/* Risk Perspectives */}
      {data.riskPerspectives && data.riskPerspectives !== 'Risk perspectives unavailable.' && (
        <Expandable summary="Risk Perspectives" defaultOpen={false}>
          <pre className="text-xs text-fg/70 whitespace-pre-wrap leading-relaxed font-sans pt-1">
            {data.riskPerspectives}
          </pre>
        </Expandable>
      )}
    </div>
  );
}

// ─── Market Agent Performance Tab ───────────────────────────────────────────

function MarketAgentPerformance({ conditionId }: { conditionId: string | null }) {
  const { data, isLoading } = useAgentAccuracy(conditionId);
  const agents = data?.agents ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="h-3 w-32 rounded bg-surface-2" />
            <div className="h-1 rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <BarChart3 className="h-5 w-5 text-muted/50" aria-hidden="true" />
        <p className="text-sm font-medium text-fg">No agent calls scored yet</p>
        <p className="max-w-[320px] text-xs leading-relaxed text-muted">
          Accuracy appears after recommendations on this market hit their target
          or stop.
        </p>
      </div>
    );
  }

  const totalSignals = agents.reduce((sum, agent) => sum + agent.totalSignals, 0);
  const avgAccuracy =
    totalSignals > 0
      ? agents.reduce((sum, agent) => sum + agent.accuracy * agent.totalSignals, 0) /
      totalSignals
      : 0;
  const top = agents[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 sm:grid-cols-3 sm:divide-y-0">
        <ScoreStat
          label="Signals scored"
          value={String(totalSignals)}
          caption="30-day window"
        />
        <ScoreStat
          label="Average accuracy"
          value={`${Math.round(avgAccuracy)}%`}
          caption="weighted by signals"
          tone={
            avgAccuracy >= 60 ? 'yes' : avgAccuracy >= 50 ? 'warning' : 'no'
          }
        />
        <ScoreStat
          label="Best accuracy"
          value={`${Math.round(top.accuracy)}%`}
          caption={formatAgentDisplayName(top.name)}
          tone="ai"
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-fg">Leaderboard</h3>
          <span className="font-mono text-[0.6rem] text-muted">30 days</span>
        </div>

        <div className="mt-1 divide-y divide-border/60 border-t border-border/60">
          {agents.map((agent, idx) => {
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
              <div key={agent.name} className="flex items-center gap-3 py-2.5">
                <span className="w-5 shrink-0 text-right font-mono text-[0.6rem] text-muted">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[0.76rem] font-medium text-fg">
                      {formatAgentDisplayName(agent.name)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[0.72rem] font-semibold tabular-nums',
                        textColor
                      )}
                    >
                      {Math.round(agent.accuracy)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn('h-full rounded-full', barColor)}
                      style={{ width: `${Math.min(agent.accuracy, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[0.55rem] text-muted">
                    <span>
                      {agent.correctSignals}/{agent.totalSignals} correct
                    </span>
                    <span>
                      avg conf {Math.round(agent.avgConfidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="border-t border-border/60 pt-3 text-[0.6rem] leading-relaxed text-muted">
        Accuracy counts calls whose direction matched a profitable trade, plus
        calls that correctly warned against a losing one.
      </p>
    </div>
  );
}

// ─── Performance Summary Tab ────────────────────────────────────────────────

function PerformanceSummary({ items, conditionId }: {
  items: { recommendation: string; consensusProbability: number; confidence: number; executedAt: string }[];
  conditionId: string | null;
}) {
  const total = items.length;
  const { data: tradePerf, isLoading: isPerfLoading } = useMarketTradePerformance(conditionId);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <BarChart3 className="h-5 w-5 text-muted/50" aria-hidden="true" />
        <p className="text-sm font-medium text-fg">Nothing scored yet</p>
        <p className="max-w-[300px] text-xs leading-relaxed text-muted">
          Win rate and edge appear after analyses resolve against the market.
        </p>
      </div>
    );
  }

  const avgConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / total;
  const recommendations = tradePerf?.recommendations ?? [];
  const summary = tradePerf?.summary;
  const hasResolvedData = !!summary && summary.resolved > 0;
  const sorted = [...recommendations].sort(
    (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
  );

  const outcomeSegments = hasResolvedData
    ? [
      { label: 'Target hit', value: summary.successes, tone: 'bg-yes' },
      { label: 'Stop hit', value: summary.failures, tone: 'bg-no' },
      { label: 'Expired', value: summary.expired, tone: 'bg-muted/50' },
      { label: 'Pending', value: summary.pending, tone: 'bg-ai' },
    ].filter((segment) => segment.value > 0)
    : [];
  const outcomeTotal = outcomeSegments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 sm:grid-cols-4 sm:divide-y-0">
        <ScoreStat
          label="Win rate"
          value={
            hasResolvedData && summary.winRate !== null
              ? `${Math.round(summary.winRate * 100)}%`
              : '-'
          }
          caption={
            hasResolvedData
              ? `${summary.successes} of ${summary.resolved} resolved`
              : 'awaiting outcomes'
          }
          tone={
            hasResolvedData && summary.winRate !== null
              ? summary.winRate >= 0.6
                ? 'yes'
                : summary.winRate < 0.4
                  ? 'no'
                  : 'warning'
              : 'muted'
          }
        />
        <ScoreStat
          label="Edge captured"
          value={
            hasResolvedData && summary.avgEdgeCaptured !== null
              ? `${summary.avgEdgeCaptured > 0 ? '+' : ''}${Math.round(summary.avgEdgeCaptured * 100)}¢`
              : '-'
          }
          caption="average per resolved call"
          tone={
            hasResolvedData &&
              summary.avgEdgeCaptured !== null &&
              summary.avgEdgeCaptured > 0
              ? 'yes'
              : 'fg'
          }
        />
        <ScoreStat
          label="Avg confidence"
          value={`${Math.round(avgConfidence * 100)}%`}
          caption="AI self-reported"
          tone="ai"
        />
        <ScoreStat
          label="Calls scored"
          value={String(recommendations.length)}
          caption={`${summary?.pending ?? 0} pending`}
        />
      </div>

      {recommendations.length > 0 && (
        <EdgeOverTimeChart calls={recommendations} />
      )}

      {hasResolvedData ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-fg">Outcome mix</h3>
            <span className="font-mono text-[0.6rem] text-muted">
              {summary.resolved} resolved
            </span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2">
            {outcomeSegments.map((segment) => (
              <div
                key={segment.label}
                className={segment.tone}
                style={{ width: `${(segment.value / outcomeTotal) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.65rem] text-muted">
            {outcomeSegments.map((segment) => (
              <span key={segment.label} className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', segment.tone)} />
                {segment.label} <span className="font-mono text-fg">{segment.value}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-[0.65rem] leading-relaxed text-muted">
          No resolved calls yet. Outcomes appear once a call reaches its target,
          stop, or expiry.
        </p>
      )}

      {recommendations.length > 0 ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-fg">Call ledger</h3>
            <span className="font-mono text-[0.6rem] text-muted">entry → outcome</span>
          </div>
          <div className="mt-1 divide-y divide-border/60 border-t border-border/60">
            {sorted.slice(0, 8).map((rec) => (
              <CallRow key={rec.analysisId} rec={rec} />
            ))}
          </div>
          {sorted.length > 8 && (
            <p className="mt-2 text-[0.6rem] text-muted">
              Showing 8 of {sorted.length} scored calls
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-2.5 text-[0.65rem] text-muted">
          {isPerfLoading
            ? 'Loading scored calls…'
            : 'No scored calls yet. The ledger fills as recommendations resolve.'}
        </div>
      )}
    </div>
  );
}

function ScoreStat({
  label,
  value,
  caption,
  tone = 'fg',
}: {
  label: string;
  value: string;
  caption: string;
  tone?: 'fg' | 'yes' | 'no' | 'warning' | 'ai' | 'muted';
}) {
  return (
    <div className="px-3 py-3">
      <div className="text-[0.6rem] text-muted">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-lg font-bold tabular-nums',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'warning' && 'text-warning',
          tone === 'ai' && 'text-ai',
          tone === 'muted' && 'text-muted',
          tone === 'fg' && 'text-fg'
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[0.55rem] text-muted">{caption}</div>
    </div>
  );
}

function EdgeOverTimeChart({ calls }: { calls: TradeOutcome[] }) {
  const ordered = [...calls].sort(
    (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
  );
  const recent = ordered.slice(-16);
  const values = recent.map((call) => {
    const raw = call.recommendation === 'LONG_NO' ? -call.edge : call.edge;
    return Math.round(raw * 1000) / 10;
  });
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const maxAbs = Math.max(5, ...values.map((value) => Math.abs(value)), Math.abs(avg));
  const domain = Math.max(5, Math.ceil(maxAbs / 5) * 5);

  const topFor = (value: number) => 50 - (value / domain) * 50;
  const heightFor = (value: number) => Math.max((Math.abs(value) / domain) * 50, 0.8);

  const statusLabel = (status: TradeOutcome['outcomeStatus']) =>
    status === 'success'
      ? 'Target hit'
      : status === 'failure'
        ? 'Stop hit'
        : status === 'expired'
          ? 'Expired'
          : 'Pending';

  return (
    <div className="rounded-xl border border-border/60 bg-surface-2/20 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium text-fg">Edge over time</h3>
          <p className="text-[0.6rem] text-muted">
            Signed edge per scored call, in the recommended token&apos;s space
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.6rem]',
            avg >= 0
              ? 'border-yes/25 bg-yes/10 text-yes'
              : 'border-no/25 bg-no/10 text-no'
          )}
        >
          avg {avg >= 0 ? '+' : ''}
          {avg.toFixed(1)}¢
        </span>
      </div>

      <div className="relative mt-4 h-[150px]">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 flex-col justify-between font-mono text-[0.55rem] text-muted/60">
          <span>+{Math.round(domain)}¢</span>
          <span>0</span>
          <span>-{Math.round(domain)}¢</span>
        </div>

        <div className="absolute inset-y-0 left-10 right-0">
          <div className="absolute inset-x-0 top-1/2 border-t border-border" aria-hidden="true" />

          <div
            className="absolute inset-x-0 z-10"
            style={{ top: `${topFor(avg)}%` }}
            aria-hidden="true"
          >
            <div className="border-t border-dashed border-ai/60" />
            <span className="absolute -top-4 right-0 font-mono text-[0.55rem] text-ai">
              avg
            </span>
          </div>

          <div className="absolute inset-0 flex items-stretch gap-[2px] sm:gap-1">
            {recent.map((call, index) => {
              const value = values[index];
              const positive = value >= 0;
              const status = statusLabel(call.outcomeStatus);

              return (
                <div
                  key={call.analysisId}
                  className="group relative flex-1"
                  title={`${call.recommendation === 'LONG_YES' ? 'YES' : 'NO'} · ${value >= 0 ? '+' : ''}${value.toFixed(1)}¢ edge · ${status} · ${new Date(call.executedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                >
                  <div
                    className={cn(
                      'absolute left-1/2 w-[70%] max-w-[18px] -translate-x-1/2 rounded-sm transition-opacity',
                      positive ? 'bg-yes/75' : 'bg-no/75',
                      call.outcomeStatus === 'pending' ? 'opacity-60' : 'opacity-100',
                      'group-hover:opacity-100'
                    )}
                    style={
                      positive
                        ? { bottom: '50%', height: `${heightFor(value)}%` }
                        : { top: '50%', height: `${heightFor(value)}%` }
                    }
                  />
                  {call.outcomeStatus === 'pending' && (
                    <span
                      className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ai bg-surface"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between pl-10 font-mono text-[0.55rem] text-muted/60">
        <span>
          {new Date(recent[0].executedAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <span>
          {recent.length < ordered.length
            ? `last ${recent.length} calls`
            : `${recent.length} call${recent.length === 1 ? '' : 's'}`}
        </span>
        <span>
          {new Date(recent[recent.length - 1].executedAt).toLocaleDateString(
            undefined,
            { month: 'short', day: 'numeric' }
          )}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-[0.58rem] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-yes" aria-hidden="true" />
          Positive edge
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-no" aria-hidden="true" />
          Negative edge
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ai" aria-hidden="true" />
          Pending
        </span>
      </div>
    </div>
  );
}

function CallRow({
  rec,
}: {
  rec: {
    recommendation: 'LONG_YES' | 'LONG_NO';
    entryPrice: number | null;
    targetPrice: number | null;
    stopLossPrice: number | null;
    outcomeHitPrice: number | null;
    outcomeStatus: 'success' | 'failure' | 'expired' | 'pending';
    edge: number;
    executedAt: string;
  };
}) {
  const statusLabel =
    rec.outcomeStatus === 'success'
      ? 'Target hit'
      : rec.outcomeStatus === 'failure'
        ? 'Stop hit'
        : rec.outcomeStatus === 'expired'
          ? 'Expired'
          : 'Pending';
  const statusClass =
    rec.outcomeStatus === 'success'
      ? 'border-yes/25 bg-yes/10 text-yes'
      : rec.outcomeStatus === 'failure'
        ? 'border-no/25 bg-no/10 text-no'
        : rec.outcomeStatus === 'pending'
          ? 'border-ai/25 bg-ai/10 text-ai'
          : 'border-border bg-surface-2 text-muted';
  const cents = (value: number | null) =>
    value === null ? '-' : `${Math.round(value * 100)}¢`;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <Badge tone={rec.recommendation === 'LONG_YES' ? 'yes' : 'no'} size="sm">
        {rec.recommendation === 'LONG_YES' ? 'YES' : 'NO'}
      </Badge>
      <div className="min-w-0">
        <div className="font-mono text-[0.68rem] text-fg">
          {cents(rec.entryPrice)} →{' '}
          {rec.outcomeStatus === 'success' && rec.targetPrice !== null
            ? cents(rec.targetPrice)
            : rec.outcomeStatus === 'failure' && rec.stopLossPrice !== null
              ? cents(rec.stopLossPrice)
              : cents(rec.outcomeHitPrice)}
        </div>
        <div className="truncate text-[0.58rem] text-muted">
          Target {cents(rec.targetPrice)} · Stop {cents(rec.stopLossPrice)} ·
          Edge{' '}
          <span className={rec.edge > 0 ? 'text-yes' : rec.edge < 0 ? 'text-no' : ''}>
            {rec.edge > 0 ? '+' : ''}
            {Math.round(rec.edge * 100)}¢
          </span>{' '}
          ·{' '}
          {new Date(rec.executedAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </div>
      </div>
      <span
        className={cn(
          'whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.55rem] font-medium',
          statusClass
        )}
      >
        {statusLabel}
      </span>
    </div>
  );
}

// ─── Agent Signals Panel ────────────────────────────────────────────────────

interface AgentSignalData {
  agentName: string;
  direction: string;
  confidence: number;
  fairProbability: number;
  keyDrivers: (string | { category?: string; description?: string; severity?: string })[];
  riskFactors: (string | { category?: string; description?: string; severity?: string })[];
  timestamp?: string;
}

function ResearchPanel({
  signals,
  riskPerspectives,
}: {
  signals: AgentSignalData[];
  riskPerspectives?: string;
}) {
  const sections =
    riskPerspectives && riskPerspectives !== 'Risk perspectives unavailable.'
      ? parseRiskSections(riskPerspectives)
      : [];
  const hasSignals = signals.length > 0;
  const hasRisk = sections.length > 0;
  const [active, setActive] = useState<'signals' | 'risk'>('signals');

  if (!hasSignals && !hasRisk) return null;

  const tabs = [
    hasSignals && { id: 'signals' as const, label: `Agent signals (${signals.length})` },
    hasRisk && { id: 'risk' as const, label: 'Risk views' },
  ].filter(Boolean) as { id: 'signals' | 'risk'; label: string }[];

  return (
    <section id="agent-research" className="scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-fg">Agent research</h2>
          <InfoHint label="What agent signals mean">
            Each agent predicts the outcome it thinks is most likely (YES or NO)
            and how confident it is in that call. The ¢ figure is that
            outcome&apos;s <strong className="text-fg">fair value</strong> -
            what the agent thinks it is really worth. If an agent&apos;s fair
            value is above the market price, it sees that side as underpriced.
            Neutral agents are left out of the final score.
          </InfoHint>
        </div>

        <div className="flex w-fit gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors',
                active === tab.id
                  ? 'bg-surface text-fg shadow-[var(--shadow-sm)]'
                  : 'text-muted hover:text-fg'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border/60">
        {active === 'signals' ? (
          <AgentSignalsContent signals={signals} />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            {sections.map((section) => (
              <RiskPerspectiveCard key={section.label} section={section} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AgentSignalsContent({ signals }: { signals: AgentSignalData[] }) {
  const sorted = [...signals].sort((a, b) => b.confidence - a.confidence);
  const yesCount = signals.filter(
    (signal) => signal.direction === 'YES' || signal.direction === 'LONG_YES'
  ).length;
  const noCount = signals.filter(
    (signal) => signal.direction === 'NO' || signal.direction === 'LONG_NO'
  ).length;
  const neutralCount = signals.length - yesCount - noCount;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs sm:px-5">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-yes" aria-hidden="true" />
          {yesCount} lean YES
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-no" aria-hidden="true" />
          {noCount} lean NO
        </span>
        {neutralCount > 0 && (
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
            {neutralCount} neutral
          </span>
        )}
        <span className="ml-auto hidden font-mono text-[0.6rem] text-muted/60 sm:block">
          sorted by confidence
        </span>
      </div>

      <div className="divide-y divide-border/60 border-t border-border/60">
        {sorted.map((signal) => (
          <AgentSignalRow key={signal.agentName} signal={signal} />
        ))}
      </div>
    </div>
  );
}

function AgentSignalRow({ signal }: { signal: AgentSignalData }) {
  const isYes = signal.direction === 'YES' || signal.direction === 'LONG_YES';
  const isNo = signal.direction === 'NO' || signal.direction === 'LONG_NO';

  const directionLabel = isYes ? 'YES' : isNo ? 'NO' : 'NEUTRAL';
  const directionClass = isYes
    ? 'border-yes/25 bg-yes/[0.08] text-yes'
    : isNo
      ? 'border-no/25 bg-no/[0.06] text-no'
      : 'border-border bg-surface-2 text-muted';
  const confidencePercent = Math.round(signal.confidence * 100);
  const displayFairCents = isNo
    ? Math.round((1 - signal.fairProbability) * 100)
    : Math.round(signal.fairProbability * 100);

  const renderItem = (item: AgentSignalData['keyDrivers'][number]) =>
    typeof item === 'string'
      ? item
      : (item as { description?: string })?.description || JSON.stringify(item);

  return (
    <details className="group">
      <summary className="grid cursor-pointer grid-cols-[3.1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[3.6rem_minmax(0,1fr)_7.5rem_4.2rem] sm:px-5">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[0.58rem] font-semibold',
            directionClass
          )}
        >
          {directionLabel}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.82rem] text-fg">
            {formatAgentDisplayName(signal.agentName)}
          </span>
          <span className="mt-1 flex items-center gap-2 sm:hidden">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className={cn(
                  'block h-full rounded-full',
                  isYes ? 'bg-yes' : isNo ? 'bg-no' : 'bg-muted'
                )}
                style={{ width: `${confidencePercent}%` }}
              />
            </span>
            <span className="w-8 text-right font-mono text-[0.65rem] tabular-nums text-muted">
              {confidencePercent}%
            </span>
          </span>
        </span>
        <span className="hidden items-center gap-2 sm:flex">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className={cn(
                'block h-full rounded-full',
                isYes ? 'bg-yes' : isNo ? 'bg-no' : 'bg-muted'
              )}
              style={{ width: `${confidencePercent}%` }}
            />
          </span>
          <span className="w-8 text-right font-mono text-[0.65rem] tabular-nums text-muted">
            {confidencePercent}%
          </span>
        </span>
        <span className="text-right font-mono text-[0.78rem] tabular-nums text-fg">
          {displayFairCents}¢
        </span>
      </summary>

      <div className="bg-surface-2/25 px-4 pb-4 pt-1 sm:pl-[4.85rem] sm:pr-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.65rem] text-muted">
          <span>
            Confidence <span className="font-mono text-fg">{confidencePercent}%</span>
          </span>
          <span>
            {isNo ? 'NO' : 'YES'} fair value{' '}
            <span className="font-mono text-fg">{displayFairCents}¢</span>
          </span>
        </div>

        {signal.keyDrivers && signal.keyDrivers.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1.5 text-[0.68rem] font-medium text-fg">Key drivers</h4>
            <ul className="space-y-1">
              {signal.keyDrivers.map((driver, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                  <span className="text-accent" aria-hidden="true">•</span>
                  <span>{renderItem(driver)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {signal.riskFactors && signal.riskFactors.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1.5 text-[0.68rem] font-medium text-fg">Risks</h4>
            <ul className="space-y-1">
              {signal.riskFactors.map((risk, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <span>{renderItem(risk)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function formatAgentDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Risk Perspectives ──────────────────────────────────────────────────────

interface RiskPerspective {
  positionSizePct: number;
  kellyFraction: number;
  entryStrategy: string;
  stopLossDistance: number;
  takeProfitDistance: number;
  reasoning: string;
  maxDrawdownTolerance: number;
}

interface RiskSection {
  label: string;
  variant: 'aggressive' | 'conservative' | 'neutral';
  icon: LucideIcon;
  data: RiskPerspective | null;
  raw: string;
}

function RiskPerspectiveCard({ section }: { section: RiskSection }) {
  const { label, variant, icon: Icon, data, raw } = section;

  const borderColor = variant === 'aggressive' ? 'border-no/20' : variant === 'conservative' ? 'border-yes/20' : 'border-ai/20';
  const bgColor = variant === 'aggressive' ? 'bg-no/[0.04]' : variant === 'conservative' ? 'bg-yes/[0.04]' : 'bg-ai/[0.04]';
  const labelColor = variant === 'aggressive' ? 'text-no' : variant === 'conservative' ? 'text-yes' : 'text-ai';

  if (!data) {
    return (
      <div className={cn('h-full rounded-xl border p-4', bgColor, borderColor)}>
        <div className="mb-2 flex items-center gap-2">
          <span className={cn('flex items-center gap-1.5 text-xs font-semibold', labelColor)}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{raw}</p>
      </div>
    );
  }

  // Agents are inconsistent: some return fractions (0.35 = 35%), others return
  // percentages directly (2.5 = 2.5%). Heuristic: if value ≤ 1, it's a fraction.
  const toPercent = (v: number) => v <= 1 ? v * 100 : v;
  const toCents = (v: number) => v <= 1 ? v * 100 : v;

  const positionPct = toPercent(data.positionSizePct);
  const stopLossPct = toCents(data.stopLossDistance);
  const takeProfitPct = toCents(data.takeProfitDistance);
  const maxDrawdownPct = toPercent(data.maxDrawdownTolerance);
  const entryLabel = data.entryStrategy === 'scale_in' ? 'Scale In' :
    data.entryStrategy === 'limit' ? 'Limit Order' : 'Market Order';

  return (
    <div className={cn('h-full rounded-xl border p-4', bgColor, borderColor)}>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn('flex items-center gap-1.5 text-xs font-semibold', labelColor)}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
        </span>
        <span className={cn('ml-auto font-mono text-lg font-bold tabular-nums', labelColor)}>
          {positionPct % 1 === 0 ? positionPct : positionPct.toFixed(1)}%
        </span>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-x-4 gap-y-2 xs:grid-cols-2">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted">Kelly</span>
          <span className="font-mono text-xs font-medium">{data.kellyFraction.toFixed(2)}×</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted">Entry</span>
          <span className="text-xs font-medium">{entryLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted">Stop loss</span>
          <span className="font-mono text-xs font-medium text-no">-{stopLossPct % 1 === 0 ? stopLossPct : stopLossPct.toFixed(1)}¢</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted">Take profit</span>
          <span className="font-mono text-xs font-medium text-yes">+{takeProfitPct % 1 === 0 ? takeProfitPct : takeProfitPct.toFixed(1)}¢</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted">Max drawdown</span>
          <span className="font-mono text-xs font-medium">{maxDrawdownPct % 1 === 0 ? maxDrawdownPct : maxDrawdownPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Risk/Reward bar */}
      <div className="mb-3">
        <div className="flex justify-between text-[0.6rem] text-muted mb-1">
          <span>Risk/Reward</span>
          <span className="font-mono">
            1:{(data.takeProfitDistance / (data.stopLossDistance || 0.01)).toFixed(1)}
          </span>
        </div>
        <div className="flex h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-no/60 rounded-l-full"
            style={{ width: `${(data.stopLossDistance / (data.stopLossDistance + data.takeProfitDistance || 1)) * 100}%` }}
          />
          <div
            className="bg-yes/60 rounded-r-full"
            style={{ width: `${(data.takeProfitDistance / (data.stopLossDistance + data.takeProfitDistance || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Reasoning */}
      {data.reasoning && (
        <p className="text-xs text-fg/70 leading-relaxed border-t border-border/50 pt-2">
          {data.reasoning}
        </p>
      )}
    </div>
  );
}

function parseRiskSections(raw: string): RiskSection[] {
  const configs: Record<string, { label: string; variant: 'aggressive' | 'conservative' | 'neutral'; icon: LucideIcon }> = {
    aggressive: { label: 'Aggressive', variant: 'aggressive', icon: Flame },
    conservative: { label: 'Conservative', variant: 'conservative', icon: Shield },
    neutral: { label: 'Neutral', variant: 'neutral', icon: Scale },
  };

  const sections: RiskSection[] = [];

  // Split by [aggressive], [conservative], [neutral] labels
  const labelRegex = /\[(aggressive|conservative|neutral)\]/gi;
  const parts: Array<{ variant: string; content: string }> = [];
  let lastIndex = 0;
  let labelMatch;

  while ((labelMatch = labelRegex.exec(raw)) !== null) {
    if (parts.length > 0) {
      parts[parts.length - 1].content = raw.slice(lastIndex, labelMatch.index).trim();
    }
    parts.push({ variant: labelMatch[1].toLowerCase(), content: '' });
    lastIndex = labelMatch.index + labelMatch[0].length;
  }
  if (parts.length > 0) {
    parts[parts.length - 1].content = raw.slice(lastIndex).trim();
  }

  // If we found labeled sections, parse each
  if (parts.length >= 1) {
    for (const part of parts) {
      const config = configs[part.variant] || configs.neutral;
      sections.push({
        ...config,
        data: tryParseRiskJson(part.content),
        raw: part.content,
      });
    }
    return sections;
  }

  // Fallback: try to find JSON blocks anywhere
  const jsonRegex = /\{[^{}]*(?:"position_size_pct"|"positionSizePct")[^{}]*\}/g;
  const jsonBlocks: string[] = [];
  let jMatch;
  while ((jMatch = jsonRegex.exec(raw)) !== null) {
    jsonBlocks.push(jMatch[0]);
  }

  const configList = [configs.aggressive, configs.conservative, configs.neutral];
  if (jsonBlocks.length >= 3) {
    return jsonBlocks.slice(0, 3).map((block, i) => ({
      ...configList[i],
      data: tryParseRiskJson(block),
      raw: block,
    }));
  }

  // Last resort: split by double newlines
  const rawParts = raw.split(/\n\n+/).filter(Boolean);
  return rawParts.slice(0, 3).map((p, i) => ({
    ...(configList[i] || configList[2]),
    data: tryParseRiskJson(p),
    raw: p,
  })).filter((s) => s.data || s.raw.length > 0);
}

function tryParseRiskJson(text: string): RiskPerspective | null {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;

    const data = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));

    return {
      positionSizePct: data.position_size_pct ?? data.positionSizePct ?? 0,
      kellyFraction: data.kelly_fraction ?? data.kellyFraction ?? 0,
      entryStrategy: data.entry_strategy ?? data.entryStrategy ?? 'market',
      stopLossDistance: data.stop_loss_distance ?? data.stopLossDistance ?? 0,
      takeProfitDistance: data.take_profit_distance ?? data.takeProfitDistance ?? 0,
      reasoning: data.reasoning ?? '',
      maxDrawdownTolerance: data.max_drawdown_tolerance ?? data.maxDrawdownTolerance ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function MarketDetailSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="h-3 w-36 rounded bg-surface-2" />

      <div className="mt-6 flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1 space-y-3">
          <div className="h-5 w-28 rounded-full bg-surface-2" />
          <div className="h-10 w-3/4 rounded bg-surface-2 sm:h-12" />
          <div className="h-5 w-1/2 rounded bg-surface-2" />
        </div>
        <div className="h-[104px] w-full rounded-2xl bg-surface-2 lg:w-[300px]" />
      </div>
      <div className="mt-7 h-2 w-full rounded-full bg-surface-2" />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[380px] rounded-2xl bg-surface-2" />
        <div className="h-[420px] rounded-2xl bg-surface-2" />
        <div className="h-[300px] rounded-2xl bg-surface-2" />
        <div className="h-[240px] rounded-2xl bg-surface-2" />
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function MarketDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  // Fetch market data by slug
  const {
    data: market,
    isLoading,
    error,
  } = useQuery<PolymarketMarket | null>({
    queryKey: ['market-by-slug', slug],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/market-by-slug?slug=${slug}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to load market');
      }
      return response.json();
    },
    enabled: !!slug,
    staleTime: 30_000,
  });

  // Extract token IDs for price history
  const { yesTokenId, noTokenId } = useMemo(() => {
    if (!market?.clobTokenIds) return { yesTokenId: null, noTokenId: null };
    try {
      const ids = JSON.parse(market.clobTokenIds);
      return { yesTokenId: ids[0] || null, noTokenId: ids[1] || null };
    } catch {
      return { yesTokenId: null, noTokenId: null };
    }
  }, [market]);

  // Fetch real-time token prices
  const { data: realtimePrices } = useQuery<Record<string, { bidPrice: number; askPrice: number; midPrice: number; spread: number }>>({
    queryKey: ['market-realtime-prices', market?.clobTokenIds],
    queryFn: async () => {
      if (!market?.clobTokenIds) return {};
      const tokenIds = JSON.parse(market.clobTokenIds);
      const response = await fetch('/api/polymarket/public-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds }),
      });
      if (!response.ok) return {};
      return response.json();
    },
    enabled: !!market?.clobTokenIds && !market?.closed,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  // Merge real-time prices into the market object for downstream components
  const marketWithPrices = useMemo(() => {
    if (!market) return null;
    if (!realtimePrices || Object.keys(realtimePrices).length === 0) return market;
    return { ...market, realtimePrices };
  }, [market, realtimePrices]);

  const conditionId = market?.conditionId || null;
  const marketId = market?.conditionId || market?.id || null;

  // Fetch analysis data
  const { data: analysis } = useMarketAnalysis(marketId);

  // Plan for upgrade prompt
  const { plan } = useCurrentPlan();

  // State for analysis modal
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  // State for trade execution scroll target
  const [tradeModal, setTradeModal] = useState<{ side: TradeSide } | null>(null);

  const isClosed = market?.closed === true;

  if (isLoading) {
    return (
      <AppShell>
        <MarketDetailSkeleton />
      </AppShell>
    );
  }

  if (error || !market) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-20">
          <Card className="p-8 text-center max-w-md">
            <h1 className="text-lg font-semibold mb-2">Market Not Found</h1>
            <p className="text-sm text-muted mb-4">
              {error instanceof Error
                ? error.message
                : "The market you're looking for doesn't exist or has been removed."}
            </p>
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Markets
            </Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  const aiFairCents =
    analysis?.metadata?.consensusProbability != null &&
      analysis.metadata.consensusProbability > 0
      ? Math.round(analysis.metadata.consensusProbability * 100)
      : null;

  return (
    <AppShell>
      <div className="w-full">
        <MarketMasthead market={marketWithPrices!} analysis={analysis} />

        {plan === 'free' && (
          <div className="mt-5">
            <UpgradeNudge />
          </div>
        )}

        <div className="mt-5 grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* Chart */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <ChartPanel
              conditionId={conditionId}
              yesTokenId={yesTokenId}
              noTokenId={noTokenId}
              aiCents={aiFairCents}
              recommendation={analysis?.action}
            />
          </div>

          {/* AI desk - sticky on desktop, directly after the chart on mobile */}
          <div className="min-w-0 space-y-3 lg:sticky lg:top-[72px] lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
            <AIPanel
              marketSlug={marketId ?? ''}
              yesCents={getYesProbability(marketWithPrices!)}
              onQuickBuy={(side) => setTradeModal({ side })}
              onRequestAnalysis={() => setIsAnalysisModalOpen(true)}
              disabled={isClosed}
            />
            {plan === 'pro' || plan === 'elite' ? (
              <PMActivationCard slug={market.slug} conditionId={market.conditionId} />
            ) : (
              <PortfolioManagerTeaser />
            )}
            <MarketDetails market={market} />
          </div>

          {/* Market data + research */}
          <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-2">
            <div
              className={cn(
                'grid items-start gap-3',
                market.description &&
                'xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'
              )}
            >
              <OrderBookPanel market={market} />
              <MarketBrief market={market} />
            </div>

            <ResearchPanel
              signals={analysis?.agentSignals ?? []}
              riskPerspectives={analysis?.riskPerspectivesRaw}
            />

            <AnalysisHistoryPanel
              marketId={marketId}
              conditionId={conditionId}
              yesTokenId={yesTokenId}
            />
          </div>
        </div>
      </div>

      {/* Analysis Modal with eleven-stage progress pipeline */}
      <AnalysisModal
        slug={marketId ?? slug}
        open={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        hasExistingAnalysis={!!analysis}
      />

      {/* Trade Modal */}
      <Modal
        open={!!tradeModal}
        onClose={() => setTradeModal(null)}
        title="Place Order"
        size="sm"
        mobileSheet
      >
        {tradeModal && (
          <TradePanel
            slug={market.slug}
            initialSide={tradeModal.side}
            embedded
          />
        )}
      </Modal>
      <ScrollToTop />
    </AppShell>
  );
}
