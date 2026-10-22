'use client';

import { useState, useMemo, useRef, useEffect, useId, Fragment } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { AnalysisModal } from '@/components/markets/AnalysisModal';
import { MarketCard } from '@/components/markets/MarketCard';
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
import { useSpotlight, type SpotlightItem } from '@/hooks/useSpotlight';
import { cn } from '@/utils/classNames';
import { formatTimeAgo, getYesProbability } from '@/utils/marketDisplay';
import { BarChart3 } from 'lucide-react';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
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

  const openMenu = () => {
    const currentIndex = STATUS_OPTIONS.findIndex((o) => o.value === value);
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
    setOpen(true);
  };

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const select = (option: (typeof STATUS_OPTIONS)[number]) => {
    onChange(option.value);
    closeMenu(true);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };

  const handleOptionKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % STATUS_OPTIONS.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + STATUS_OPTIONS.length) % STATUS_OPTIONS.length);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(STATUS_OPTIONS.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        select(STATUS_OPTIONS[index]);
        break;
      case 'Escape':
        e.preventDefault();
        closeMenu(true);
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  };

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 pr-7 rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="status-filter-listbox"
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
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id="status-filter-listbox"
          role="listbox"
          aria-label="Market status"
          className="absolute top-full left-0 mt-1.5 min-w-[140px] rounded-lg border border-border bg-surface shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {STATUS_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              onClick={() => select(option)}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                'hover:bg-surface-elevated focus-visible:outline-none focus-visible:bg-surface-elevated',
                value === option.value ? 'text-fg font-semibold' : 'text-muted'
              )}
              role="option"
              aria-selected={value === option.value}
            >
              <span className={option.color}>{option.icon}</span>
              {option.label}
              {value === option.value && (
                <svg className="ml-auto text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

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
  const usingRecent = value.length < 2;
  const showDropdown = focused && (value.length === 0 ? recentSearches.length > 0 : true);
  const optionCount = usingRecent ? recentSearches.length : suggestions.length;

  const closeDropdown = () => {
    setFocused(false);
    setHighlightIndex(-1);
  };

  const handleSelect = (query: string) => {
    onChange(query);
    saveRecentSearch(query);
    setRecentSearches(getRecentSearches());
    closeDropdown();
  };

  const selectSuggestion = (market: PolymarketMarket) => {
    saveRecentSearch(value.trim());
    setRecentSearches(getRecentSearches());
    closeDropdown();
    window.location.href = `/markets/${market.slug}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!focused) setFocused(true);
      if (optionCount > 0) {
        setHighlightIndex((i) => (i + 1) % optionCount);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!focused) setFocused(true);
      if (optionCount > 0) {
        setHighlightIndex((i) => (i - 1 + optionCount) % optionCount);
      }
      return;
    }
    if (e.key === 'Enter') {
      if (highlightIndex >= 0 && highlightIndex < optionCount) {
        e.preventDefault();
        if (usingRecent) handleSelect(recentSearches[highlightIndex]);
        else selectSuggestion(suggestions[highlightIndex]);
        return;
      }
      if (value.trim().length >= 2) {
        saveRecentSearch(value.trim());
        setRecentSearches(getRecentSearches());
        closeDropdown();
      }
      return;
    }
    if (e.key === 'Escape') {
      closeDropdown();
    }
  };

  const activeDescendant =
    showDropdown && highlightIndex >= 0
      ? `${listboxId}-option-${highlightIndex}`
      : undefined;

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
          onChange={(e) => {
            onChange(e.target.value);
            setHighlightIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          className="bg-transparent border-none outline-none text-fg text-[0.8125rem] w-full placeholder:text-muted"
          aria-label="Search markets"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
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
        <div
          id={listboxId}
          role="listbox"
          aria-label="Market search results"
          className="absolute top-full left-0 right-0 mt-1.5 rounded-lg border border-border bg-surface shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {usingRecent && recentSearches.length > 0 && (
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
              {recentSearches.map((term, index) => (
                <button
                  key={term}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={highlightIndex === index}
                  onClick={() => handleSelect(term)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-xs text-fg rounded-md transition-colors text-left',
                    highlightIndex === index ? 'bg-surface-elevated' : 'hover:bg-surface-elevated'
                  )}
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

          {!usingRecent && (
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
                  {suggestions.map((market, index) => (
                    <a
                      key={market.id}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={highlightIndex === index}
                      href={`/markets/${market.slug}`}
                      onClick={(e) => {
                        e.preventDefault();
                        selectSuggestion(market);
                      }}
                      onMouseEnter={() => setHighlightIndex(index)}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors',
                        highlightIndex === index ? 'bg-surface-elevated' : 'hover:bg-surface-elevated'
                      )}
                    >
                      {(market.image || market.icon) ? (
                        <img src={market.image || market.icon} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2">
                          <BarChart3 className="h-3.5 w-3.5 text-muted/60" aria-hidden="true" />
                        </div>
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
        {trending.map((market) => {
          const marketKey = market.conditionId || market.id;
          return (
            <MarketCard
              key={market.id}
              variant="carousel"
              market={market}
              analysis={analysisMap.get(marketKey) ?? null}
              nextAnalysisIn={subscriptionMap.get(marketKey) ?? null}
              onRequestAnalysis={onRequestAnalysis}
              onBuy={onBuy}
            />
          );
        })}
      </div>
    </section>
  );
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
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 bg-bg/95 backdrop-blur-sm -mx-4 px-4 sm:-mx-0 sm:px-0 py-2 mb-4">
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
        <div className="hidden lg:block lg:sticky lg:top-[calc(3.5rem+env(safe-area-inset-top)+1rem)] lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:scrollbar-none">
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
