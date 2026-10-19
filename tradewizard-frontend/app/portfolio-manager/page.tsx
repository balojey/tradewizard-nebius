'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { MetricStat } from '@/components/ui/MetricStat';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { usePortfolioSessions, type PortfolioSessionSummary } from '@/hooks/usePortfolioSessions';
import { usePortfolioSession } from '@/hooks/usePortfolioSession';
import { usePortfolioTrades, type PortfolioTrade } from '@/hooks/usePortfolioTrades';
import { usePortfolioStats } from '@/hooks/usePortfolioStats';
import {
  usePauseSession,
  useResumeSession,
  useStopSession,
  useKillSwitch,
} from '@/hooks/usePortfolioActions';
import { usePortfolioWebSocket } from '@/hooks/usePortfolioWebSocket';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';
import { usePortfolioDecisions } from '@/hooks/usePortfolioDecisions';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { cn } from '@/utils/classNames';

type DetailTab = 'capital' | 'decisions' | 'trades';

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'capital', label: 'Capital' },
  { id: 'decisions', label: 'Decision Log' },
  { id: 'trades', label: 'Trade History' },
];

const STATUS_BADGE_TONE: Record<string, 'yes' | 'accent' | 'warning' | 'muted' | 'no'> = {
  active: 'yes',
  paused: 'warning',
  exiting: 'accent',
  completed: 'muted',
  terminated: 'no',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Watching',
  paused: 'Cooldown',
  exiting: 'Positioned',
  completed: 'Completed',
  terminated: 'Terminated',
};

