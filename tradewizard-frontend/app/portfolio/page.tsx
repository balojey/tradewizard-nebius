'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Bot, Briefcase, ChevronRight, History } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { TierGate } from '@/components/ui/TierGate';
import { Badge } from '@/components/ui/Badge';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { usePortfolioStats } from '@/hooks/usePortfolioStats';
import useUserPositions, { type PolymarketPosition } from '@/hooks/useUserPositions';
import { useAnalysisHistoryPaginated } from '@/hooks/useAnalysisResults';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { useTrading } from '@/providers/TradingProvider';
import { WalletBalanceCard } from '@/components/portfolio/WalletBalanceCard';
import { WithdrawModal } from '@/components/portfolio/WithdrawModal';
import { DepositModal } from '@/components/portfolio/DepositModal';
import { BridgeWithdrawModal } from '@/components/portfolio/BridgeWithdrawModal';
import { cn } from '@/utils/classNames';

type PortfolioTab = 'positions' | 'history' | 'closed';

const TABS: { id: PortfolioTab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'history', label: 'History' },
  { id: 'closed', label: 'Closed' },
];

const TAB_META: Record<PortfolioTab, { title: string; description: string }> = {
  positions: {
    title: 'Open positions',
    description: 'Live exposure and mark-to-market P&L.',
  },
  history: {
    title: 'Analysis history',
    description: 'Every AI run you have requested.',
  },
  closed: {
    title: 'Closed positions',
    description: 'Resolved markets and realized outcomes.',
  },
};

