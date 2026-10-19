'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { MetricStat } from '@/components/ui/MetricStat';
import { Tabs } from '@/components/ui/Tabs';
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

type PortfolioTab = 'positions' | 'history' | 'closed';

const TABS: { id: PortfolioTab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'history', label: 'History' },
  { id: 'closed', label: 'Closed' },
];

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

  const { data: stats, isLoading: statsLoading } = usePortfolioStats();
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

  // Derive summary metrics
  const totalValue = stats ? `$${stats.totalInvested.toFixed(2)}` : '$0.00';
  const unrealizedPnl = stats?.totalUnrealizedPnl ?? 0;
  const unrealizedPnlStr = `${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`;
  const winRate = 0;
  const winRateStr = `${winRate.toFixed(1)}%`;
  const aiAccuracy = 0;
  const aiAccuracyStr = `${(aiAccuracy * 100).toFixed(1)}%`;

  // Split positions into active and resolved
  const activePositions = positions?.filter((p) => !p.redeemable) ?? [];
  const closedPositions = positions?.filter((p) => p.redeemable) ?? [];

  // Analysis results flattened from pages, filtering out any malformed entries
  const analysisResults =
    analysisPages?.pages.flatMap((page) => page.items).filter((r) => r && r.marketQuestion) ?? [];

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-6 w-full">
        {/* Page Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold font-display">Portfolio</h1>
          <p className="text-xs sm:text-sm text-muted mt-1">
            Track your positions, analysis history, and performance.
          </p>
        </div>

        {/* Upgrade Prompt for free users */}
        {plan === 'free' && (
          <UpgradePrompt
            variant="free-to-starter"
            message={
              <>
                You&apos;re on the <strong>Free plan</strong> - upgrade to unlock
                recurring analysis, more credits, and Portfolio Manager access.
              </>
            }
          />
        )}

        {/* Wallet Balance */}
        <WalletBalanceCard
          onWithdraw={() => setWithdrawOpen(true)}
          onDeposit={() => setDepositOpen(true)}
          onBridgeWithdraw={() => setBridgeWithdrawOpen(true)}
        />
        <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
        <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
        <BridgeWithdrawModal
          open={bridgeWithdrawOpen}
          onClose={() => setBridgeWithdrawOpen(false)}
        />

        {/* Summary Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-3 sm:p-4">
            <MetricStat label="Total Value" value={totalValue} />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat
              label="Unrealized P&L"
              value={unrealizedPnlStr}
              tone={unrealizedPnl >= 0 ? 'profit' : 'loss'}
            />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat label="Win Rate" value={winRateStr} tone="default" />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat label="AI Accuracy" value={aiAccuracyStr} tone="ai" />
          </Card>
        </div>

        {/* Tabs */}
        <Tabs tabs={TABS} active={activeTab} onChange={(id) => setActiveTab(id as PortfolioTab)} />

        {/* Tab Content */}
        <div className="min-h-[200px] sm:min-h-[300px]">
          {activeTab === 'positions' && (
            <div className="flex flex-col gap-4 sm:gap-6">
              {/* PM Summary Card - Pro gated */}
              <TierGate plan="pro" feature="Portfolio Manager">
                <Card className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-fg">Portfolio Manager</h3>
                      <p className="text-xs text-muted mt-0.5 truncate">
                        {stats
                          ? `${stats.activeSessionCount} active session${stats.activeSessionCount !== 1 ? 's' : ''} · $${stats.totalInvested.toFixed(2)} invested`
                          : 'No active sessions'}
                      </p>
                    </div>
                    <Badge tone="accent">
                      {plan === 'pro' || plan === 'elite' ? 'Active' : 'Locked'}
                    </Badge>
                  </div>
                </Card>
              </TierGate>

              {/* Positions */}
              {positionsLoading ? (
                <div className="text-sm text-muted text-center py-8">
                  Loading positions...
                </div>
              ) : activePositions.length === 0 ? (
                <Card className="p-6 sm:p-8 text-center">
                  <p className="text-sm text-muted">No active positions</p>
                </Card>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted text-xs">
                          <th className="text-left py-2 px-3 font-medium">Market</th>
                          <th className="text-left py-2 px-3 font-medium">Outcome</th>
                          <th className="text-right py-2 px-3 font-medium">Size</th>
                          <th className="text-right py-2 px-3 font-medium">Avg Price</th>
                          <th className="text-right py-2 px-3 font-medium">Current</th>
                          <th className="text-right py-2 px-3 font-medium">P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activePositions.map((pos) => (
                          <PositionRow key={`${pos.conditionId}-${pos.outcome}`} position={pos} />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card List */}
                  <div className="flex flex-col gap-3 md:hidden">
                    {activePositions.map((pos) => (
                      <PositionCard key={`${pos.conditionId}-${pos.outcome}`} position={pos} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex flex-col gap-3 sm:gap-4">
              {analysisLoading ? (
                <div className="text-sm text-muted text-center py-8">
                  Loading analysis history...
                </div>
              ) : analysisResults.length === 0 ? (
                <Card className="p-6 sm:p-8 text-center">
                  <p className="text-sm text-muted">No analysis results yet</p>
                </Card>
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {analysisResults.map((result) => (
                      <Card key={result.analysisId} className="p-3 sm:p-4">
                        <div className="flex items-start sm:items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-fg line-clamp-2 sm:truncate">
                              {result.marketQuestion}
                            </p>
                            <p className="text-xs text-muted mt-0.5">
                              {new Date(result.executedAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <Badge
                            tone={
                              result.recommendation === 'LONG_YES'
                                ? 'yes'
                                : result.recommendation === 'LONG_NO'
                                  ? 'no'
                                  : 'muted'
                            }
                          >
                            {result.recommendation === 'LONG_YES'
                              ? 'BUY YES'
                              : result.recommendation === 'LONG_NO'
                                ? 'BUY NO'
                                : 'NO TRADE'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 text-xs text-muted">
                          <span>Confidence: {(result.confidence * 100).toFixed(0)}%</span>
                          <span>
                            {result.recommendation === 'LONG_NO' ? 'NO' : 'YES'} Fair:{' '}
                            {result.recommendation === 'LONG_NO'
                              ? Math.round((1 - result.consensusProbability) * 100)
                              : Math.round(result.consensusProbability * 100)}¢
                          </span>
                          {result.wasCachedDelivery && (
                            <Badge tone="muted" size="sm">
                              Cached
                            </Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                  {hasNextPage && (
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="mx-auto px-4 py-2 text-sm text-accent hover:text-fg transition-colors disabled:opacity-50"
                    >
                      {isFetchingNextPage ? 'Loading...' : 'Load More'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'closed' && (
            <div className="flex flex-col gap-3 sm:gap-4">
              {positionsLoading ? (
                <div className="text-sm text-muted text-center py-8">
                  Loading closed trades...
                </div>
              ) : closedPositions.length === 0 ? (
                <Card className="p-6 sm:p-8 text-center">
                  <p className="text-sm text-muted">No closed trades</p>
                </Card>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted text-xs">
                          <th className="text-left py-2 px-3 font-medium">Market</th>
                          <th className="text-left py-2 px-3 font-medium">Outcome</th>
                          <th className="text-right py-2 px-3 font-medium">Size</th>
                          <th className="text-right py-2 px-3 font-medium">Avg Price</th>
                          <th className="text-right py-2 px-3 font-medium">Realized P&L</th>
                          <th className="text-center py-2 px-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closedPositions.map((pos) => (
                          <tr
                            key={`${pos.conditionId}-${pos.outcome}`}
                            className="border-b border-border hover:bg-surface-2 transition-colors"
                          >
                            <td className="py-3 px-3">
                              <span className="text-fg truncate block max-w-[240px]">
                                {pos.title}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-muted">{pos.outcome}</td>
                            <td className="py-3 px-3 text-right font-mono text-fg">
                              {pos.size.toFixed(2)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-fg">
                              {pos.avgPrice.toFixed(4)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              <span className={pos.realizedPnl >= 0 ? 'text-yes' : 'text-no'}>
                                {pos.realizedPnl >= 0 ? '+' : ''}${pos.realizedPnl.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <Badge tone={pos.redeemable ? 'yes' : 'muted'} size="sm">
                                {pos.redeemable ? 'Redeemable' : 'Resolved'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card List */}
                  <div className="flex flex-col gap-3 md:hidden">
                    {closedPositions.map((pos) => (
                      <ClosedPositionCard key={`${pos.conditionId}-${pos.outcome}`} position={pos} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Performance Chart */}
        <Card className="p-4 sm:p-6">
          <h3 className="text-sm font-medium text-fg mb-3 sm:mb-4">Performance</h3>
          <div className="text-sm text-muted text-center py-8">
            No performance data available yet
          </div>
        </Card>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}

/** Desktop table row for active positions */
function PositionRow({ position }: { position: PolymarketPosition }) {
  const pnlValue = position.cashPnl;
  const pnlPct = position.percentPnl;
  const yesCents = position.outcome === 'Yes'
    ? Math.round(position.curPrice * 100)
    : 100 - Math.round(position.curPrice * 100);
  const noCents = 100 - yesCents;

  return (
    <tr className="border-b border-border hover:bg-surface-2 transition-colors">
      <td className="py-3 px-3">
        <span className="text-fg truncate block max-w-[240px]">{position.title}</span>
      </td>
      <td className="py-3 px-3 text-muted">{position.outcome}</td>
      <td className="py-3 px-3 text-right font-mono text-fg">
        {position.size.toFixed(2)}
      </td>
      <td className="py-3 px-3 text-right font-mono text-fg">
        {(position.avgPrice * 100).toFixed(0)}¢
      </td>
      <td className="py-3 px-3 text-right font-mono">
        <span className="text-yes">{yesCents}¢</span>
        {' / '}
        <span className="text-no">{noCents}¢</span>
      </td>
      <td className="py-3 px-3 text-right font-mono">
        <span className={pnlValue >= 0 ? 'text-yes' : 'text-no'}>
          {pnlValue >= 0 ? '+' : ''}${pnlValue.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}
          {pnlPct.toFixed(1)}%)
        </span>
      </td>
    </tr>
  );
}

/** Mobile card for active positions */
function PositionCard({ position }: { position: PolymarketPosition }) {
  const pnlValue = position.cashPnl;
  const pnlPct = position.percentPnl;
  const yesCents = position.outcome === 'Yes'
    ? Math.round(position.curPrice * 100)
    : 100 - Math.round(position.curPrice * 100);
  const noCents = 100 - yesCents;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg line-clamp-2">{position.title}</p>
          <p className="text-xs text-muted mt-0.5">{position.outcome}</p>
        </div>
        <span
          className={`text-sm font-mono font-semibold whitespace-nowrap ${pnlValue >= 0 ? 'text-yes' : 'text-no'}`}
        >
          {pnlValue >= 0 ? '+' : ''}${pnlValue.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-muted">
        <span>Size: <span className="font-mono text-fg">{position.size.toFixed(2)}</span></span>
        <span>Avg: <span className="font-mono text-fg">{(position.avgPrice * 100).toFixed(0)}¢</span></span>
        <span className="font-mono">
          <span className="text-yes">{yesCents}¢</span>
          {' / '}
          <span className="text-no">{noCents}¢</span>
        </span>
        <span
          className={`ml-auto font-mono ${pnlPct >= 0 ? 'text-yes' : 'text-no'}`}
        >
          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
        </span>
      </div>
    </Card>
  );
}

/** Mobile card for closed positions */
function ClosedPositionCard({ position }: { position: PolymarketPosition }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg line-clamp-2">{position.title}</p>
          <p className="text-xs text-muted mt-0.5">{position.outcome}</p>
        </div>
        <Badge tone={position.redeemable ? 'yes' : 'muted'} size="sm">
          {position.redeemable ? 'Redeemable' : 'Resolved'}
        </Badge>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-muted">
        <span>Size: <span className="font-mono text-fg">{position.size.toFixed(2)}</span></span>
        <span>Avg: <span className="font-mono text-fg">{position.avgPrice.toFixed(4)}</span></span>
        <span
          className={`ml-auto font-mono font-semibold ${position.realizedPnl >= 0 ? 'text-yes' : 'text-no'}`}
        >
          {position.realizedPnl >= 0 ? '+' : ''}${position.realizedPnl.toFixed(2)}
        </span>
      </div>
    </Card>
  );
}
