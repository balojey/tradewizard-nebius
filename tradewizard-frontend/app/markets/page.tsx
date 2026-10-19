'use client';

import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { AnalysisModal } from '@/components/markets/AnalysisModal';
import { TradePanel, type TradeSide } from '@/components/markets/TradePanel';
import { Modal } from '@/components/ui/Modal';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { useDebounce } from '@/hooks/useDebounce';
import useMarkets, { type PolymarketMarket } from '@/hooks/useMarkets';
import useMarketSearch from '@/hooks/useMarketSearch';
import { useInView } from 'react-intersection-observer';
import usePoliticalCategories from '@/hooks/usePoliticalCategories';
import { useAnalysisHistoryPaginated, type AnalysisResultSummary } from '@/hooks/useAnalysisResults';
import { useAnalysisSubscriptions } from '@/hooks/useAnalysisSubscriptions';
import { useAnalysisProgress, type AnalysisProgress } from '@/hooks/useAnalysisProgress';
import { useSpotlight, type SpotlightItem } from '@/hooks/useSpotlight';
import { cn } from '@/utils/classNames';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', icon: '●', color: 'text-yes' },
  { value: 'closed', label: 'Resolved', icon: '◆', color: 'text-muted' },
] as const;

function StatusDropdown({
  value,
  onChange,
}: {
  value: 'active' | 'closed';
  onChange: (v: 'active' | 'closed') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = STATUS_OPTIONS.find((o) => o.value === value)!;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 pr-7 rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Market status filter"
      >
        <span className={current.color}>{current.icon}</span>
        {current.label}
        <svg
          className={cn('absolute right-2.5 top-1/2 -translate-y-1/2 transition-transform', open && 'rotate-180')}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 min-w-[140px] rounded-lg border border-border bg-surface shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                'hover:bg-surface-elevated',
                value === option.value ? 'text-fg font-semibold' : 'text-muted'
              )}
              role="option"
              aria-selected={value === option.value}
            >
              <span className={option.color}>{option.icon}</span>
              {option.label}
              {value === option.value && (
                <svg className="ml-auto text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RECENT_SEARCHES_KEY = 'tw_recent_searches';
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  const recent = getRecentSearches().filter((s) => s !== query);
  recent.unshift(query);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

function SearchInput({
  value,
  onChange,
  marketStatus,
}: {
  value: string;
  onChange: (v: string) => void;
  marketStatus: 'active' | 'closed';
}) {
  const [focused, setFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focused]);

  const debouncedValue = useDebounce(value, 300);
  const suggestionsQuery = useMarketSearch(debouncedValue, {
    enabled: focused && debouncedValue.length >= 2,
    status: marketStatus === 'closed' ? 'closed' : 'active',
    limit: 5,
  });

  const suggestions = suggestionsQuery.results.markets;
  const showDropdown = focused && (value.length === 0 ? recentSearches.length > 0 : true);

  const handleSelect = (query: string) => {
    onChange(query);
    saveRecentSearch(query);
    setRecentSearches(getRecentSearches());
    setFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim().length >= 2) {
      saveRecentSearch(value.trim());
      setRecentSearches(getRecentSearches());
      setFocused(false);
    }
    if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className="relative w-full sm:w-[320px] max-w-full order-last sm:order-none" ref={wrapperRef}>
      <div className={cn(
        'flex items-center gap-2 bg-surface border rounded-lg px-3 py-2 transition-colors',
        focused ? 'border-accent' : 'border-border'
      )}>
        <svg className="w-4 h-4 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search markets…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          className="bg-transparent border-none outline-none text-fg text-[0.8125rem] w-full placeholder:text-muted"
          aria-label="Search markets"
          aria-expanded={showDropdown}
          role="combobox"
          aria-autocomplete="list"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="text-muted hover:text-fg transition-colors shrink-0"
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1.5 rounded-lg border border-border bg-surface shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {value.length < 2 && recentSearches.length > 0 && (
            <div className="p-2">
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="text-[0.65rem] uppercase tracking-wider text-muted font-semibold">Recent</span>
                <button
                  onClick={() => { clearRecentSearches(); setRecentSearches([]); }}
                  className="text-[0.65rem] text-muted hover:text-fg transition-colors"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((term) => (
                <button
                  key={term}
                  onClick={() => handleSelect(term)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-fg hover:bg-surface-elevated rounded-md transition-colors text-left"
                >
                  <svg className="w-3 h-3 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  {term}
                </button>
              ))}
            </div>
          )}

          {value.length >= 2 && (
            <div className="p-2">
              {suggestionsQuery.isLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted">
                  <div className="w-3 h-3 border-2 border-muted border-t-accent rounded-full animate-spin" />
                  Searching…
                </div>
              )}
              {!suggestionsQuery.isLoading && suggestions.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted text-center">No markets found</p>
              )}
              {!suggestionsQuery.isLoading && suggestions.length > 0 && (
                <>
                  <span className="block px-2 pb-1.5 text-[0.65rem] uppercase tracking-wider text-muted font-semibold">Markets</span>
                  {suggestions.map((market) => (
                    <a
                      key={market.id}
                      href={`/markets/${market.slug}`}
                      onClick={(e) => {
                        e.preventDefault();
                        saveRecentSearch(value.trim());
                        setRecentSearches(getRecentSearches());
                        setFocused(false);
                        window.location.href = `/markets/${market.slug}`;
                      }}
                      className="flex items-center gap-2.5 px-2 py-2 hover:bg-surface-elevated rounded-md transition-colors"
                    >
                      {(market.image || market.icon) ? (
                        <img src={market.image || market.icon} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-surface-2 flex items-center justify-center shrink-0 text-sm">📊</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-fg line-clamp-1">{market.question}</p>
                        <p className="text-[0.65rem] text-muted">{market.eventTitle}</p>
                      </div>
                      {market.outcomePrices && !market.closed && (
                        <span className="text-xs font-mono font-bold text-yes shrink-0">
                          {(() => { try { return Math.round(parseFloat(JSON.parse(market.outcomePrices)[0]) * 100); } catch { return 0; } })()}¢
                        </span>
                      )}
                    </a>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getYesProbability(market: PolymarketMarket): number {
  // Try realtime prices first
  if (market.realtimePrices) {
    const tokenIds = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : [];
    if (tokenIds[0] && market.realtimePrices[tokenIds[0]]) {
      return Math.round(market.realtimePrices[tokenIds[0]].midPrice * 100);
    }
  }
  // Fallback to outcomePrices
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
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M vol`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K vol`;
  return `$${num.toFixed(0)} vol`;
}

function formatEndDate(date: string | undefined): string {
  if (!date) return '';
  try {
    return `Ends ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  } catch {
    return '';
  }
}

// ─── Skeleton Components ────────────────────────────────────────────────────

function MarketCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[12px] border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg bg-surface-2 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-surface-2" />
          <div className="h-3 w-1/2 rounded bg-surface-2" />
        </div>
      </div>
      <div className="h-[6px] w-full rounded-full bg-surface-2 mb-3" />
      <div className="flex gap-2">
        <div className="h-8 flex-1 rounded-md bg-surface-2" />
        <div className="h-8 flex-1 rounded-md bg-surface-2" />
      </div>
    </div>
  );
}

function CarouselSkeleton() {
  return (
    <div className="flex gap-3 sm:gap-4 overflow-hidden -mx-4 px-4 sm:mx-0 sm:px-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse flex-shrink-0 w-[260px] sm:w-[300px] rounded-[12px] border border-border bg-surface overflow-hidden"
        >
          <div className="h-[120px] sm:h-[140px] bg-surface-2" />
          <div className="p-4 space-y-3">
            <div className="h-3 w-16 rounded bg-surface-2" />
            <div className="h-4 w-3/4 rounded bg-surface-2" />
            <div className="h-[4px] w-full rounded-full bg-surface-2" />
            <div className="flex justify-between">
              <div className="h-5 w-10 rounded bg-surface-2" />
              <div className="h-3 w-20 rounded bg-surface-2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Trending Carousel ──────────────────────────────────────────────────────

function TrendingCarousel({
  markets,
  onRequestAnalysis,
  analysisMap,
  subscriptionMap,
  onBuy,
}: {
  markets: PolymarketMarket[];
  onRequestAnalysis: (marketId: string) => void;
  analysisMap: Map<string, AnalysisResultSummary>;
  subscriptionMap: Map<string, string>;
  onBuy: (slug: string, side: TradeSide) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { has } = useCurrentPlan();

  const scroll = (direction: 'left' | 'right') => {
    if (!trackRef.current) return;
    const scrollAmount = 316; // card width + gap
    trackRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (markets.length === 0) return null;

  // Take top 6 trending markets
  const trending = markets.slice(0, 6);

  return (
    <section className="mb-6" aria-label="Trending markets">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-semibold flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-yes animate-pulse" aria-hidden="true" />
          Trending Now
        </h2>
        <div className="flex gap-1.5">
          <button
            onClick={() => scroll('left')}
            className="w-7 h-7 rounded-full border border-border bg-surface text-fg grid place-items-center hover:border-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Scroll left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => scroll('right')}
            className="w-7 h-7 rounded-full border border-border bg-surface text-fg grid place-items-center hover:border-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Scroll right"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {trending.map((market) => (
          <TrendingCard
            key={market.id}
            market={market}
            analysisMap={analysisMap}
            subscriptionMap={subscriptionMap}
            onRequestAnalysis={onRequestAnalysis}
            onBuy={onBuy}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Trending Card ──────────────────────────────────────────────────────────

function TrendingCard({
  market,
  analysisMap,
  subscriptionMap,
  onRequestAnalysis,
  onBuy,
}: {
  market: PolymarketMarket;
  analysisMap: Map<string, AnalysisResultSummary>;
  subscriptionMap: Map<string, string>;
  onRequestAnalysis: (marketId: string) => void;
  onBuy: (slug: string, side: TradeSide) => void;
}) {
  const { has } = useCurrentPlan();
  const yesCents = getYesProbability(market);
  const noCents = 100 - yesCents;
  const imageUrl = market.image || market.icon;
  const marketKey = market.conditionId || market.id;
  const analysis = analysisMap.get(marketKey);
  const nextIn = subscriptionMap.get(marketKey);
  const hasAnalysis = !!analysis;
  const isYes = analysis?.recommendation === 'LONG_YES';
  const isNo = analysis?.recommendation === 'LONG_NO';
  // Display AI fair value and edge in the recommended token's space
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

  // Track real-time progress
  const progress = useAnalysisProgress({ marketId: marketKey });
  const isRunning = !!progress && progress.status === 'running';

  return (
    <div
      className={cn(
        'flex-shrink-0 w-[260px] sm:w-[300px] rounded-[12px] border bg-surface overflow-hidden transition-colors flex flex-col',
        isRunning ? 'border-ai/40' : hasAnalysis ? 'border-ai/30 hover:border-ai/50' : 'border-border hover:border-muted'
      )}
      style={{ scrollSnapAlign: 'start' }}
    >
      {/* Card image */}
      <div className="relative h-[120px] sm:h-[140px] w-full bg-gradient-to-br from-surface-2 to-surface overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover block" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-4xl opacity-50">📊</span>
          </div>
        )}
      </div>
      {/* Card body */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <span className="text-[0.625rem] uppercase tracking-wider text-muted font-medium">
          {market.eventTitle || 'Politics'}
        </span>
        <Link href={`/markets/${market.slug}`} className="hover:underline">
          <h3 className="text-[0.8125rem] font-semibold leading-[1.4] line-clamp-2">
            {market.question}
          </h3>
        </Link>
        <div className="h-[4px] rounded-full bg-surface-2 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-200',
              isNo ? 'bg-no' : 'bg-yes'
            )}
            style={{ width: `${isNo ? noCents : yesCents}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-1.5">
            {isNo ? (
              <>
                <span className="font-mono text-[1.125rem] font-bold text-no tabular-nums">
                  {noCents}¢
                </span>
                <span className="text-xs text-muted">/</span>
                <span className="font-mono text-[1.125rem] font-bold text-yes tabular-nums">
                  {yesCents}¢
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-[1.125rem] font-bold text-yes tabular-nums">
                  {yesCents}¢
                </span>
                <span className="text-xs text-muted">/</span>
                <span className="font-mono text-[1.125rem] font-bold text-no tabular-nums">
                  {noCents}¢
                </span>
              </>
            )}
          </div>
          <span className="text-[0.6875rem] text-muted">
            {formatVolume(market.volume)}
          </span>
        </div>

        {/* Inline progress */}
        {isRunning && (
          <InlineProgressBar progress={progress} />
        )}

        {!isRunning && hasAnalysis ? (
          <>
            {/* Inline AI recommendation */}
            <div className="flex flex-col gap-1.5 mt-1 p-2.5 rounded-[6px] bg-ai/[0.08] border border-ai/20 text-[0.625rem]">
              <div className="flex items-center gap-1.5 font-semibold text-ai">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
                <span>{isYes ? 'Buy Yes' : isNo ? 'Buy No' : 'No Trade'} {aiCents}%</span>
                <span className="font-normal text-muted">· +{edgeCents}¢ edge</span>
                <button
                  onClick={(e) => { e.preventDefault(); onRequestAnalysis(marketKey); }}
                  className="ml-auto text-muted hover:text-ai"
                  title="Refresh analysis"
                >
                  ↻
                </button>
              </div>
              <p className="text-muted leading-relaxed line-clamp-1">
                {Math.round(analysis.confidence * 100)}% confidence · {formatTimeAgo(analysis.executedAt)}
              </p>
            </div>
            {/* Trade buttons */}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => onBuy(market.slug, 'yes')}
                className={cn(
                  'flex-1 py-[0.4rem] rounded-[6px] text-[0.6875rem] font-semibold transition-colors',
                  isYes ? 'bg-yes text-white' : 'bg-yes/12 text-yes hover:bg-yes/20'
                )}
              >
                {isYes ? '★ ' : ''}Buy Yes {yesCents}¢
              </button>
              <button
                onClick={() => onBuy(market.slug, 'no')}
                className={cn(
                  'flex-1 py-[0.4rem] rounded-[6px] text-[0.6875rem] font-semibold transition-colors',
                  isNo ? 'bg-no text-white' : 'bg-no/12 text-no hover:bg-no/20'
                )}
              >
                {isNo ? '★ ' : ''}Buy No {noCents}¢
              </button>
            </div>
            {nextIn && (
              <div className="flex items-center gap-1.5 text-[0.6rem] text-ai pt-0.5">
                <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                Next in <span className="font-mono font-semibold">{nextIn}</span>
              </div>
            )}
            {/* Upsell */}
            {!has('starter') && (
              <p className="text-[0.675rem] text-muted whitespace-nowrap pt-1">
                <span className="opacity-60">🔒</span>{' '}
                Recurring analysis · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Upgrade to Starter+</Link>
              </p>
            )}
            {has('starter') && !has('pro') && !nextIn && (
              <p className="text-[0.675rem] text-muted whitespace-nowrap pt-1">
                <span className="opacity-60">⚡</span>{' '}
                Sub-daily intervals · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Go Pro</Link>
              </p>
            )}
          </>
        ) : !isRunning ? (
          <>
            {/* Get Analysis CTA */}
            <button
              onClick={() => onRequestAnalysis(marketKey)}
              className="flex items-center justify-center gap-1.5 w-full py-2 mt-1 rounded-[6px] text-[0.65rem] font-bold text-white transition-all hover:-translate-y-px"
              style={{
                background: 'linear-gradient(135deg, oklch(58% 0.22 295), oklch(55% 0.20 270))',
                boxShadow: '0 2px 12px oklch(58% 0.18 295 / .35)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              Get Analysis
              <span className="opacity-85 font-medium">· 1 credit</span>
            </button>
            {/* Buy YES / Buy NO */}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => onBuy(market.slug, 'yes')}
                className="flex-1 py-[0.4rem] rounded-[6px] text-[0.6875rem] font-semibold bg-yes/12 text-yes hover:bg-yes/20 transition-colors"
              >
                Buy Yes {yesCents}¢
              </button>
              <button
                onClick={() => onBuy(market.slug, 'no')}
                className="flex-1 py-[0.4rem] rounded-[6px] text-[0.6875rem] font-semibold bg-no/12 text-no hover:bg-no/20 transition-colors"
              >
                Buy No {noCents}¢
              </button>
            </div>
            {/* Gated row */}
            {!has('starter') && (
              <p className="text-[0.675rem] text-muted whitespace-nowrap pt-1">
                <span className="opacity-60">🔒</span>{' '}
                Recurring analysis · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Upgrade to Starter+</Link>
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Inline Progress Bar ────────────────────────────────────────────────────

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
  const percentage = Math.round((currentStage / progress.totalStages) * 100);

  return (
    <div className="rounded-lg border border-ai/30 bg-gradient-to-r from-ai/[0.06] to-transparent p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-ai">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ai opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ai" />
          </span>
          Analyzing…
        </span>
        <span className="text-[0.6rem] font-mono text-muted tabular-nums">
          {elapsed}s · {currentStage}/{progress.totalStages}
        </span>
      </div>
      {/* Mini pipeline bar */}
      <div className="flex gap-0.5 items-center">
        {PIPELINE_STAGES.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < currentStage
                ? 'bg-ai'
                : i === currentStage
                  ? 'bg-ai animate-pulse'
                  : 'bg-surface-2'
            )}
          />
        ))}
      </div>
      <p className="text-[0.6rem] text-muted">
        {progress.stageName}
      </p>
    </div>
  );
}

// ─── Market Card ────────────────────────────────────────────────────────────

interface MarketCardProps {
  market: PolymarketMarket;
  onRequestAnalysis: (marketId: string) => void;
  onBuy: (slug: string, side: TradeSide) => void;
  analysis?: AnalysisResultSummary | null;
  nextAnalysisIn?: string | null;
}

function MarketCard({ market, onRequestAnalysis, onBuy, analysis, nextAnalysisIn }: MarketCardProps) {
  const yesCents = getYesProbability(market);
  const noCents = 100 - yesCents;
  const { has } = useCurrentPlan();
  const isClosed = market.closed === true;

  // Track real-time analysis progress for this market
  const marketKey = market.conditionId || market.id;
  const progress = useAnalysisProgress({ marketId: marketKey });

  const hasAnalysis = !!analysis;
  const isRunning = !!progress && progress.status === 'running';
  const isYes = analysis?.recommendation === 'LONG_YES';
  const isNo = analysis?.recommendation === 'LONG_NO';
  // Display AI fair value and edge in the recommended token's space
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
  const recLabel = analysis?.recommendation === 'LONG_YES' ? 'Buy Yes' : analysis?.recommendation === 'LONG_NO' ? 'Buy No' : 'No Trade';

  return (
    <div
      className="rounded-[12px] border border-border bg-surface p-4 sm:p-5 hover:border-muted transition-colors flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        {market.image || market.icon ? (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-surface-2 flex items-center justify-center shrink-0 overflow-hidden">
            <img src={market.image || market.icon} alt="" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
            <span className="text-xl opacity-50">📊</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <Link href={`/markets/${market.slug}`} className="hover:underline">
            <h3 className="text-[0.9375rem] font-semibold leading-snug line-clamp-2">
              {market.question}
            </h3>
          </Link>
        </div>
        <span className={cn(
          'text-[0.6rem] uppercase tracking-wider px-2 py-0.5 rounded font-semibold whitespace-nowrap shrink-0',
          isRunning
            ? 'text-ai bg-ai/15'
            : hasAnalysis
              ? 'text-ai bg-ai/10'
              : 'text-ai bg-ai/10'
        )}>
          {isRunning ? 'Analyzing' : hasAnalysis ? 'Analyzed' : 'AI Ready'}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {market.eventTitle && <span className="truncate max-w-[200px]">{market.eventTitle}</span>}
        {market.volume && <span>{formatVolume(market.volume)}</span>}
        {(market.endDate || market.endDateIso) && (
          <span>{formatEndDate(market.endDateIso || market.endDate)}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ProbabilityBar
          cents={isNo ? noCents : yesCents}
          variant="thick"
          className="flex-1"
        />
        <div className="flex items-center gap-2 shrink-0">
          {isNo ? (
            <>
              <span className="font-mono text-sm font-bold text-no tabular-nums">
                {noCents}¢
              </span>
              <span className="text-xs text-muted">/</span>
              <span className="font-mono text-sm font-bold text-yes tabular-nums">
                {yesCents}¢
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-bold text-yes tabular-nums">
                {yesCents}¢
              </span>
              <span className="text-xs text-muted">/</span>
              <span className="font-mono text-sm font-bold text-no tabular-nums">
                {noCents}¢
              </span>
            </>
          )}
        </div>
      </div>

      {/* Inline analysis progress */}
      {isRunning && (
        <InlineProgressBar progress={progress} />
      )}

      {/* Analyzed state: show inline result + trade actions */}
      {!isRunning && hasAnalysis && (
        <>
          <div className="rounded-lg bg-ai/[0.06] border border-ai/20 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={cn(
                'text-[0.6875rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded',
                isYes && 'bg-yes/12 text-yes',
                isNo && 'bg-no/12 text-no',
                !isYes && !isNo && 'bg-surface-2 text-muted'
              )}>
                {recLabel}
              </span>
              <span className="font-mono text-[0.6875rem] text-ai tabular-nums">
                +{edgeCents}¢ edge · {aiCents}% AI
              </span>
            </div>
            <p className="text-[0.6875rem] text-muted leading-relaxed line-clamp-2">
              {Math.round(analysis.confidence * 100)}% confidence · Analyzed {formatTimeAgo(analysis.executedAt)}
            </p>
          </div>

          {/* Trade actions */}
          <div className="flex gap-2 items-stretch">
            <button
              onClick={() => onBuy(market.slug, 'yes')}
              disabled={isClosed}
              className={cn(
                'flex-1 py-2.5 rounded-md text-[0.8rem] font-semibold transition-colors',
                isClosed
                  ? 'bg-surface-2 text-muted cursor-not-allowed opacity-50'
                  : isYes
                    ? 'bg-yes text-white shadow-[0_2px_8px_oklch(72%_0.16_155_/_0.3)]'
                    : 'bg-yes/12 text-yes hover:bg-yes/20'
              )}
            >
              {isYes ? '★ ' : ''}Buy Yes {yesCents}¢
            </button>
            <button
              onClick={() => onBuy(market.slug, 'no')}
              disabled={isClosed}
              className={cn(
                'flex-1 py-2.5 rounded-md text-[0.8rem] font-semibold transition-colors',
                isClosed
                  ? 'bg-surface-2 text-muted cursor-not-allowed opacity-50'
                  : isNo
                    ? 'bg-no text-white shadow-[0_2px_8px_oklch(65%_0.18_25_/_0.3)]'
                    : 'bg-no/12 text-no hover:bg-no/20'
              )}
            >
              {isNo ? '★ ' : ''}Buy No {noCents}¢
            </button>
            <button
              onClick={() => onRequestAnalysis(market.conditionId || market.id)}
              disabled={isClosed}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[0.65rem] font-medium border transition-colors',
                isClosed
                  ? 'bg-surface-2 text-muted border-border cursor-not-allowed opacity-50'
                  : 'bg-surface-2 text-muted border-border hover:border-muted'
              )}
              title={isClosed ? 'Market resolved' : 'Refresh analysis'}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              1 cr
            </button>
          </div>

          {/* Recurring countdown */}
          {nextAnalysisIn && (
            <div className="flex items-center gap-2 text-[0.675rem] text-ai pt-0.5">
              <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              Next analysis in <span className="font-mono font-semibold tabular-nums">{nextAnalysisIn}</span>
            </div>
          )}

          {/* Upsell for lower-tier users */}
          {!has('starter') && (
            <p className="text-[0.675rem] text-muted whitespace-nowrap">
              <span className="opacity-60">🔒</span>{' '}
              Recurring analysis · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Upgrade to Starter+</Link>
            </p>
          )}
          {has('starter') && !has('pro') && !nextAnalysisIn && (
            <p className="text-[0.675rem] text-muted whitespace-nowrap">
              <span className="opacity-60">⚡</span>{' '}
              Sub-daily intervals · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Go Pro</Link>
            </p>
          )}
        </>
      )}

      {/* Unanalyzed state: show Get Analysis CTA + Buy buttons */}
      {!isRunning && !hasAnalysis && (
        <>
          {/* No analysis: show Get Analysis CTA + Buy buttons */}
          <button
            onClick={() => onRequestAnalysis(market.conditionId || market.id)}
            disabled={isClosed}
            className={cn(
              'flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs font-bold transition-all',
              isClosed
                ? 'bg-surface-2 text-muted cursor-not-allowed opacity-50'
                : 'text-white hover:-translate-y-px'
            )}
            style={isClosed ? undefined : {
              background: 'linear-gradient(135deg, oklch(58% 0.22 295), oklch(55% 0.20 270))',
              boxShadow: '0 2px 12px oklch(58% 0.18 295 / .35)',
            }}
            aria-label={isClosed ? 'Market resolved' : `Get AI analysis for ${market.question}`}
          >
            {!isClosed && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
            )}
            {isClosed ? 'Market Resolved' : 'Get Analysis'}
            {!isClosed && <span className="opacity-85 font-medium">· 1 credit</span>}
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => onBuy(market.slug, 'yes')}
              disabled={isClosed}
              className={cn(
                'flex-1 py-2 rounded-md text-xs font-semibold transition-colors',
                isClosed
                  ? 'bg-surface-2 text-muted cursor-not-allowed opacity-50'
                  : 'bg-yes/12 text-yes hover:bg-yes/20'
              )}
              aria-label={`Buy Yes at ${yesCents} cents`}
            >
              Yes {yesCents}¢
            </button>
            <button
              onClick={() => onBuy(market.slug, 'no')}
              disabled={isClosed}
              className={cn(
                'flex-1 py-2 rounded-md text-xs font-semibold transition-colors',
                isClosed
                  ? 'bg-surface-2 text-muted cursor-not-allowed opacity-50'
                  : 'bg-no/12 text-no hover:bg-no/20'
              )}
              aria-label={`Buy No at ${noCents} cents`}
            >
              No {noCents}¢
            </button>
          </div>

          {/* Gated row - only shown for free users */}
          {!has('starter') && (
            <p className="text-[0.675rem] text-muted whitespace-nowrap">
              <span className="opacity-60">🔒</span>{' '}
              Recurring analysis · <Link href="/account/subscription" className="text-accent font-medium hover:underline">Upgrade to Starter+</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
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

// ─── AI Spotlight Card ──────────────────────────────────────────────────────

function SpotlightCard() {
  const { data, isLoading } = useSpotlight(5);
  const items = data?.items ?? [];

  return (
    <Card variant="ai" className="p-5">
      <h3 className="text-[0.8125rem] font-semibold text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ai">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
        AI Spotlight
      </h3>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-1.5">
              <div className="h-3 w-3/4 rounded bg-surface-2" />
              <div className="h-2.5 w-1/2 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted leading-relaxed">
          Our 14-agent intelligence system identifies markets with the highest edge potential.{' '}
          <strong className="text-ai font-semibold">Get an analysis</strong> on any market to see
          the full recommendation.
        </p>
      )}

      {!isLoading && items.length > 0 && (
        <div className="space-y-0">
          {items.map((item) => (
            <SpotlightItemRow key={item.analysisId} item={item} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SpotlightItemRow({ item }: { item: SpotlightItem }) {
  const isYes = item.recommendation === 'LONG_YES';
  const isNo = item.recommendation === 'LONG_NO';
  const edgeCents = Math.round(Math.abs(item.edge) * 100);
  // Show AI fair value in the recommended token's space
  const aiCents = isNo
    ? Math.round((1 - item.consensusProbability) * 100)
    : Math.round(item.consensusProbability * 100);

  // Resolve conditionId → slug for proper routing
  const { data: marketMeta } = useQuery<{ slug: string | null }>({
    queryKey: ['market-meta-slug', item.marketId],
    queryFn: async () => {
      const response = await fetch(`/api/polymarket/market-by-condition?conditionId=${item.marketId}`);
      if (!response.ok) return { slug: null };
      const market = await response.json();
      return { slug: market?.market_slug || market?.slug || null };
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const href = `/markets/${marketMeta?.slug || item.marketId}`;

  return (
    <Link
      href={href}
      className="flex flex-col gap-1 py-2.5 border-b border-border last:border-b-0 hover:bg-surface-2/50 -mx-2 px-2 rounded transition-colors"
    >
      <span className="text-[0.75rem] font-medium leading-snug line-clamp-2 text-fg">
        {item.marketQuestion}
      </span>
      <span className="flex items-center gap-1.5 text-[0.65rem]">
        <span className={cn(
          'font-bold uppercase px-1.5 py-0.5 rounded',
          isYes ? 'bg-yes/12 text-yes' : 'bg-no/12 text-no'
        )}>
          {isYes ? 'Yes' : 'No'} {aiCents}%
        </span>
        <span className="text-ai font-semibold">+{edgeCents}¢ edge</span>
        <span className="text-muted ml-auto">{formatTimeAgo(item.executedAt)}</span>
      </span>
    </Link>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ markets }: { markets: PolymarketMarket[] }) {
  // Top movers for trending
  const trendingItems = markets.slice(0, 5);

  return (
    <aside className="space-y-4" aria-label="Market sidebar">
      {/* Trending Card */}
      <Card className="p-5">
        <h3 className="text-[0.8125rem] font-semibold text-muted uppercase tracking-wider mb-4">
          Trending
        </h3>
        <div className="space-y-0">
          {trendingItems.map((market) => {
            const yesCents = getYesProbability(market);
            return (
              <Link
                key={market.id}
                href={`/markets/${market.slug}`}
                className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0 hover:bg-surface-2/50 -mx-2 px-2 rounded transition-colors"
              >
                <span className="text-[0.8125rem] font-medium truncate mr-2 flex-1 min-w-0">
                  {market.question}
                </span>
                <span className={cn(
                  'font-mono text-xs font-semibold tabular-nums shrink-0',
                  yesCents >= 50 ? 'text-yes' : 'text-no'
                )}>
                  {yesCents}¢
                </span>
              </Link>
            );
          })}
        </div>
      </Card>

      {/* AI Spotlight Card */}
      <SpotlightCard />
    </aside>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tw_active_category') || 'trending';
    }
    return 'trending';
  });
  const [analysisMarketId, setAnalysisMarketId] = useState<string | null>(null);
  const [tradeModal, setTradeModal] = useState<{ slug: string; side: TradeSide } | null>(null);
  const [marketStatus, setMarketStatus] = useState<'active' | 'closed'>('active');
  const { plan } = useCurrentPlan();

  // Persist category selection and scroll to top
  const handleCategoryChange = (id: string) => {
    if (id === activeCategory) return;
    setActiveCategory(id);
    localStorage.setItem('tw_active_category', id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // Debounce search input by 250ms
  const debouncedQuery = useDebounce(searchQuery, 250);

  // Fetch categories
  const { data: categoriesData } = usePoliticalCategories();
  const baseCategories = categoriesData?.base ?? [];
  const relatedCategories = categoriesData?.related ?? [];
  const allCategories = [...baseCategories, ...relatedCategories];

  // Find the tag ID for the active category
  const activeCategoryObj = allCategories.find((c) => c.id === activeCategory);

  // Fetch markets
  const marketsQuery = useMarkets({
    categoryId: activeCategory,
    categories: allCategories,
    tagId: activeCategoryObj?.tagId,
    marketStatus,
  });

  // Search hook (only active when there's a debounced query)
  const searchResults = useMarketSearch(debouncedQuery, {
    enabled: debouncedQuery.length >= 2,
    debounceMs: 0, // We already debounce above
    status: marketStatus === 'closed' ? 'closed' : 'active',
  });

  // Determine which markets to display
  const isSearching = debouncedQuery.length >= 2;
  const allMarkets: PolymarketMarket[] = useMemo(() => {
    if (isSearching) {
      return searchResults.results.markets;
    }
    const pages = marketsQuery.data?.pages.flat() ?? [];
    // Deduplicate by market ID (same market can appear across multiple tag fetches)
    const seen = new Set<string>();
    return pages.filter((market) => {
      if (seen.has(market.id)) return false;
      seen.add(market.id);
      return true;
    });
  }, [isSearching, searchResults.results.markets, marketsQuery.data]);

  // Client-side category filtering (when not searching)
  const filteredMarkets = useMemo(() => {
    // When searching, show all search results without category filter
    if (isSearching) return allMarkets;
    // Category filtering is handled by the useMarkets hook via tagId
    return allMarkets;
  }, [isSearching, allMarkets]);

  // Markets for the grid - exclude the top 6 already shown in the trending carousel
  const showCarousel = !isSearching && filteredMarkets.length > 0 && marketStatus === 'active';
  const gridMarkets = useMemo(() => {
    if (!showCarousel) return filteredMarkets;
    return filteredMarkets.slice(6);
  }, [showCarousel, filteredMarkets]);

  // Fetch user's analysis history to determine which markets have been analyzed
  const { data: analysisPages } = useAnalysisHistoryPaginated();
  const analysisMap = useMemo(() => {
    const map = new Map<string, AnalysisResultSummary>();
    if (!analysisPages) return map;
    for (const page of analysisPages.pages) {
      for (const item of page.items ?? []) {
        // Only keep the most recent analysis per market
        if (!map.has(item.marketId)) {
          map.set(item.marketId, item);
        }
      }
    }
    return map;
  }, [analysisPages]);

  // Fetch active subscriptions for recurring countdown
  const { data: subscriptions } = useAnalysisSubscriptions();
  const subscriptionMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!subscriptions) return map;
    for (const sub of subscriptions) {
      if (sub.status === 'active' && sub.nextScheduledRun) {
        const diff = new Date(sub.nextScheduledRun).getTime() - Date.now();
        if (diff > 0) {
          const mins = Math.floor(diff / 60_000);
          if (mins < 60) map.set(sub.marketId, `${mins}m`);
          else {
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            map.set(sub.marketId, remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`);
          }
        }
      }
    }
    return map;
  }, [subscriptions]);

  const isLoading = isSearching ? searchResults.isLoading : marketsQuery.isLoading;
  const error = isSearching ? searchResults.error : marketsQuery.error;

  // Infinite scroll - load more pages when sentinel enters viewport
  const { ref: loadMoreRef, inView: loadMoreInView } = useInView({
    rootMargin: '400px',
    threshold: 0,
  });

  useEffect(() => {
    if (
      loadMoreInView &&
      !isSearching &&
      marketsQuery.hasNextPage &&
      !marketsQuery.isFetchingNextPage &&
      !marketsQuery.isLoading
    ) {
      marketsQuery.fetchNextPage();
    }
  }, [loadMoreInView, isSearching, marketsQuery]);

  return (
    <AppShell>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3 sm:gap-4">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">Markets</h1>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          marketStatus={marketStatus}
        />
      </div>

      {/* Category Filter Bar */}
      <div className="sticky top-14 z-10 bg-bg/95 backdrop-blur-sm -mx-4 px-4 sm:-mx-0 sm:px-0 py-2 mb-4">
        <div className="flex gap-2 items-center">
          {/* Status Dropdown - outside the scrollable area */}
          <StatusDropdown value={marketStatus} onChange={setMarketStatus} />

          <div className="w-px h-5 bg-border shrink-0" aria-hidden="true" />

          {/* Scrollable category chips */}
          <div className="flex gap-2 items-center overflow-x-auto pb-1 scrollbar-none min-w-0">

          {/* Base Categories */}
          {baseCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleCategoryChange(category.id)}
              className={cn(
                'whitespace-nowrap text-xs px-3.5 py-1.5 rounded-full border transition-colors shrink-0 font-medium',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                activeCategory === category.id
                  ? 'bg-accent border-accent text-bg font-semibold'
                  : 'bg-surface-elevated border-border text-fg hover:border-accent/50 hover:text-accent'
              )}
            >
              {category.label}
            </button>
          ))}

          {/* Related Tags */}
          {relatedCategories.length > 0 && (
            <>
              <div className="w-px h-5 bg-border shrink-0" aria-hidden="true" />
              {relatedCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleCategoryChange(category.id)}
                  className={cn(
                    'whitespace-nowrap text-xs px-3.5 py-1.5 rounded-full border transition-colors shrink-0',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    activeCategory === category.id
                      ? 'bg-accent border-accent text-bg font-semibold'
                      : 'border-border text-muted hover:border-muted hover:text-fg'
                  )}
                >
                  {category.label}
                </button>
              ))}
            </>
          )}
          </div>
        </div>
      </div>
      {plan === 'free' && (
        <div className="mb-6">
          <UpgradePrompt
            variant="free-to-starter"
            message={
              <>
                You&apos;re on the <strong>Free plan</strong> - unlock recurring analysis, more
                credits, and real-time alerts by upgrading.
              </>
            }
          />
        </div>
      )}

      {/* Trending Carousel - hidden for resolved markets */}
      {showCarousel && !isLoading && (
        <TrendingCarousel
          markets={filteredMarkets}
          onRequestAnalysis={setAnalysisMarketId}
          analysisMap={analysisMap}
          subscriptionMap={subscriptionMap}
          onBuy={(slug, side) => setTradeModal({ slug, side })}
        />
      )}
      {showCarousel && isLoading && <CarouselSkeleton />}

      {/* Main Layout: Grid + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_300px] gap-4 sm:gap-6 items-start">
        {/* Markets Grid */}
        <div className="min-w-0">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] md:grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <MarketCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <Card className="p-8 text-center">
              <p className="text-muted mb-4">
                {error instanceof Error ? error.message : 'Failed to load markets'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (isSearching) {
                    // Reset search
                    setSearchQuery('');
                  } else {
                    marketsQuery.refetch();
                  }
                }}
              >
                Retry
              </Button>
            </Card>
          ) : gridMarkets.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted">
                {isSearching
                  ? `No markets found for "${debouncedQuery}"`
                  : 'No markets available in this category'}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] md:grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
              {gridMarkets.map((market, index) => (
                <Fragment key={market.id}>
                  <MarketCard
                    market={market}
                    onRequestAnalysis={setAnalysisMarketId}
                    onBuy={(slug, side) => setTradeModal({ slug, side })}
                    analysis={analysisMap.get(market.conditionId || market.id) ?? null}
                    nextAnalysisIn={subscriptionMap.get(market.conditionId || market.id) ?? null}
                  />
                  {/* Mobile AI Spotlight - shown after 3rd card, hidden on desktop (sidebar has it) */}
                  {index === 2 && (
                    <div className="lg:hidden col-span-full">
                      <SpotlightCard />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {!isSearching && !isLoading && marketsQuery.hasNextPage && (
            <div ref={loadMoreRef} className="py-8 flex justify-center">
              {marketsQuery.isFetchingNextPage && (
                <div className="flex items-center gap-2 text-muted text-sm">
                  <div className="w-4 h-4 border-2 border-muted border-t-accent rounded-full animate-spin" />
                  Loading more markets…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - sticky on desktop, hidden on smaller screens */}
        <div className="hidden lg:block lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto lg:scrollbar-none">
          <Sidebar markets={filteredMarkets} />
        </div>
      </div>
      {/* Analysis Modal */}
      <AnalysisModal
        slug={analysisMarketId ?? ''}
        open={!!analysisMarketId}
        onClose={() => setAnalysisMarketId(null)}
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
            slug={tradeModal.slug}
            initialSide={tradeModal.side}
            embedded
          />
        )}
      </Modal>

      {/* Scroll to Top FAB */}
      <ScrollToTop />
    </AppShell>
  );
}