function formatPnl(value: number): string {
  if (Math.abs(value) < 0.005) return '$0.00';
  return `${value > 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioPageContent />
    </Suspense>
  );
}

function PortfolioPageContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as PortfolioTab | null;
  const initialTab: PortfolioTab =
    tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : 'positions';

  const [activeTab, setActiveTab] = useState<PortfolioTab>(initialTab);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [bridgeWithdrawOpen, setBridgeWithdrawOpen] = useState(false);

  const { data: stats } = usePortfolioStats();
  const { safeAddress } = useTrading();
  const { data: positions, isLoading: positionsLoading } = useUserPositions(safeAddress);
  const {
    data: analysisPages,
    isLoading: analysisLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAnalysisHistoryPaginated();
  const { plan } = useCurrentPlan();

  const totalInvested = stats?.totalInvested ?? 0;
  const unrealizedPnl = stats?.totalUnrealizedPnl ?? 0;
  const realizedPnl = stats?.totalRealizedPnl ?? 0;
  const activeSessions = stats?.activeSessionCount ?? 0;

  // Split positions into active and resolved
  const activePositions = positions?.filter((p) => !p.redeemable) ?? [];
  const closedPositions = positions?.filter((p) => p.redeemable) ?? [];

  // Analysis results flattened from pages, filtering out any malformed entries
  const analysisResults =
    analysisPages?.pages.flatMap((page) => page.items).filter((r) => r && r.marketQuestion) ?? [];
  const analysisTotal = analysisPages?.pages[0]?.totalCount ?? analysisResults.length;

  const counts: Record<PortfolioTab, number> = {
    positions: activePositions.length,
    history: analysisTotal,
    closed: closedPositions.length,
  };

  return (
    <AppShell>
      <div className="w-full">
        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
                Portfolio
              </h1>
              <p className="mt-2 text-sm text-muted">
                Cash, open positions, and the analysis behind them.
              </p>
            </div>

            <Link
              href="/markets"
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-fg transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              Explore markets
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </header>

        {plan === 'free' && (
          <div className="mt-5">
            <UpgradePrompt
              variant="free-to-starter"
              message={
                <>
                  You&apos;re on the <strong>Free plan</strong> - upgrade to unlock
                  recurring analysis, more credits, and Portfolio Manager access.
                </>
              }
            />
          </div>
        )}

        <div className="mt-5">
          <WalletBalanceCard
            onWithdraw={() => setWithdrawOpen(true)}
            onDeposit={() => setDepositOpen(true)}
            onBridgeWithdraw={() => setBridgeWithdrawOpen(true)}
          />
        </div>
        <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
        <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
        <BridgeWithdrawModal
          open={bridgeWithdrawOpen}
          onClose={() => setBridgeWithdrawOpen(false)}
        />

        <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-4 sm:divide-y-0">
          <PortfolioStat
            label="Open positions"
            value={String(activePositions.length)}
            caption="across your markets"
          />
          <PortfolioStat
            label="Autopilot capital"
            value={`$${totalInvested.toFixed(2)}`}
            caption={`${activeSessions} active session${activeSessions === 1 ? '' : 's'}`}
          />
          <PortfolioStat
            label="Unrealized P&L"
            value={formatPnl(unrealizedPnl)}
            caption="open autopilot positions"
            tone={unrealizedPnl > 0 ? 'yes' : unrealizedPnl < 0 ? 'no' : 'fg'}
          />
          <PortfolioStat
            label="Realized P&L"
            value={formatPnl(realizedPnl)}
            caption="closed autopilot positions"
            tone={realizedPnl > 0 ? 'yes' : realizedPnl < 0 ? 'no' : 'fg'}
          />
        </div>

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-fg">{TAB_META[activeTab].title}</h2>
              <p className="text-[0.65rem] text-muted">
                {TAB_META[activeTab].description}
              </p>
            </div>

            <div className="flex w-fit gap-0.5 rounded-lg bg-surface-2 p-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-surface text-fg shadow-[var(--shadow-sm)]'
                      : 'text-muted hover:text-fg'
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 font-mono text-[0.55rem] tabular-nums',
                      activeTab === tab.id
                        ? 'bg-surface-2 text-fg'
                        : 'bg-surface/60 text-muted'
                    )}
                  >
                    {counts[tab.id]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border/60 p-4 sm:p-5">
            {activeTab === 'positions' && (
              <div className="space-y-4">
                <TierGate plan="pro" feature="Portfolio Manager">
                  <Link
                    href="/portfolio-manager"
                    className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-accent/30 bg-accent/[0.04] px-4 py-3 transition-colors hover:bg-accent/[0.07]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-fg">Autopilot</p>
                        <p className="truncate text-[0.65rem] text-muted">
                          {stats
                            ? `${stats.activeSessionCount} active session${stats.activeSessionCount === 1 ? '' : 's'} · $${stats.totalInvested.toFixed(2)} invested`
                            : 'No active sessions'}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
                      Open
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </Link>
                </TierGate>

                {positionsLoading ? (
                  <RowsSkeleton />
                ) : activePositions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Briefcase className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-fg">No open positions</p>
                    <p className="text-xs text-muted">
                      Browse markets to place your first trade.
                    </p>
                    <Link
                      href="/markets"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-fg"
                    >
                      Explore markets
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/60 text-left text-[0.62rem] text-muted">
                            <th className="px-3 py-2.5 font-medium first:pl-0">Market</th>
                            <th className="px-3 py-2.5 font-medium">Side</th>
                            <th className="px-3 py-2.5 text-right font-medium">Size</th>
                            <th className="px-3 py-2.5 text-right font-medium">Avg price</th>
                            <th className="px-3 py-2.5 text-right font-medium">Current</th>
                            <th className="px-3 py-2.5 text-right font-medium last:pr-0">P&L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activePositions.map((pos) => (
                            <PositionRow
                              key={`${pos.conditionId}-${pos.outcome}`}
                              position={pos}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-border/60 md:hidden">
                      {activePositions.map((pos) => (
                        <PositionCard
                          key={`${pos.conditionId}-${pos.outcome}`}
                          position={pos}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div>
                {analysisLoading ? (
                  <HistorySkeleton />
                ) : analysisResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <History className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-fg">No analyses yet</p>
                    <p className="text-xs text-muted">
                      Run an analysis on any market to start your history.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border/60">
                      {analysisResults.map((result) => {
                        const fairCents =
                          result.recommendation === 'LONG_NO'
                            ? Math.round((1 - result.consensusProbability) * 100)
                            : Math.round(result.consensusProbability * 100);

                        return (
                          <div
                            key={result.analysisId}
                            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                          >
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-medium text-fg sm:truncate">
                                {result.marketQuestion}
                              </p>
                              <p className="mt-0.5 font-mono text-[0.6rem] text-muted">
                                {new Date(result.executedAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-muted">
                                <span>
                                  Confidence{' '}
                                  <span className="font-mono text-fg">
                                    {(result.confidence * 100).toFixed(0)}%
                                  </span>
                                </span>
                                <span>
                                  Fair{' '}
                                  <span className="font-mono text-fg">{fairCents}¢</span>
                                </span>
                                {result.wasCachedDelivery && (
                                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.55rem]">
                                    cached
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge
                              tone={
                                result.recommendation === 'LONG_YES'
                                  ? 'yes'
                                  : result.recommendation === 'LONG_NO'
                                    ? 'no'
                                    : 'muted'
                              }
                              size="sm"
                            >
                              {result.recommendation === 'LONG_YES'
                                ? 'BUY YES'
                                : result.recommendation === 'LONG_NO'
                                  ? 'BUY NO'
                                  : 'NO TRADE'}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>

                    {hasNextPage && (
                      <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="mt-4 w-full rounded-lg border border-border py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isFetchingNextPage ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === 'closed' && (
              <div>
                {positionsLoading ? (
                  <RowsSkeleton />
                ) : closedPositions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <History className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-fg">No closed trades</p>
                    <p className="text-xs text-muted">
                      Resolved positions will appear here.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/60 text-left text-[0.62rem] text-muted">
                            <th className="px-3 py-2.5 font-medium first:pl-0">Market</th>
                            <th className="px-3 py-2.5 font-medium">Side</th>
                            <th className="px-3 py-2.5 text-right font-medium">Size</th>
                            <th className="px-3 py-2.5 text-right font-medium">Avg price</th>
                            <th className="px-3 py-2.5 text-right font-medium">Realized P&L</th>
                            <th className="px-3 py-2.5 text-right font-medium last:pr-0">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {closedPositions.map((pos) => (
                            <ClosedPositionRow
                              key={`${pos.conditionId}-${pos.outcome}`}
                              position={pos}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-border/60 md:hidden">
                      {closedPositions.map((pos) => (
                        <ClosedPositionCard
                          key={`${pos.conditionId}-${pos.outcome}`}
                          position={pos}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}

function PortfolioStat({
  label,
  value,
  caption,
  tone = 'fg',
}: {
  label: string;
  value: string;
  caption: string;
  tone?: 'fg' | 'yes' | 'no';
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[0.62rem] text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-bold tabular-nums',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'fg' && 'text-fg'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[0.55rem] text-muted">{caption}</p>
    </div>
  );
}

/** Desktop table row for active positions */
function PositionRow({ position }: { position: PolymarketPosition }) {
  const pnlValue = position.cashPnl;
  const pnlPct = position.percentPnl;
  const heldCents = Math.round(position.curPrice * 100);
  const isYes = position.outcome === 'Yes';

  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/40">
      <td className="px-3 py-3 first:pl-0">
        <span className="block max-w-[280px] truncate text-sm font-medium text-fg">
          {position.title}
        </span>
      </td>
      <td className="px-3 py-3">
        <Badge tone={isYes ? 'yes' : 'no'} size="sm">
          {position.outcome}
        </Badge>
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs text-fg">
        {position.size.toFixed(2)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs text-fg">
        {(position.avgPrice * 100).toFixed(0)}¢
      </td>
      <td className="px-3 py-3 text-right">
        <span className={cn('font-mono text-xs', isYes ? 'text-yes' : 'text-no')}>
          {heldCents}¢
        </span>
      </td>
      <td className="px-3 py-3 text-right last:pr-0">
        <div className={cn('font-mono text-xs font-semibold', pnlValue >= 0 ? 'text-yes' : 'text-no')}>
          {formatPnl(pnlValue)}
        </div>
        <div className={cn('font-mono text-[0.58rem]', pnlPct >= 0 ? 'text-yes/70' : 'text-no/70')}>
          {pnlPct >= 0 ? '+' : ''}
          {pnlPct.toFixed(1)}%
        </div>
      </td>
    </tr>
  );
}

/** Mobile row for active positions */
function PositionCard({ position }: { position: PolymarketPosition }) {
  const pnlValue = position.cashPnl;
  const pnlPct = position.percentPnl;
  const isYes = position.outcome === 'Yes';

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-fg">{position.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.62rem] text-muted">
            <Badge tone={isYes ? 'yes' : 'no'} size="sm">
              {position.outcome}
            </Badge>
            <span>
              Size <span className="font-mono text-fg">{position.size.toFixed(2)}</span>
            </span>
            <span>
              Avg{' '}
              <span className="font-mono text-fg">
                {(position.avgPrice * 100).toFixed(0)}¢
              </span>
            </span>
            <span>
              Now{' '}
              <span className={cn('font-mono', isYes ? 'text-yes' : 'text-no')}>
                {Math.round(position.curPrice * 100)}¢
              </span>
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('font-mono text-sm font-semibold', pnlValue >= 0 ? 'text-yes' : 'text-no')}>
            {formatPnl(pnlValue)}
          </p>
          <p className={cn('font-mono text-[0.6rem]', pnlPct >= 0 ? 'text-yes/70' : 'text-no/70')}>
            {pnlPct >= 0 ? '+' : ''}
            {pnlPct.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}

/** Desktop table row for closed positions */
function ClosedPositionRow({ position }: { position: PolymarketPosition }) {
  const isYes = position.outcome === 'Yes';

  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/40">
      <td className="px-3 py-3 first:pl-0">
        <span className="block max-w-[280px] truncate text-sm font-medium text-fg">
          {position.title}
        </span>
      </td>
      <td className="px-3 py-3">
        <Badge tone={isYes ? 'yes' : 'no'} size="sm">
          {position.outcome}
        </Badge>
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs text-fg">
        {position.size.toFixed(2)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs text-fg">
        {(position.avgPrice * 100).toFixed(0)}¢
      </td>
      <td className="px-3 py-3 text-right">
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            position.realizedPnl >= 0 ? 'text-yes' : 'text-no'
          )}
        >
          {formatPnl(position.realizedPnl)}
        </span>
      </td>
      <td className="px-3 py-3 text-right last:pr-0">
        <Badge tone={position.redeemable ? 'yes' : 'muted'} size="sm">
          {position.redeemable ? 'Redeemable' : 'Resolved'}
        </Badge>
      </td>
    </tr>
  );
}

function RowsSkeleton() {
  return (
    <div className="divide-y divide-border/60" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-12 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="divide-y divide-border/60" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2 py-3">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

/** Mobile row for closed positions */
function ClosedPositionCard({ position }: { position: PolymarketPosition }) {
  const isYes = position.outcome === 'Yes';

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-fg">{position.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.62rem] text-muted">
            <Badge tone={isYes ? 'yes' : 'no'} size="sm">
              {position.outcome}
            </Badge>
            <span>
              Size <span className="font-mono text-fg">{position.size.toFixed(2)}</span>
            </span>
            <span>
              Avg{' '}
              <span className="font-mono text-fg">
                {(position.avgPrice * 100).toFixed(0)}¢
              </span>
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              'font-mono text-sm font-semibold',
              position.realizedPnl >= 0 ? 'text-yes' : 'text-no'
            )}
          >
            {formatPnl(position.realizedPnl)}
          </p>
          <Badge tone={position.redeemable ? 'yes' : 'muted'} size="sm" className="mt-1">
            {position.redeemable ? 'Redeemable' : 'Resolved'}
          </Badge>
        </div>
      </div>
    </div>
  );
}
