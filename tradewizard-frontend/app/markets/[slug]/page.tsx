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
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import usePriceHistory, { type TimeRange, type PriceHistoryPoint } from '@/hooks/usePriceHistory';
import useOrderBook from '@/hooks/useOrderBook';
import { useMarketAnalysis } from '@/hooks/useMarketAnalysis';
import { useMarketAnalysisHistory } from '@/hooks/useMarketAnalysisHistory';
import { useAnalysisDetail } from '@/hooks/useAnalysisResults';
import { useMarketTradePerformance } from '@/hooks/useMarketTradePerformance';
import { useAgentAccuracy, type AgentAccuracyItem } from '@/hooks/useAgentAccuracy';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/classNames';
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
    } catch {}
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

// ─── Breadcrumb ─────────────────────────────────────────────────────────────

function Breadcrumb({ marketTitle }: { marketTitle: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 sm:mb-4">
      <ol className="flex items-center gap-1.5 text-xs sm:text-sm text-muted">
        <li>
          <Link href="/markets" className="hover:text-fg transition-colors">
            Markets
          </Link>
        </li>
        <li aria-hidden="true">
          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </li>
        <li>
          <span className="text-fg font-medium truncate max-w-[200px] sm:max-w-[300px] md:max-w-[400px] inline-block align-bottom">
            {marketTitle}
          </span>
        </li>
      </ol>
    </nav>
  );
}

// ─── Market Header ──────────────────────────────────────────────────────────