export default function PortfolioManagerPage() {
  const { plan, has } = useCurrentPlan();
  const { data: stats, isLoading: statsLoading } = usePortfolioStats();
  const { data: sessionsData, isLoading: sessionsLoading } = usePortfolioSessions();
  const { data: personaData } = usePersonaSettings();
  usePortfolioWebSocket();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('capital');
  const [killSwitchOpen, setKillSwitchOpen] = useState(false);
  const [killSwitchTriggered, setKillSwitchTriggered] = useState(false);

  const killSwitch = useKillSwitch();

  const sessions = sessionsData?.sessions ?? [];

  // Derive display status from session state
  function getDisplayStatus(session: PortfolioSessionSummary): string {
    if (session.status === 'active' && session.amountInPositions > 0) return 'Positioned';
    if (session.status === 'active') return 'Watching';
    return STATUS_LABEL[session.status] ?? session.status;
  }

  function getStatusTone(session: PortfolioSessionSummary) {
    if (session.status === 'active' && session.amountInPositions > 0) return 'accent' as const;
    return STATUS_BADGE_TONE[session.status] ?? ('muted' as const);
  }

  // Stats display values
  const committedCapital = stats ? `$${stats.totalInvested.toFixed(2)}` : '$0.00';
  const unrealizedPnl = stats?.totalUnrealizedPnl ?? 0;
  const unrealizedPnlStr = `${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`;
  const realizedPnl = stats?.totalRealizedPnl ?? 0;
  const realizedPnlStr = `${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`;
  const activeSessions = stats?.activeSessionCount ?? 0;

  function handleKillSwitchConfirm() {
    killSwitch.mutate(
      { reason: 'User-initiated kill switch from dashboard' },
      {
        onSuccess: () => {
          setKillSwitchTriggered(true);
          setKillSwitchOpen(false);
        },
      }
    );
  }

  function handleSessionClick(sessionId: string) {
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
    } else {
      setSelectedSessionId(sessionId);
      setDetailTab('capital');
    }
  }

  // If user doesn't have pro plan, show blurred preview with upgrade prompt
  if (!has('pro')) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 sm:gap-6 px-1 sm:px-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold font-display">Portfolio Manager</h1>
            <p className="text-xs sm:text-sm text-muted mt-1">
              Autonomous AI trading sessions with real-time monitoring and controls.
            </p>
          </div>

          <UpgradePrompt
            variant="starter-to-pro"
            message="Upgrade to Pro to unlock the Portfolio Manager with autonomous AI trading sessions, real-time monitoring, and kill switch controls."
          />

          {/* Blurred preview of the dashboard */}
          <div className="relative overflow-hidden rounded-[12px]">
            <div className="pointer-events-none select-none blur-[6px] opacity-60" aria-hidden="true">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Card className="p-3 sm:p-4">
                  <MetricStat label="Committed Capital" value="$500.00" />
                </Card>
                <Card className="p-3 sm:p-4">
                  <MetricStat label="Unrealized P&L" value="+$42.50" tone="profit" />
                </Card>
                <Card className="p-3 sm:p-4">
                  <MetricStat label="Realized P&L" value="+$128.30" tone="profit" />
                </Card>
                <Card className="p-3 sm:p-4">
                  <MetricStat label="Active Sessions" value="2" sub="of 3 max" />
                </Card>
              </div>

              <div className="flex flex-col gap-3 mt-4 sm:mt-6">
                <h2 className="text-sm font-medium text-muted">Sessions</h2>
                <Card className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-fg truncate">Presidential Election 2028</p>
                      <Badge tone="yes" size="sm">Watching</Badge>
                    </div>
                    <p className="text-sm font-mono font-medium text-yes shrink-0">+$18.40</p>
                  </div>
                </Card>
                <Card className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-fg truncate">Fed Rate Decision June</p>
                      <Badge tone="accent" size="sm">Positioned</Badge>
                    </div>
                    <p className="text-sm font-mono font-medium text-yes shrink-0">+$24.10</p>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:gap-6 px-1 sm:px-0">
        {/* Kill Switch Active Banner */}
        {killSwitchTriggered && (
          <div className="flex items-center gap-2 sm:gap-3 rounded-[12px] border border-no/30 bg-no/10 px-3 sm:px-4 py-2.5 sm:py-3">
            <span className="text-no text-xs sm:text-sm font-medium">
              ⚠️ Kill Switch Activated - All sessions terminated and positions exited.
            </span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold font-display truncate">Portfolio Manager</h1>
            {personaData && (
              <Badge tone="ai">{personaData.persona.name}</Badge>
            )}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setKillSwitchOpen(true)}
            disabled={activeSessions === 0 || killSwitchTriggered}
            aria-label="Kill Switch - terminate all sessions and exit all positions"
            className="self-start sm:self-auto"
          >
            Kill Switch
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-3 sm:p-4">
            <MetricStat
              label="Committed Capital"
              value={committedCapital}
            />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat
              label="Unrealized P&L"
              value={unrealizedPnlStr}
              tone={unrealizedPnl >= 0 ? 'profit' : 'loss'}
            />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat
              label="Realized P&L"
              value={realizedPnlStr}
              tone={realizedPnl >= 0 ? 'profit' : 'loss'}
            />
          </Card>
          <Card className="p-3 sm:p-4">
            <MetricStat
              label="Active Sessions"
              value={String(activeSessions)}
              sub={`of ${plan === 'elite' ? '10' : '3'} max`}
            />
          </Card>
        </div>

        {/* Sessions List */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">Sessions</h2>

          {sessionsLoading || statsLoading ? (
            <div className="text-sm text-muted text-center py-8">
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <Card className="p-6 sm:p-8 text-center">
              <p className="text-xs sm:text-sm text-muted">
                No active sessions. Activate the Portfolio Manager from a market detail page.
              </p>
            </Card>
          ) : (
            sessions.map((session) => (
              <div key={session.id}>
                <SessionCard
                  session={session}
                  isSelected={selectedSessionId === session.id}
                  onClick={() => handleSessionClick(session.id)}
                  getDisplayStatus={getDisplayStatus}
                  getStatusTone={getStatusTone}
                />
                {selectedSessionId === session.id && (
                  <SessionDetailPanel
                    sessionId={session.id}
                    detailTab={detailTab}
                    onTabChange={setDetailTab}
                  />
                )}
              </div>
            ))
          )}
        </div>

        {/* Kill Switch Confirmation Modal */}
        <Modal
          open={killSwitchOpen}
          onClose={() => setKillSwitchOpen(false)}
          title="Confirm Kill Switch"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              This will immediately terminate all active sessions and exit all open positions
              at market price. This action cannot be undone.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setKillSwitchOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleKillSwitchConfirm}
                loading={killSwitch.isPending}
              >
                Confirm Kill Switch
              </Button>
            </div>
          </div>
        </Modal>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}

/** Individual session card */
function SessionCard({
  session,
  isSelected,
  onClick,
  getDisplayStatus,
  getStatusTone,
}: {
  session: PortfolioSessionSummary;
  isSelected: boolean;
  onClick: () => void;
  getDisplayStatus: (s: PortfolioSessionSummary) => string;
  getStatusTone: (s: PortfolioSessionSummary) => 'yes' | 'accent' | 'warning' | 'muted' | 'no';
}) {
  const pauseSession = usePauseSession();
  const resumeSession = useResumeSession();
  const stopSession = useStopSession();

  // Fetch live token prices for this session's market
  const { data: livePrices } = useQuery<{ yes: number; no: number } | null>({
    queryKey: ['pm-live-price', session.marketId],
    queryFn: async () => {
      // First get the market's token IDs
      const metaRes = await fetch(`/api/polymarket/market-by-condition?conditionId=${session.marketId}`);
      if (!metaRes.ok) return null;
      const market = await metaRes.json();
      const clobTokenIds = market?.clobTokenIds;
      if (!clobTokenIds) return null;
      const tokenIds = JSON.parse(clobTokenIds);
      if (!tokenIds[0]) return null;
      // Fetch live prices
      const priceRes = await fetch('/api/polymarket/public-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds }),
      });
      if (!priceRes.ok) return null;
      const priceMap = await priceRes.json();
      const yesPrice = priceMap[tokenIds[0]]?.midPrice;
      if (yesPrice == null) return null;
      return { yes: Math.round(yesPrice * 100), no: Math.round((1 - yesPrice) * 100) };
    },
    enabled: !!session.marketId && session.status !== 'completed' && session.status !== 'terminated',
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const utilization =
    session.investmentAmount > 0
      ? ((session.amountInPositions / session.investmentAmount) * 100).toFixed(0)
      : '0';

  const totalPnl = session.unrealizedPnl + session.realizedPnl;

  return (
    <Card
      className={cn(
        'p-3 sm:p-4 cursor-pointer transition-colors hover:bg-surface-2',
        isSelected && 'ring-1 ring-accent'
      )}
    >
      <div onClick={onClick}>
        {/* Mobile: stack vertically; Desktop: row layout */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-fg truncate max-w-[calc(100%-5rem)] sm:max-w-none" title={session.marketId}>
                {session.marketId.length > 40
                  ? session.marketId.slice(0, 37) + '…'
                  : session.marketId}
              </p>
              <Badge tone={getStatusTone(session)} size="sm">
                {getDisplayStatus(session)}
              </Badge>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 mt-1 text-[11px] sm:text-xs text-muted flex-wrap">
              <span>{session.personaName}</span>
              <span className="hidden sm:inline">·</span>
              <span>${session.investmentAmount.toFixed(2)} invested</span>
              <span className="hidden sm:inline">·</span>
              <span>{utilization}% utilized</span>
              {livePrices && (
                <>
                  <span className="hidden sm:inline">·</span>
                  <span className="font-mono">
                    <span className="text-yes">{livePrices.yes}¢</span>
                    {' / '}
                    <span className="text-no">{livePrices.no}¢</span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <div className="sm:text-right">
              <p
                className={cn(
                  'text-sm font-mono font-medium',
                  totalPnl >= 0 ? 'text-yes' : 'text-no'
                )}
              >
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted">P&L</p>
            </div>
          </div>
        </div>

        {/* Capital Utilization Progress Bar */}
        <div className="flex items-center gap-3 mt-2.5">
          <div className="flex-1 h-1 rounded-full overflow-hidden bg-surface-2 flex">
            {session.amountInPositions > 0 && (
              <div
                className="h-full bg-yes rounded-full"
                style={{ width: `${Math.min(Number(utilization), 100)}%` }}
              />
            )}
          </div>
          <span className="text-[10px] sm:text-[11px] text-muted font-mono whitespace-nowrap">
            ${session.amountInPositions.toFixed(0)} / ${session.investmentAmount.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Session Controls */}
      {(session.status === 'active' || session.status === 'paused') && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
          {session.status === 'active' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                pauseSession.mutate(session.id);
              }}
              loading={pauseSession.isPending}
              aria-label="Pause session"
            >
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                resumeSession.mutate(session.id);
              }}
              loading={resumeSession.isPending}
              aria-label="Resume session"
            >
              Resume
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              stopSession.mutate(session.id);
            }}
            loading={stopSession.isPending}
            aria-label="Stop session"
          >
            Stop
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Session detail panel with Capital / Decision Log / Trade History tabs */
function SessionDetailPanel({
  sessionId,
  detailTab,
  onTabChange,
}: {
  sessionId: string;
  detailTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const { data: session, isLoading: sessionLoading } = usePortfolioSession(sessionId);
  const { data: tradesData, isLoading: tradesLoading } = usePortfolioTrades(sessionId);

  if (sessionLoading) {
    return (
      <Card className="p-3 sm:p-4 mt-2 sm:ml-4 border-l-2 border-accent">
        <p className="text-sm text-muted">Loading session details...</p>
      </Card>
    );
  }

  if (!session) return null;

  return (
    <Card className="p-3 sm:p-4 mt-2 sm:ml-4 border-l-2 border-accent">
      <Tabs tabs={DETAIL_TABS} active={detailTab} onChange={onTabChange} />

      <div className="mt-3 sm:mt-4">
        {detailTab === 'capital' && <CapitalTab session={session} />}
        {detailTab === 'decisions' && <DecisionLogTab sessionId={sessionId} />}
        {detailTab === 'trades' && (
          <TradeHistoryTab trades={tradesData?.items ?? []} isLoading={tradesLoading} />
        )}
      </div>
    </Card>
  );
}

/** Capital tab content */
function CapitalTab({ session }: { session: ReturnType<typeof usePortfolioSession>['data'] }) {
  if (!session) return null;

  const total = session.investmentAmount;
  const inPositions = session.capitalBreakdown.amountInPositions;
  const pending = session.capitalBreakdown.amountInPendingOrders;
  const available = session.capitalBreakdown.amountAvailable;
  const realized = session.stats.realizedPnl;

  // Capital utilization segments
  const positionPct = total > 0 ? (inPositions / total) * 100 : 0;
  const pendingPct = total > 0 ? (pending / total) * 100 : 0;
  const availablePct = total > 0 ? (available / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <div>
          <p className="text-[11px] sm:text-xs text-muted">In Positions</p>
          <p className="text-xs sm:text-sm font-mono font-medium text-fg">
            ${inPositions.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[11px] sm:text-xs text-muted">Pending Orders</p>
          <p className="text-xs sm:text-sm font-mono font-medium text-fg">
            ${pending.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[11px] sm:text-xs text-muted">Available</p>
          <p className="text-xs sm:text-sm font-mono font-medium text-fg">
            ${available.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[11px] sm:text-xs text-muted">Realized P&L</p>
          <p
            className={cn(
              'text-xs sm:text-sm font-mono font-medium',
              realized >= 0 ? 'text-yes' : 'text-no'
            )}
          >
            {realized >= 0 ? '+' : ''}${realized.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Capital Utilization Bar */}
      <div>
        <p className="text-[11px] sm:text-xs text-muted mb-1">Capital Utilization</p>
        <div className="flex h-2 rounded-full overflow-hidden bg-surface-2">
          <div
            className="bg-accent"
            style={{ width: `${positionPct}%` }}
            title={`Positions: ${positionPct.toFixed(1)}%`}
          />
          <div
            className="bg-warning"
            style={{ width: `${pendingPct}%` }}
            title={`Pending: ${pendingPct.toFixed(1)}%`}
          />
          <div
            className="bg-muted/30"
            style={{ width: `${availablePct}%` }}
            title={`Available: ${availablePct.toFixed(1)}%`}
          />
        </div>
        <div className="flex items-center gap-3 sm:gap-4 mt-1 text-[10px] text-muted flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent" /> Positions
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning" /> Pending
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-muted/30" /> Available
          </span>
        </div>
      </div>
    </div>
  );
}

/** Decision Log tab content */
function DecisionLogTab({ sessionId }: { sessionId: string }) {
  const { data: decisionsData, isLoading } = usePortfolioDecisions(sessionId);
  const decisions = decisionsData?.items ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted">Loading decisions...</p>;
  }

  if (decisions.length === 0) {
    return <p className="text-sm text-muted">No decisions recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {decisions.map((decision) => (
        <div
          key={decision.id}
          className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 py-2 border-b border-border last:border-0"
        >
          <Badge
            tone={
              decision.action === 'enter'
                ? 'yes'
                : decision.action === 'exit'
                  ? 'no'
                  : decision.action === 'skip'
                    ? 'warning'
                    : 'muted'
            }
            size="sm"
          >
            {decision.action.charAt(0).toUpperCase() + decision.action.slice(1)}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm text-fg">{decision.reasoning}</p>
            {decision.skipReason && (
              <p className="text-[11px] sm:text-xs text-muted mt-0.5">
                Skip reason: {decision.skipReason.replace(/_/g, ' ')}
              </p>
            )}
            <div className="flex items-center gap-2 sm:gap-3 mt-1 text-[10px] sm:text-[11px] text-muted flex-wrap">
              <span>
                {new Date(decision.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {decision.entryEvaluation.convictionScore > 0 && (
                <span>Conviction: {decision.entryEvaluation.convictionScore.toFixed(1)}</span>
              )}
              {decision.positionStateAtDecision.hasPosition && (
                <span>
                  Position: {decision.positionStateAtDecision.direction}
                  {decision.positionStateAtDecision.unrealizedPnl != null && (
                    <> ({decision.positionStateAtDecision.unrealizedPnl >= 0 ? '+' : ''}${decision.positionStateAtDecision.unrealizedPnl.toFixed(2)})</>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Trade History tab content */
function TradeHistoryTab({
  trades,
  isLoading,
}: {
  trades: PortfolioTrade[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted">Loading trades...</p>;
  }

  if (trades.length === 0) {
    return <p className="text-sm text-muted">No trades executed yet.</p>;
  }

  return (
    <>
      {/* Desktop table view */}
      <div className="hidden sm:block overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-border text-muted text-xs">
              <th className="text-left py-2 px-2 font-medium">Type</th>
              <th className="text-left py-2 px-2 font-medium">Side</th>
              <th className="text-right py-2 px-2 font-medium">Size</th>
              <th className="text-right py-2 px-2 font-medium">Price</th>
              <th className="text-right py-2 px-2 font-medium">P&L</th>
              <th className="text-left py-2 px-2 font-medium">Status</th>
              <th className="text-left py-2 px-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                className="border-b border-border hover:bg-surface-2 transition-colors"
              >
                <td className="py-2 px-2">
                  <Badge
                    tone={
                      trade.tradePurpose === 'entry'
                        ? 'accent'
                        : trade.tradePurpose === 'stop_loss'
                          ? 'no'
                          : trade.tradePurpose === 'take_profit'
                            ? 'yes'
                            : 'muted'
                    }
                    size="sm"
                  >
                    {trade.tradePurpose.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="py-2 px-2">
                  <span
                    className={
                      trade.side === 'BUY' ? 'text-yes' : 'text-no'
                    }
                  >
                    {trade.side} {trade.direction}
                  </span>
                </td>
                <td className="py-2 px-2 text-right font-mono text-fg">
                  {trade.size.toFixed(2)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-fg">
                  {(trade.fillPrice ?? trade.price).toFixed(4)}
                </td>
                <td className="py-2 px-2 text-right font-mono">
                  {trade.realizedPnl != null ? (
                    <span className={trade.realizedPnl >= 0 ? 'text-yes' : 'text-no'}>
                      {trade.realizedPnl >= 0 ? '+' : ''}${trade.realizedPnl.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="py-2 px-2">
                  <Badge
                    tone={
                      trade.status === 'filled'
                        ? 'yes'
                        : trade.status === 'failed'
                          ? 'no'
                          : 'muted'
                    }
                    size="sm"
                  >
                    {trade.status}
                  </Badge>
                </td>
                <td className="py-2 px-2 text-xs text-muted">
                  {new Date(trade.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="flex flex-col gap-2 sm:hidden">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="flex flex-col gap-1.5 py-2.5 border-b border-border last:border-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    trade.tradePurpose === 'entry'
                      ? 'accent'
                      : trade.tradePurpose === 'stop_loss'
                        ? 'no'
                        : trade.tradePurpose === 'take_profit'
                          ? 'yes'
                          : 'muted'
                  }
                  size="sm"
                >
                  {trade.tradePurpose.replace('_', ' ')}
                </Badge>
                <span
                  className={cn(
                    'text-xs font-medium',
                    trade.side === 'BUY' ? 'text-yes' : 'text-no'
                  )}
                >
                  {trade.side} {trade.direction}
                </span>
              </div>
              <Badge
                tone={
                  trade.status === 'filled'
                    ? 'yes'
                    : trade.status === 'failed'
                      ? 'no'
                      : 'muted'
                }
                size="sm"
              >
                {trade.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <div className="flex items-center gap-3">
                <span className="font-mono text-fg">Size: {trade.size.toFixed(2)}</span>
                <span className="font-mono text-fg">@ {(trade.fillPrice ?? trade.price).toFixed(4)}</span>
              </div>
              {trade.realizedPnl != null ? (
                <span className={cn('font-mono font-medium', trade.realizedPnl >= 0 ? 'text-yes' : 'text-no')}>
                  {trade.realizedPnl >= 0 ? '+' : ''}${trade.realizedPnl.toFixed(2)}
                </span>
              ) : (
                <span className="text-muted">-</span>
              )}
            </div>
            <p className="text-[10px] text-muted">
              {new Date(trade.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