function MarketHeader({ market, recommendation }: { market: PolymarketMarket; recommendation?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE' | null }) {
  const yesCents = getYesProbability(market);
  const noCents = 100 - yesCents;
  const isNo = recommendation === 'LONG_NO';

  return (
    <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4 mb-4 sm:mb-6">
      {/* Market Image */}
      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-surface-2 flex items-center justify-center shrink-0 overflow-hidden border border-border relative">
        {market.image ? (
          <Image
            src={market.image}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 48px, 64px"
            unoptimized
          />
        ) : market.icon ? (
          <span className="text-xl sm:text-2xl">{market.icon}</span>
        ) : (
          <span className="text-xl sm:text-2xl opacity-50">📊</span>
        )}
      </div>

      {/* Title + Stats */}
      <div className="flex-1 min-w-0">
        <h1 className="font-display text-lg sm:text-xl md:text-2xl font-bold leading-tight mb-1.5 sm:mb-2">
          {market.question}
        </h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted">
          {market.eventTitle && (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
              <span className="truncate max-w-[150px] sm:max-w-none">{market.eventTitle}</span>
            </span>
          )}
          {market.volume && (
            <span>{formatVolume(market.volume)} vol</span>
          )}
          {(market.endDateIso || market.endDate) && (
            <span className="hidden xs:inline">Ends {formatEndDate(market.endDateIso || market.endDate)}</span>
          )}
          {market.liquidity && (
            <span className="hidden sm:inline">{formatVolume(market.liquidity)} liquidity</span>
          )}
        </div>

        {/* Probability summary */}
        <div className="flex items-center gap-3 sm:gap-4 mt-2.5 sm:mt-3">
          <ProbabilityBar cents={isNo ? noCents : yesCents} variant="thick" className="flex-1 max-w-[160px] sm:max-w-[200px]" />
          <div className="flex items-center gap-2 sm:gap-3">
            {isNo ? (
              <>
                <span className="font-mono text-base sm:text-lg font-bold text-no tabular-nums">
                  No {noCents}¢
                </span>
                <span className="font-mono text-base sm:text-lg font-bold text-yes tabular-nums">
                  Yes {yesCents}¢
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-base sm:text-lg font-bold text-yes tabular-nums">
                  Yes {yesCents}¢
                </span>
                <span className="font-mono text-base sm:text-lg font-bold text-no tabular-nums">
                  No {noCents}¢
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Chart Panel ────────────────────────────────────────────────────────────

type ChartTimeRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

function ChartPanel({
  conditionId,
  yesTokenId,
  noTokenId,
}: {
  conditionId: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
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

  const chartTabs: { id: ChartTimeRange; label: string }[] = [
    { id: '1H', label: '1H' },
    { id: '1D', label: '1D' },
    { id: '1W', label: '1W' },
    { id: '1M', label: '1M' },
    { id: 'ALL', label: 'ALL' },
  ];

  return (
    <Card className="p-3 sm:p-5 mb-3 sm:mb-4">
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h2 className="text-xs sm:text-sm font-semibold text-muted uppercase tracking-wider">
          Price Chart
        </h2>
        <Tabs tabs={chartTabs} active={timeRange} onChange={(id) => setTimeRange(id as ChartTimeRange)} />
      </div>

      {/* Chart area - responsive height */}
      <div className="h-[200px] sm:h-[240px] md:h-[280px] rounded-lg bg-surface-2 flex items-center justify-center relative overflow-hidden">
        {isLoading ? (
          <div className="animate-pulse text-muted text-sm">Loading chart…</div>
        ) : error ? (
          <div className="text-muted text-sm text-center px-4">
            <p>Unable to load price data</p>
            <p className="text-xs mt-1 opacity-60">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : priceHistory && priceHistory.data.length > 0 ? (
          <DualLineChart
            yesData={priceHistory.data}
            noData={priceHistory.noData || []}
          />
        ) : (
          <div className="text-muted text-sm">No price data available</div>
        )}
      </div>

      {/* Legend */}
      {priceHistory && priceHistory.data.length > 0 && (
        <div className="flex items-center gap-4 mt-3 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full bg-yes" />
            <span className="text-xs text-muted">Yes</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full bg-no" />
            <span className="text-xs text-muted">No</span>
          </div>
          {priceHistory.dataSource === 'synthetic' && (
            <span className="text-xs text-muted opacity-60 ml-auto">Simulated data</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Dual-line SVG chart showing YES (green) and NO (red) price history */
function DualLineChart({
  yesData,
  noData,
}: {
  yesData: PriceHistoryPoint[];
  noData: PriceHistoryPoint[];
}) {
  const chartId = useId();

  const allPrices = [
    ...yesData.map((p) => p.price),
    ...noData.map((p) => p.price),
  ];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice || 0.01;

  const width = 100;
  const height = 100;
  const padding = 2;

  function buildPath(data: PriceHistoryPoint[]): string {
    if (data.length === 0) return '';
    const points = data.map((point, i) => {
      const x = padding + ((width - 2 * padding) * i) / (data.length - 1 || 1);
      const y = height - padding - ((point.price - minPrice) / range) * (height - 2 * padding);
      return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
  }

  const yesPath = buildPath(yesData);
  const noPath = buildPath(noData);

  const yesLastPrice = yesData.length > 0 ? yesData[yesData.length - 1].price : 0;
  const yesFirstPrice = yesData.length > 0 ? yesData[0].price : 0;
  const noLastPrice = noData.length > 0 ? noData[noData.length - 1].price : 0;
  const noFirstPrice = noData.length > 0 ? noData[0].price : 0;

  const yesChange = yesLastPrice - yesFirstPrice;
  const noChange = noLastPrice - noFirstPrice;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Price labels */}
      <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex flex-col">
            <span className="font-mono text-base sm:text-lg font-bold tabular-nums text-yes">
              {(yesLastPrice * 100).toFixed(1)}¢
            </span>
            <span className="text-[10px] sm:text-xs font-mono tabular-nums text-yes opacity-75">
              {yesChange >= 0 ? '+' : ''}{(yesChange * 100).toFixed(1)}¢
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-base sm:text-lg font-bold tabular-nums text-no">
              {(noLastPrice * 100).toFixed(1)}¢
            </span>
            <span className="text-[10px] sm:text-xs font-mono tabular-nums text-no opacity-75">
              {noChange >= 0 ? '+' : ''}{(noChange * 100).toFixed(1)}¢
            </span>
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="flex-1 w-full"
        aria-label="Price history chart showing YES and NO token prices"
        role="img"
      >
        <defs>
          {/* YES gradient */}
          <linearGradient id={`${chartId}-yesGradient`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(72% 0.16 155)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="oklch(72% 0.16 155)" stopOpacity="0" />
          </linearGradient>
          {/* NO gradient */}
          <linearGradient id={`${chartId}-noGradient`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(65% 0.18 25)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="oklch(65% 0.18 25)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* YES fill area */}
        {yesPath && (
          <path
            d={`${yesPath} L ${width - padding},${height} L ${padding},${height} Z`}
            fill={`url(#${chartId}-yesGradient)`}
          />
        )}
        {/* NO fill area */}
        {noPath && (
          <path
            d={`${noPath} L ${width - padding},${height} L ${padding},${height} Z`}
            fill={`url(#${chartId}-noGradient)`}
          />
        )}

        {/* YES line */}
        {yesPath && (
          <path
            d={yesPath}
            fill="none"
            stroke="oklch(72% 0.16 155)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* NO line */}
        {noPath && (
          <path
            d={noPath}
            fill="none"
            stroke="oklch(65% 0.18 25)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
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

  return (
    <Card className="p-3 sm:p-5 mb-3 sm:mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left lg:cursor-default"
        aria-expanded={isExpanded}
      >
        <h2 className="text-xs sm:text-sm font-semibold text-muted uppercase tracking-wider">
          Order Book
        </h2>
        <svg
          className={cn(
            'w-4 h-4 text-muted transition-transform lg:hidden',
            isExpanded && 'rotate-180'
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className={cn(
        'mt-4 transition-all',
        !isExpanded && 'hidden lg:block'
      )}>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted text-sm">Loading order book…</div>
          </div>
        ) : error ? (
          <div className="text-muted text-sm text-center py-4">
            Unable to load order book data
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* YES side */}
            <div>
              <h3 className="text-xs font-semibold text-yes mb-2 flex items-center justify-between">
                <span>YES</span>
                <span className="text-muted font-normal">Bids / Asks</span>
              </h3>

              {/* YES Bids (buy orders) */}
              <div className="space-y-0.5 mb-2">
                {yesBids.length > 0 ? (
                  yesBids.map((level, i) => (
                    <OrderBookRow
                      key={`yes-bid-${i}`}
                      price={level.price}
                      size={level.size}
                      maxSize={maxSize}
                      side="bid"
                      token="yes"
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted py-1">No bids</div>
                )}
              </div>

              {/* Spread indicator */}
              {yesBids.length > 0 && yesAsks.length > 0 && (
                <div className="text-[10px] text-muted text-center py-0.5 border-y border-border/50">
                  Spread: {(parseFloat(yesAsks[0].price) - parseFloat(yesBids[0].price)).toFixed(3)}
                </div>
              )}

              {/* YES Asks (sell orders) */}
              <div className="space-y-0.5 mt-2">
                {yesAsks.length > 0 ? (
                  yesAsks.map((level, i) => (
                    <OrderBookRow
                      key={`yes-ask-${i}`}
                      price={level.price}
                      size={level.size}
                      maxSize={maxSize}
                      side="ask"
                      token="yes"
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted py-1">No asks</div>
                )}
              </div>
            </div>

            {/* NO side */}
            <div>
              <h3 className="text-xs font-semibold text-no mb-2 flex items-center justify-between">
                <span>NO</span>
                <span className="text-muted font-normal">Bids / Asks</span>
              </h3>

              {/* NO Bids */}
              <div className="space-y-0.5 mb-2">
                {noBids.length > 0 ? (
                  noBids.map((level, i) => (
                    <OrderBookRow
                      key={`no-bid-${i}`}
                      price={level.price}
                      size={level.size}
                      maxSize={maxSize}
                      side="bid"
                      token="no"
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted py-1">No bids</div>
                )}
              </div>

              {/* Spread indicator */}
              {noBids.length > 0 && noAsks.length > 0 && (
                <div className="text-[10px] text-muted text-center py-0.5 border-y border-border/50">
                  Spread: {(parseFloat(noAsks[0].price) - parseFloat(noBids[0].price)).toFixed(3)}
                </div>
              )}

              {/* NO Asks */}
              <div className="space-y-0.5 mt-2">
                {noAsks.length > 0 ? (
                  noAsks.map((level, i) => (
                    <OrderBookRow
                      key={`no-ask-${i}`}
                      price={level.price}
                      size={level.size}
                      maxSize={maxSize}
                      side="ask"
                      token="no"
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted py-1">No asks</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tick size info */}
        {yesBook?.tick_size && (
          <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted">
            <span>Tick: {yesBook.tick_size}</span>
            <span>Min order: {yesBook.min_order_size}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Single row in the order book with depth visualization */
function OrderBookRow({
  price,
  size,
  maxSize,
  side,
  token,
}: {
  price: string;
  size: string;
  maxSize: number;
  side: 'bid' | 'ask';
  token: 'yes' | 'no';
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
    <div className="relative flex items-center justify-between text-xs py-0.5 px-2 rounded overflow-hidden">
      {/* Depth bar */}
      <div
        className={cn('absolute inset-y-0 left-0 opacity-30', bgColor)}
        style={{ width: `${depthPercent}%` }}
      />
      <span className={cn('font-mono tabular-nums relative z-10', textColor)}>
        {priceCents}¢
      </span>
      <span className="text-muted tabular-nums font-mono relative z-10">
        {sizeNum >= 1000 ? `${(sizeNum / 1000).toFixed(1)}K` : Math.floor(sizeNum).toLocaleString()}
      </span>
    </div>
  );
}

// ─── Market Description ─────────────────────────────────────────────────────

function MarketDescription({ market }: { market: PolymarketMarket }) {
  if (!market.description) return null;

  return (
    <Expandable summary="Market Description" defaultOpen={false}>
      <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
        {market.description}
      </p>
    </Expandable>
  );
}

// ─── Analysis History Panel ─────────────────────────────────────────────────

function AnalysisHistoryPanel({ marketId, conditionId, yesTokenId }: { marketId: string | null; conditionId: string | null; yesTokenId: string | null }) {
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

  return (
    <div className="mt-4 sm:mt-6 rounded-[12px] border border-border bg-surface p-3 sm:p-5">
      {/* Tabs */}
      <div className="flex gap-0 mb-3 sm:mb-5 border-b border-border overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('timeline')}
          className={cn(
            'pb-2 px-3 sm:px-4 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'timeline'
              ? 'text-fg border-ai'
              : 'text-muted border-transparent hover:text-fg'
          )}
        >
          Analysis History
        </button>
        <button
          onClick={() => setActiveTab('performance')}
          className={cn(
            'pb-2 px-3 sm:px-4 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'performance'
              ? 'text-fg border-ai'
              : 'text-muted border-transparent hover:text-fg'
          )}
        >
          AI vs Market
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={cn(
            'pb-2 px-3 sm:px-4 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'agents'
              ? 'text-fg border-ai'
              : 'text-muted border-transparent hover:text-fg'
          )}
        >
          Agent Performance
        </button>
      </div>

      {/* Timeline Tab */}
      {activeTab === 'timeline' && (
        <>
          {isLoading ? (
            <div className="space-y-4 animate-pulse pl-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-1/3 rounded bg-surface-2" />
                  <div className="h-4 w-2/3 rounded bg-surface-2" />
                  <div className="h-3 w-1/2 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted">
              No past analyses for this market yet. Request one above to get started.
            </p>
          ) : (
            <>
              {/* Timeline */}
              <div className="relative pl-6">
                {/* Vertical timeline line */}
                <div
                  className="absolute left-[5px] top-2 bottom-2 w-px bg-border"
                  aria-hidden="true"
                />

                <div className="space-y-5">
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
              </div>

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className={cn(
                    'w-full mt-4 py-2 text-xs font-medium rounded-lg border border-border',
                    'text-muted hover:text-fg hover:bg-surface-2 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {isFetchingNextPage ? 'Loading…' : `Load more (${totalCount - items.length} remaining)`}
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* Performance Tab */}
      {activeTab === 'performance' && (
        <PerformanceSummary items={items} conditionId={conditionId} />
      )}

      {/* Agent Performance Tab */}
      {activeTab === 'agents' && (
        <MarketAgentPerformance conditionId={conditionId} />
      )}
    </div>
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
    item.recommendation === 'LONG_YES' ? 'BUY YES' :
    item.recommendation === 'LONG_NO' ? 'BUY NO' : 'NO TRADE';
  const recTone: 'yes' | 'no' | 'warning' =
    item.recommendation === 'LONG_YES' ? 'yes' :
    item.recommendation === 'LONG_NO' ? 'no' : 'warning';

  // Dot color: ai-glow for latest, accent color for rest
  const dotClasses = isLatest
    ? 'border-ai bg-ai shadow-[0_0_6px_var(--ai)]'
    : recTone === 'yes'
    ? 'border-yes bg-yes'
    : recTone === 'no'
    ? 'border-no bg-no'
    : 'border-border bg-bg';

  const dateStr = new Date(item.executedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = new Date(item.executedAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="relative">
      {/* Timeline dot */}
      <span
        className={cn(
          'absolute -left-6 top-1 w-[11px] h-[11px] rounded-full border-2',
          dotClasses
        )}
        aria-hidden="true"
      />

      {/* Entry content */}
      <div>
        {/* Meta row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[0.65rem] font-mono text-muted">
            {dateStr} · {timeStr}
          </span>
          <Badge tone={recTone} size="sm">{recLabel}</Badge>
          {item.wasCachedDelivery && (
            <span className="text-[10px] text-muted px-1.5 py-0.5 rounded bg-surface-2">
              cached
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex gap-3 text-[0.65rem] font-mono text-muted mb-1">
          <span>Confidence: <span className="text-fg">{Math.round(item.confidence * 100)}%</span></span>
          <span>
            {item.recommendation === 'LONG_NO' ? 'NO' : 'YES'} Fair:{' '}
            <span className="text-fg">
              {item.recommendation === 'LONG_NO'
                ? Math.round((1 - item.consensusProbability) * 100)
                : Math.round(item.consensusProbability * 100)}¢
            </span>
          </span>
        </div>

        {/* Expand toggle */}
        <button
          onClick={onToggle}
          className="text-xs text-accent hover:underline focus:outline-none"
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'Hide details' : 'View details & agent signals'}
        </button>

        {/* Expanded detail - lazy loaded */}
        {isExpanded && (
          <div className="mt-3">
            <AnalysisHistoryDetail analysisId={item.analysisId} />
          </div>
        )}
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
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 py-2">
            <div className="h-3 w-28 rounded bg-surface-2" />
            <div className="h-1.5 flex-1 rounded bg-surface-2" />
            <div className="h-3 w-10 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted mb-1">No scored recommendations yet</p>
        <p className="text-xs text-muted">
          Agent performance data appears after trade recommendations hit their TP or SL levels on this market.
        </p>
      </div>
    );
  }

  const totalSignals = agents.reduce((sum, a) => sum + a.totalSignals, 0);
  const avgAccuracy = agents.reduce((sum, a) => sum + a.accuracy * a.totalSignals, 0) / totalSignals;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Based on <span className="font-mono font-semibold text-fg">{totalSignals}</span> scored signals (30d)
        </p>
        <span className={cn(
          'text-xs font-mono font-semibold px-2 py-0.5 rounded',
          avgAccuracy >= 60 ? 'bg-yes/10 text-yes' : avgAccuracy >= 50 ? 'bg-warning/10 text-warning' : 'bg-no/10 text-no'
        )}>
          Avg {Math.round(avgAccuracy)}%
        </span>
      </div>

      {/* Agent leaderboard */}
      <div className="space-y-0">
        {agents.map((agent, idx) => {
          const barColor = agent.accuracy >= 70 ? 'bg-yes' : agent.accuracy >= 50 ? 'bg-ai' : 'bg-no';
          const textColor = agent.accuracy >= 70 ? 'text-yes' : agent.accuracy >= 50 ? 'text-fg' : 'text-no';

          return (
            <div
              key={agent.name}
              className="flex items-center gap-2 sm:gap-3 py-2 sm:py-2.5 border-b border-border/50 last:border-b-0"
            >
              {/* Rank */}
              <span className="text-[0.6rem] font-mono text-muted w-4 text-right shrink-0">
                {idx + 1}.
              </span>

              {/* Agent name */}
              <span className="text-[0.75rem] sm:text-[0.8rem] font-medium flex-1 truncate min-w-0">
                {agent.name}
              </span>

              {/* Accuracy bar */}
              <div className="w-16 sm:w-20 h-1.5 bg-surface-2 rounded-full overflow-hidden shrink-0">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-300', barColor)}
                  style={{ width: `${agent.accuracy}%` }}
                />
              </div>

              {/* Accuracy % */}
              <span className={cn(
                'font-mono text-[0.75rem] font-semibold tabular-nums w-10 text-right shrink-0',
                textColor
              )}>
                {Math.round(agent.accuracy)}%
              </span>

              {/* Signal count */}
              <span className="text-[0.6rem] text-muted font-mono tabular-nums w-6 text-right shrink-0 hidden sm:block">
                ({agent.totalSignals})
              </span>
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      <p className="text-[0.6rem] text-muted pt-2 border-t border-border/50 leading-relaxed">
        Accuracy = how often an agent&apos;s direction aligned with profitable trades (TP hit)
        or warned against losing trades (SL hit) on this market.
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

  // Only data source: real trade performance (TP/SL outcomes) from the recommendation scorer
  const { data: tradePerf, isLoading: isPerfLoading } = useMarketTradePerformance(conditionId);

  if (total === 0) {
    return (
      <p className="text-sm text-muted">
        No analyses yet. Performance data will appear after analyses are completed.
      </p>
    );
  }

  const avgConfidence = items.reduce((sum, i) => sum + i.confidence, 0) / total;
  const recommendations = tradePerf?.recommendations ?? [];
  const summary = tradePerf?.summary;
  const hasResolvedData = summary && summary.resolved > 0;

  // SVG chart dimensions
  const W = 400;
  const H = 140;
  const padX = 20;
  const padY = 16;

  // Build chart from recommendation scorer data only
  const chartRecs = [...recommendations].sort(
    (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
  );

  // X positioning: evenly spaced if we have data, time-based
  const earliestTime = chartRecs.length > 0 ? new Date(chartRecs[0].executedAt).getTime() : Date.now();
  const latestTime = chartRecs.length > 0 ? new Date(chartRecs[chartRecs.length - 1].executedAt).getTime() : Date.now();
  const timeSpan = latestTime - earliestTime || 1;

  const toX = (executedAt: string) => {
    if (chartRecs.length === 1) return W / 2;
    const t = new Date(executedAt).getTime();
    return padX + ((t - earliestTime) / timeSpan) * (W - padX * 2);
  };
  const toY = (prob: number) =>
    padY + (1 - prob) * (H - padY * 2);

  return (
    <div className="space-y-5">
      {/* Performance summary stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="relative overflow-hidden text-center py-3 sm:py-4 px-2 sm:px-3 rounded-xl border border-border bg-gradient-to-b from-surface to-surface-2">
          <div className={cn(
            'font-mono text-lg sm:text-xl font-bold tabular-nums tracking-tight',
            hasResolvedData && summary.winRate !== null
              ? (summary.winRate >= 0.6 ? 'text-yes' : 'text-warning')
              : 'text-fg'
          )}>
            {hasResolvedData && summary.winRate !== null
              ? `${Math.round(summary.winRate * 100)}%`
              : '-'}
          </div>
          <div className="text-[0.55rem] sm:text-[0.6rem] text-muted mt-1 uppercase tracking-wider">
            {hasResolvedData
              ? `Win Rate (${summary.successes}/${summary.resolved} trades)`
              : 'Win Rate'}
          </div>
          {hasResolvedData && summary.winRate !== null && summary.winRate >= 0.6 && (
            <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-yes/10 blur-xl" />
          )}
        </div>
        <div className="relative overflow-hidden text-center py-3 sm:py-4 px-2 sm:px-3 rounded-xl border border-border bg-gradient-to-b from-surface to-surface-2">
          <div className={cn(
            'font-mono text-lg sm:text-xl font-bold tabular-nums tracking-tight',
            hasResolvedData && summary.avgEdgeCaptured !== null && summary.avgEdgeCaptured > 0 ? 'text-yes' : 'text-fg'
          )}>
            {hasResolvedData && summary.avgEdgeCaptured !== null
              ? `+${Math.round(summary.avgEdgeCaptured * 100)}¢`
              : '0¢'}
          </div>
          <div className="text-[0.55rem] sm:text-[0.6rem] text-muted mt-1 uppercase tracking-wider">
            Avg Edge Captured
          </div>
          {hasResolvedData && summary.avgEdgeCaptured !== null && summary.avgEdgeCaptured > 0 && (
            <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-yes/10 blur-xl" />
          )}
        </div>
        <div className="relative overflow-hidden text-center py-3 sm:py-4 px-2 sm:px-3 rounded-xl border border-border bg-gradient-to-b from-surface to-surface-2">
          <div className="font-mono text-lg sm:text-xl font-bold tabular-nums tracking-tight">
            {Math.round(avgConfidence * 100)}%
          </div>
          <div className="text-[0.55rem] sm:text-[0.6rem] text-muted mt-1 uppercase tracking-wider">Avg Confidence</div>
          <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-ai/8 blur-xl" />
        </div>
      </div>

      {/* Trade Outcomes Breakdown */}
      {hasResolvedData && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'TP Hit', value: summary.successes, color: 'text-yes' },
            { label: 'SL Hit', value: summary.failures, color: 'text-no' },
            { label: 'Expired', value: summary.expired, color: 'text-muted' },
            { label: 'Pending', value: summary.pending, color: 'text-ai' },
          ].map((stat) => (
            <div key={stat.label} className="text-center py-2 px-1 rounded-lg border border-border/50 bg-surface-2/50">
              <div className={cn('font-mono text-sm font-bold tabular-nums', stat.color)}>
                {stat.value}
              </div>
              <div className="text-[0.5rem] text-muted mt-0.5 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* SVG Performance Chart - recommendation outcomes only */}
      {recommendations.length > 0 ? (
        <div className="relative rounded-xl border border-border overflow-hidden">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-surface-2 via-surface to-surface-2" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(58%_0.18_295_/_0.04),transparent_60%)]" />

          {/* Chart area */}
          <div className="relative p-3 sm:p-5 pb-3 sm:pb-4">
            {/* Chart title */}
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-ai shadow-[0_0_6px_oklch(58%_0.18_295)]" />
                <span className="text-[0.65rem] sm:text-[0.7rem] font-semibold text-fg/80 uppercase tracking-wider">Recommendation Outcomes</span>
              </div>
              <span className="text-[0.55rem] sm:text-[0.6rem] font-mono text-muted">{recommendations.length} scored</span>
            </div>

            {/* SVG Chart */}
            <div className="h-[140px] sm:h-[160px] md:h-[180px] relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                fill="none"
                className="w-full h-full"
                style={{ overflow: 'hidden' }}
                aria-label="Recommendation performance chart showing entry, TP, and SL levels with outcomes"
              >
                <defs>
                  <filter id="perf-dot-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Subtle horizontal grid */}
                {[0.25, 0.5, 0.75].map((level) => (
                  <line
                    key={level}
                    x1={padX}
                    y1={toY(level)}
                    x2={W - padX}
                    y2={toY(level)}
                    stroke="oklch(62% 0.012 260)"
                    strokeWidth="0.3"
                    opacity="0.25"
                    strokeDasharray="2 4"
                  />
                ))}

                {/* Each recommendation: entry + TP/SL zone + outcome */}
                {chartRecs.map((rec, idx) => {
                  const cx = toX(rec.executedAt);
                  const entryY = rec.entryPrice !== null ? toY(rec.entryPrice) : toY(rec.marketProbability);
                  const targetY = rec.targetPrice !== null ? toY(rec.targetPrice) : null;
                  const stopY = rec.stopLossPrice !== null ? toY(rec.stopLossPrice) : null;
                  const isSuccess = rec.outcomeStatus === 'success';
                  const isFailure = rec.outcomeStatus === 'failure';
                  const isPending = rec.outcomeStatus === 'pending';
                  const isLongNo = rec.recommendation === 'LONG_NO';

                  return (
                    <g key={idx}>
                      {/* TP zone line (green dashed) */}
                      {targetY !== null && (
                        <line
                          x1={cx - 10}
                          y1={targetY}
                          x2={cx + 10}
                          y2={targetY}
                          stroke="oklch(72% 0.16 155)"
                          strokeWidth="1"
                          strokeDasharray="2 1"
                          opacity="0.7"
                        />
                      )}
                      {/* SL zone line (red dashed) */}
                      {stopY !== null && (
                        <line
                          x1={cx - 10}
                          y1={stopY}
                          x2={cx + 10}
                          y2={stopY}
                          stroke="oklch(65% 0.18 25)"
                          strokeWidth="1"
                          strokeDasharray="2 1"
                          opacity="0.7"
                        />
                      )}
                      {/* Vertical connector between TP and SL */}
                      {targetY !== null && stopY !== null && (
                        <line
                          x1={cx}
                          y1={targetY}
                          x2={cx}
                          y2={stopY}
                          stroke="oklch(62% 0.012 260)"
                          strokeWidth="0.5"
                          opacity="0.2"
                        />
                      )}
                      {/* Entry price dot */}
                      <g filter="url(#perf-dot-glow)">
                        <circle
                          cx={cx}
                          cy={entryY}
                          r="5"
                          fill={
                            isSuccess ? 'oklch(72% 0.16 155)'
                            : isFailure ? 'oklch(65% 0.18 25)'
                            : isPending ? 'oklch(58% 0.18 295)'
                            : 'oklch(45% 0.012 260)'
                          }
                          opacity="0.3"
                        />
                        <circle
                          cx={cx}
                          cy={entryY}
                          r="3.5"
                          fill={
                            isSuccess ? 'oklch(72% 0.16 155)'
                            : isFailure ? 'oklch(65% 0.18 25)'
                            : isPending ? 'oklch(58% 0.18 295)'
                            : 'oklch(45% 0.012 260)'
                          }
                          stroke="oklch(14% 0.015 260)"
                          strokeWidth="0.5"
                        />
                        {/* Direction arrow */}
                        {isLongNo ? (
                          <polygon
                            points={`${cx - 1.5},${entryY - 1} ${cx + 1.5},${entryY - 1} ${cx},${entryY + 1.5}`}
                            fill="white"
                            opacity="0.85"
                          />
                        ) : (
                          <polygon
                            points={`${cx - 1.5},${entryY + 1} ${cx + 1.5},${entryY + 1} ${cx},${entryY - 1.5}`}
                            fill="white"
                            opacity="0.85"
                          />
                        )}
                      </g>
                      {/* Outcome hit marker */}
                      {isSuccess && targetY !== null && (
                        <circle cx={cx} cy={targetY} r="2.5" fill="oklch(72% 0.16 155)" stroke="oklch(72% 0.16 155)" strokeWidth="0.5" opacity="0.9" />
                      )}
                      {isFailure && stopY !== null && (
                        <circle cx={cx} cy={stopY} r="2.5" fill="oklch(65% 0.18 25)" stroke="oklch(65% 0.18 25)" strokeWidth="0.5" opacity="0.9" />
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Y-axis labels */}
              <div className="absolute inset-y-0 left-0 flex flex-col justify-between py-1 pointer-events-none">
                <span className="text-[9px] font-mono text-muted/50 pl-1">100¢</span>
                <span className="text-[9px] font-mono text-muted/40 pl-1">75¢</span>
                <span className="text-[9px] font-mono text-muted/40 pl-1">50¢</span>
                <span className="text-[9px] font-mono text-muted/40 pl-1">25¢</span>
                <span className="text-[9px] font-mono text-muted/50 pl-1">0¢</span>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 sm:gap-y-1.5 pt-2 sm:pt-3 border-t border-border/50 mt-1">
              <span className="flex items-center gap-1.5 text-[0.6rem] text-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-yes" />
                TP Hit
              </span>
              <span className="flex items-center gap-1.5 text-[0.6rem] text-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-no" />
                SL Hit
              </span>
              <span className="flex items-center gap-1.5 text-[0.6rem] text-muted">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'oklch(58% 0.18 295)' }} />
                Pending
              </span>
              <span className="flex items-center gap-1.5 text-[0.6rem] text-muted">
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="oklch(72% 0.16 155)" strokeWidth="1" strokeDasharray="2 1"/></svg>
                Target
              </span>
              <span className="flex items-center gap-1.5 text-[0.6rem] text-muted">
                <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="oklch(65% 0.18 25)" strokeWidth="1" strokeDasharray="2 1"/></svg>
                Stop Loss
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
          <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[0.65rem] text-muted">
            {isPerfLoading
              ? 'Loading performance data...'
              : 'No scored recommendations yet. Performance chart will appear once the recommendation scorer processes outcomes.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Time ago helper ────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function AgentSignalsPanel({ signals }: { signals: AgentSignalData[] }) {
  if (!signals || signals.length === 0) return null;

  return (
    <Card className="p-5 mt-4">
      <Expandable
        summary={
          <span className="flex items-center gap-1.5">
            Agent Signals
            <InfoHint label="What agent signals mean">
              Each agent predicts the outcome it thinks is most likely (YES or NO)
              and how confident it is in that call. The ¢ figure is that
              outcome&apos;s <strong className="text-fg">fair value</strong> —
              what the agent thinks it is really worth. If an agent&apos;s fair
              value is above the market price, it sees that side as underpriced.
              NEUTRAL agents have no strong view and are left out of the final
              score.
            </InfoHint>
          </span>
        }
        meta={`${signals.length} agents`}
        defaultOpen={false}
      >
        <div className="space-y-3 pt-2">
          {signals.map((signal) => (
            <AgentSignalRow key={signal.agentName} signal={signal} />
          ))}
        </div>
      </Expandable>
    </Card>
  );
}

function AgentSignalRow({ signal }: { signal: AgentSignalData }) {
  const isYes = signal.direction === 'YES' || signal.direction === 'LONG_YES';
  const isNo = signal.direction === 'NO' || signal.direction === 'LONG_NO';

  const directionLabel = isYes ? 'YES' : isNo ? 'NO' : 'NEUTRAL';
  const directionColor = isYes ? 'text-yes' : isNo ? 'text-no' : 'text-muted';
  const directionBg = isYes ? 'bg-yes/10 border-yes/20' : isNo ? 'bg-no/10 border-no/20' : 'bg-surface-2 border-border';
  const confidencePercent = Math.round(signal.confidence * 100);
  // Display fair value in the recommended token's space:
  // YES agents → show YES token fair value (fairProbability)
  // NO agents → show NO token fair value (1 - fairProbability)
  const displayFairCents = isNo
    ? Math.round((1 - signal.fairProbability) * 100)
    : Math.round(signal.fairProbability * 100);

  return (
    <Expandable
      summary={
        <div className="flex items-center gap-3 w-full">
          <span className={cn('text-xs font-bold w-14 shrink-0', directionColor)}>
            {directionLabel}
          </span>
          <span className="text-sm font-medium flex-1 truncate">
            {formatAgentDisplayName(signal.agentName)}
          </span>
          <span className="text-xs font-mono text-muted shrink-0">
            {confidencePercent}%
          </span>
          <span className={cn(
            'text-[0.65rem] font-mono px-1.5 py-0.5 rounded border shrink-0',
            directionBg
          )}>
            {displayFairCents}¢
          </span>
        </div>
      }
    >
      <div className="space-y-3 pt-2">
        {/* Confidence bar */}
        <div>
          <div className="flex justify-between text-[0.65rem] text-muted mb-1">
            <span>Confidence</span>
            <span className="font-mono">{confidencePercent}%</span>
          </div>
          <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                isYes ? 'bg-yes' : isNo ? 'bg-no' : 'bg-muted'
              )}
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>

        {/* Fair probability */}
        <div className="flex justify-between text-xs">
          <span className="text-muted">{isNo ? 'NO' : 'YES'} Fair Value</span>
          <span className="font-mono font-medium">{displayFairCents}¢</span>
        </div>

        {/* Key Drivers */}
        {signal.keyDrivers && signal.keyDrivers.length > 0 && (
          <div>
            <h4 className="text-[0.65rem] text-muted uppercase tracking-wider mb-1.5">
              Key Drivers
            </h4>
            <ul className="space-y-1">
              {signal.keyDrivers.map((driver, i) => (
                <li key={i} className="flex gap-2 text-xs text-fg/80">
                  <span className="text-accent shrink-0">•</span>
                  <span className="leading-relaxed">
                    {typeof driver === 'string' ? driver : (driver as any)?.description || JSON.stringify(driver)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk Factors */}
        {signal.riskFactors && signal.riskFactors.length > 0 && (
          <div>
            <h4 className="text-[0.65rem] text-muted uppercase tracking-wider mb-1.5">
              Risk Factors
            </h4>
            <ul className="space-y-1">
              {signal.riskFactors.map((risk, i) => (
                <li key={i} className="flex gap-2 text-xs text-fg/80">
                  <span className="text-warning shrink-0">⚠</span>
                  <span className="leading-relaxed">
                    {typeof risk === 'string' ? risk : (risk as any)?.description || JSON.stringify(risk)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Expandable>
  );
}

function formatAgentDisplayName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Risk Perspectives Panel ────────────────────────────────────────────────

function RiskPerspectivesPanel({ riskPerspectives }: { riskPerspectives?: string }) {
  if (!riskPerspectives || riskPerspectives === 'Risk perspectives unavailable.') return null;

  const sections = parseRiskSections(riskPerspectives);
  if (sections.length === 0) return null;

  return (
    <Card className="p-5 mt-4">
      <Expandable
        summary="Risk Perspectives"
        meta="3 strategies"
        defaultOpen={false}
      >
        <div className="space-y-4 pt-2">
          {sections.map((section) => (
            <RiskPerspectiveCard key={section.label} section={section} />
          ))}
        </div>
      </Expandable>
    </Card>
  );
}

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
  icon: string;
  data: RiskPerspective | null;
  raw: string;
}

function RiskPerspectiveCard({ section }: { section: RiskSection }) {
  const { label, variant, icon, data, raw } = section;

  const borderColor = variant === 'aggressive' ? 'border-no/20' : variant === 'conservative' ? 'border-yes/20' : 'border-ai/20';
  const bgColor = variant === 'aggressive' ? 'bg-no/[0.04]' : variant === 'conservative' ? 'bg-yes/[0.04]' : 'bg-ai/[0.04]';
  const labelColor = variant === 'aggressive' ? 'text-no' : variant === 'conservative' ? 'text-yes' : 'text-ai';

  if (!data) {
    return (
      <div className={cn('rounded-lg p-4 border', bgColor, borderColor)}>
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('text-xs font-bold uppercase tracking-wider', labelColor)}>
            {icon} {label}
          </span>
        </div>
        <p className="text-sm text-fg/80 leading-relaxed whitespace-pre-wrap">{raw}</p>
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
    <div className={cn('rounded-lg p-4 border', bgColor, borderColor)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('text-xs font-bold uppercase tracking-wider', labelColor)}>
          {icon} {label}
        </span>
        <span className={cn('ml-auto text-lg font-bold font-mono', labelColor)}>
          {positionPct % 1 === 0 ? positionPct : positionPct.toFixed(1)}%
        </span>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-2 mb-3">
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Position Size</span>
          <span className="text-xs font-mono font-medium">{positionPct % 1 === 0 ? positionPct : positionPct.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Kelly</span>
          <span className="text-xs font-mono font-medium">{data.kellyFraction.toFixed(2)}×</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Stop Loss</span>
          <span className="text-xs font-mono font-medium text-no">-{stopLossPct % 1 === 0 ? stopLossPct : stopLossPct.toFixed(1)}¢</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Take Profit</span>
          <span className="text-xs font-mono font-medium text-yes">+{takeProfitPct % 1 === 0 ? takeProfitPct : takeProfitPct.toFixed(1)}¢</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Entry</span>
          <span className="text-xs font-medium">{entryLabel}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[0.7rem] text-muted">Max Drawdown</span>
          <span className="text-xs font-mono font-medium">{maxDrawdownPct % 1 === 0 ? maxDrawdownPct : maxDrawdownPct.toFixed(1)}%</span>
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
  const configs: Record<string, { label: string; variant: 'aggressive' | 'conservative' | 'neutral'; icon: string }> = {
    aggressive: { label: 'Aggressive', variant: 'aggressive', icon: '🔥' },
    conservative: { label: 'Conservative', variant: 'conservative', icon: '🛡️' },
    neutral: { label: 'Neutral', variant: 'neutral', icon: '⚖️' },
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
    <div className="animate-pulse">
      {/* Breadcrumb skeleton */}
      <div className="h-4 w-32 rounded bg-surface-2 mb-3 sm:mb-4" />

      {/* Header skeleton */}
      <div className="flex items-start gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-surface-2" />
        <div className="flex-1 space-y-2 sm:space-y-3">
          <div className="h-5 sm:h-6 w-3/4 rounded bg-surface-2" />
          <div className="h-4 w-1/2 rounded bg-surface-2" />
          <div className="h-4 w-[160px] sm:w-[200px] rounded bg-surface-2" />
        </div>
      </div>

      {/* Two-column skeleton */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_440px] 2xl:grid-cols-[1fr_480px] gap-6">
        <div className="space-y-3 sm:space-y-4">
          <div className="h-[200px] sm:h-[240px] md:h-[280px] rounded-[12px] bg-surface-2" />
          <div className="h-[140px] sm:h-[160px] rounded-[12px] bg-surface-2" />
        </div>
        <div className="h-[400px] sm:h-[500px] rounded-[12px] bg-surface-2" />
      </div>
      <div className="flex flex-col gap-4 lg:hidden">
        <div className="h-[200px] rounded-[12px] bg-surface-2" />
        <div className="h-[300px] rounded-[12px] bg-surface-2" />
        <div className="h-[140px] rounded-[12px] bg-surface-2" />
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
              ← Back to Markets
            </Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Breadcrumb */}
      <Breadcrumb marketTitle={market.question} />

      {/* Market Header */}
      <MarketHeader market={marketWithPrices!} recommendation={analysis?.action} />

      {/* Upgrade Prompt for free users */}
      {plan === 'free' && (
        <div className="mb-4 sm:mb-6">
          <UpgradePrompt
            variant="free-to-starter"
            message={
              <>
                You&apos;re on the <strong>Free plan</strong> - upgrade to unlock
                recurring analysis, real-time alerts, and more credits.
              </>
            }
          />
        </div>
      )}

      {/* Layout: On mobile (< lg) everything stacks in a single column with AI panel after chart.
           On desktop (lg+) it's a two-column layout with left content + sticky right sidebar. */}

      {/* Mobile layout (< lg): Chart → AI Panel → rest */}
      <div className="flex flex-col gap-4 lg:hidden w-full min-w-0">
        <ChartPanel conditionId={conditionId} yesTokenId={yesTokenId} noTokenId={noTokenId} />

        <div className="space-y-3">
          <AIPanel
            marketSlug={marketId ?? ''}
            yesCents={getYesProbability(marketWithPrices!)}
            onQuickBuy={(side) => setTradeModal({ side })}
            onRequestAnalysis={() => setIsAnalysisModalOpen(true)}
            disabled={isClosed}
          />
          <PMActivationCard slug={market.slug} conditionId={market.conditionId} />
        </div>

        <OrderBookPanel market={market} />
        <MarketDescription market={market} />
        <AgentSignalsPanel signals={analysis?.agentSignals ?? []} />
        <RiskPerspectivesPanel riskPerspectives={analysis?.riskPerspectivesRaw} />
        <AnalysisHistoryPanel marketId={marketId} conditionId={conditionId} yesTokenId={yesTokenId} />
      </div>

      {/* Desktop layout (lg+): two-column grid, left content + sticky right sidebar */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_440px] 2xl:grid-cols-[1fr_480px] gap-6 items-start w-full min-w-0">
        {/* Left Column */}
        <div className="min-w-0 w-full">
          <ChartPanel conditionId={conditionId} yesTokenId={yesTokenId} noTokenId={noTokenId} />
          <OrderBookPanel market={market} />
          <MarketDescription market={market} />
          <AgentSignalsPanel signals={analysis?.agentSignals ?? []} />
          <RiskPerspectivesPanel riskPerspectives={analysis?.riskPerspectivesRaw} />
          <AnalysisHistoryPanel marketId={marketId} conditionId={conditionId} yesTokenId={yesTokenId} />
        </div>

        {/* Right Column - sticky sidebar */}
        <div className="sticky top-[72px] self-start space-y-4 min-w-0 w-full">
          <AIPanel
            marketSlug={marketId ?? ''}
            yesCents={getYesProbability(marketWithPrices!)}
            onQuickBuy={(side) => setTradeModal({ side })}
            onRequestAnalysis={() => setIsAnalysisModalOpen(true)}
            disabled={isClosed}
          />
          <PMActivationCard slug={market.slug} conditionId={market.conditionId} />
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
