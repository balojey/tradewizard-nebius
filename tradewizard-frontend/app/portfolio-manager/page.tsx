'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  History,
  ListChecks,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ScrollToTop } from '@/components/ui/ScrollToTop';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
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
  { id: 'decisions', label: 'Decisions' },
  { id: 'trades', label: 'Trades' },
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
  exiting: 'Exiting',
  completed: 'Completed',
  terminated: 'Terminated',
};

function formatPnl(value: number): string {
  if (Math.abs(value) < 0.005) return '$0.00';
  return `${value > 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

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

  function getDisplayStatus(session: PortfolioSessionSummary): string {
    if (session.status === 'active' && session.amountInPositions > 0) return 'Positioned';
    if (session.status === 'active') return 'Watching';
    return STATUS_LABEL[session.status] ?? session.status;
  }

  function getStatusTone(session: PortfolioSessionSummary) {
    if (session.status === 'active' && session.amountInPositions > 0) return 'accent' as const;
    return STATUS_BADGE_TONE[session.status] ?? ('muted' as const);
  }

  const committedCapital = stats?.totalInvested ?? 0;
  const unrealizedPnl = stats?.totalUnrealizedPnl ?? 0;
  const realizedPnl = stats?.totalRealizedPnl ?? 0;
  const activeSessions = stats?.activeSessionCount ?? 0;
  const maxSessions = plan === 'elite' ? 10 : 3;

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

  // If user doesn't have pro plan, show a blurred preview with upgrade prompt
  if (!has('pro')) {
    return (
      <AppShell>
        <div className="w-full">
          <header className="border-b border-border pb-6">
            <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
              Portfolio Manager
            </h1>
            <p className="mt-2 text-sm text-muted">
              Autonomous AI sessions with live risk controls and a full decision log.
            </p>
          </header>

          <div className="mt-5">
            <UpgradePrompt
              variant="starter-to-pro"
              message="Upgrade to Pro to unlock autonomous AI trading sessions, real-time monitoring, and kill-switch controls."
            />
          </div>

          <div className="relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="pointer-events-none select-none opacity-60 blur-[6px]" aria-hidden="true">
              <div className="grid grid-cols-2 divide-x divide-y divide-border/60 border-b border-border/60 sm:grid-cols-4 sm:divide-y-0">
                {[
                  ['Committed', '$500.00'],
                  ['Unrealized P&L', '+$42.50'],
                  ['Realized P&L', '+$128.30'],
                  ['Active sessions', '2 of 3'],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-3.5">
                    <p className="text-[0.62rem] text-muted">{label}</p>
                    <p className="mt-1 font-mono text-lg font-bold text-fg">{value}</p>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border/60">
                {[
                  ['Presidential Election 2028', 'Watching', '+$18.40'],
                  ['Fed Rate Decision June', 'Positioned', '+$24.10'],
                ].map(([title, status, pnl]) => (
                  <div key={title} className="flex items-center justify-between gap-3 px-4 py-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Bot className="h-4 w-4 text-accent" aria-hidden="true" />
                      <span className="truncate text-sm font-medium text-fg">{title}</span>
                      <Badge tone={status === 'Positioned' ? 'accent' : 'yes'} size="sm">
                        {status}
                      </Badge>
                    </div>
                    <span className="font-mono text-sm text-yes">{pnl}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-bg/30 via-transparent to-transparent" />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="w-full">
        {killSwitchTriggered && (
          <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-no/30 bg-no/[0.08] px-3.5 py-2.5 text-xs font-medium text-no">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Kill switch activated - all sessions terminated and positions exited.
          </div>
        )}

        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
                  Portfolio Manager
                </h1>
                {personaData && (
                  <Badge tone="accent" size="sm">
                    {personaData.persona.name}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">
                Autonomous sessions with live risk controls and every decision logged.
              </p>
            </div>

            <Button
              variant="danger"
              size="sm"
              onClick={() => setKillSwitchOpen(true)}
              disabled={activeSessions === 0 || killSwitchTriggered}
              aria-label="Kill switch - terminate all sessions and exit all positions"
              className="self-start sm:self-auto"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Kill switch
            </Button>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-4 sm:divide-y-0">
          <PmStat
            label="Committed"
            value={`$${committedCapital.toFixed(2)}`}
            caption="across sessions"
          />
          <PmStat
            label="Unrealized P&L"
            value={formatPnl(unrealizedPnl)}
            caption="open positions"
            tone={unrealizedPnl > 0 ? 'yes' : unrealizedPnl < 0 ? 'no' : 'fg'}
          />
          <PmStat
            label="Realized P&L"
            value={formatPnl(realizedPnl)}
            caption="closed outcomes"
            tone={realizedPnl > 0 ? 'yes' : realizedPnl < 0 ? 'no' : 'fg'}
          />
          <PmStat
            label="Active sessions"
            value={String(activeSessions)}
            caption={`of ${maxSessions} max`}
          />
        </div>

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-fg">Sessions</h2>
              <p className="text-[0.65rem] text-muted">
                {sessions.length} total · {activeSessions} active
              </p>
            </div>
            <span className="hidden text-[0.6rem] text-muted sm:inline">
              Select a session for capital and decisions
            </span>
          </div>

          {sessionsLoading || statsLoading ? (
            <SessionsSkeleton />
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No sessions yet"
              description="Activate Autopilot from a market detail page to start an autonomous session."
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
            <div>
              {sessions.map((session) => (
                <div key={session.id} className="border-b border-border/60 last:border-0">
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
              ))}
            </div>
          )}
        </section>

        <Modal
          open={killSwitchOpen}
          onClose={() => setKillSwitchOpen(false)}
          title="Confirm kill switch"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-muted">
              This immediately terminates all active sessions and exits every open
              position at market price. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <Button variant="ghost" size="sm" onClick={() => setKillSwitchOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleKillSwitchConfirm}
                loading={killSwitch.isPending}
              >
                Confirm kill switch
              </Button>
            </div>
          </div>
        </Modal>
      </div>
      <ScrollToTop />
    </AppShell>
  );
}

function PmStat({
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

  const { data: liveMarket } = useQuery<{
    question: string;
    yes: number | null;
    no: number | null;
  } | null>({
    queryKey: ['pm-market', session.marketId],
    queryFn: async () => {
      const metaRes = await fetch(
        `/api/polymarket/market-by-condition?conditionId=${session.marketId}`
      );
      if (!metaRes.ok) return null;
      const market = await metaRes.json();
      const question = market?.question ?? '';
      const clobTokenIds = market?.clobTokenIds;
      if (!clobTokenIds) return { question, yes: null, no: null };

      const tokenIds = JSON.parse(clobTokenIds);
      if (!tokenIds[0]) return { question, yes: null, no: null };

      const priceRes = await fetch('/api/polymarket/public-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds }),
      });
      if (!priceRes.ok) return { question, yes: null, no: null };

      const priceMap = await priceRes.json();
      const yesPrice = priceMap[tokenIds[0]]?.midPrice;
      if (yesPrice == null) return { question, yes: null, no: null };

      return {
        question,
        yes: Math.round(yesPrice * 100),
        no: Math.round((1 - yesPrice) * 100),
      };
    },
    enabled: !!session.marketId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const utilization =
    session.investmentAmount > 0
      ? Math.min((session.amountInPositions / session.investmentAmount) * 100, 100)
      : 0;

  const totalPnl = session.unrealizedPnl + session.realizedPnl;
  const marketTitle = liveMarket?.question || session.marketId;

  return (
    <div className={cn('transition-colors', isSelected && 'bg-surface-2/20')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
        aria-expanded={isSelected}
        className="cursor-pointer px-4 py-4 outline-none transition-colors hover:bg-surface-2/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="max-w-full truncate text-sm font-semibold text-fg"
                  title={marketTitle}
                >
                  {marketTitle}
                </p>
                <Badge tone={getStatusTone(session)} size="sm">
                  {getDisplayStatus(session)}
                </Badge>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.62rem] text-muted">
                <span>{session.personaName}</span>
                <span aria-hidden="true">·</span>
                <span>${session.investmentAmount.toFixed(2)} invested</span>
                <span aria-hidden="true">·</span>
                <span>{utilization.toFixed(0)}% utilized</span>
                {liveMarket?.yes != null && liveMarket.no != null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      <span className="text-yes">{liveMarket.yes}¢</span>
                      {' / '}
                      <span className="text-no">{liveMarket.no}¢</span>
                    </span>
                  </>
                )}
              </div>

              <div className="mt-2 flex items-center gap-3">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-yes transition-[width]"
                    style={{ width: `${utilization}%` }}
                  />
                </div>
                <span className="whitespace-nowrap font-mono text-[0.6rem] text-muted">
                  ${session.amountInPositions.toFixed(0)} / $
                  {session.investmentAmount.toFixed(0)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
            <div className="sm:text-right">
              <p
                className={cn(
                  'font-mono text-sm font-semibold',
                  totalPnl > 0 ? 'text-yes' : totalPnl < 0 ? 'text-no' : 'text-fg'
                )}
              >
                {formatPnl(totalPnl)}
              </p>
              <p className="text-[0.55rem] text-muted">unrealized + realized</p>
            </div>
            <ChevronRight
              className={cn(
                'h-4 w-4 text-muted transition-transform',
                isSelected && 'rotate-90'
              )}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      {(session.status === 'active' || session.status === 'paused') && (
        <div className="flex items-center gap-2 border-t border-border/40 px-4 pb-3.5 pt-2.5 sm:px-5">
          {session.status === 'active' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
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
              onClick={(event) => {
                event.stopPropagation();
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
            onClick={(event) => {
              event.stopPropagation();
              stopSession.mutate(session.id);
            }}
            loading={stopSession.isPending}
            aria-label="Stop session"
          >
            Stop
          </Button>
        </div>
      )}
    </div>
  );
}

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
      <div className="border-t border-border/60 bg-bg/20 px-4 py-4 sm:px-5">
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="border-t border-border/60 bg-bg/20 px-4 py-4 sm:px-5">
      <div className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-0.5">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors',
              detailTab === tab.id
                ? 'bg-surface text-fg shadow-[var(--shadow-sm)]'
                : 'text-muted hover:text-fg'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {detailTab === 'capital' && <CapitalTab session={session} />}
        {detailTab === 'decisions' && <DecisionLogTab sessionId={sessionId} />}
        {detailTab === 'trades' && (
          <TradeHistoryTab trades={tradesData?.items ?? []} isLoading={tradesLoading} />
        )}
      </div>
    </div>
  );
}

function CapitalTab({ session }: { session: ReturnType<typeof usePortfolioSession>['data'] }) {
  if (!session) return null;

  const total = session.investmentAmount;
  const inPositions = session.capitalBreakdown.amountInPositions;
  const pending = session.capitalBreakdown.amountInPendingOrders;
  const available = session.capitalBreakdown.amountAvailable;
  const realized = session.stats.realizedPnl;

  const positionPct = total > 0 ? (inPositions / total) * 100 : 0;
  const pendingPct = total > 0 ? (pending / total) * 100 : 0;
  const availablePct = total > 0 ? (available / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 sm:grid-cols-4 sm:divide-y-0">
        <div className="px-3 py-2.5">
          <p className="text-[0.6rem] text-muted">In positions</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-fg">
            ${inPositions.toFixed(2)}
          </p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[0.6rem] text-muted">Pending orders</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-fg">
            ${pending.toFixed(2)}
          </p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[0.6rem] text-muted">Available</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-fg">
            ${available.toFixed(2)}
          </p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[0.6rem] text-muted">Realized P&L</p>
          <p
            className={cn(
              'mt-0.5 font-mono text-xs font-semibold',
              realized > 0 ? 'text-yes' : realized < 0 ? 'text-no' : 'text-fg'
            )}
          >
            {formatPnl(realized)}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[0.6rem] text-muted">
          <span>Capital utilization</span>
          <span className="font-mono">{positionPct.toFixed(0)}% deployed</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
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
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6rem] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Positions
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/30" />
            Available
          </span>
        </div>
      </div>
    </div>
  );
}

function DecisionLogTab({ sessionId }: { sessionId: string }) {
  const { data: decisionsData, isLoading } = usePortfolioDecisions(sessionId);
  const decisions = decisionsData?.items ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No decisions recorded yet"
        description="Decisions appear once this session starts evaluating markets."
        className="py-6"
      />
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {decisions.map((decision) => (
        <div
          key={decision.id}
          className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
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

          <div className="min-w-0 flex-1">
            <p className="text-xs leading-relaxed text-fg">{decision.reasoning}</p>
            {decision.skipReason && (
              <p className="mt-0.5 text-[0.65rem] text-muted">
                Skip reason: {decision.skipReason.replace(/_/g, ' ')}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6rem] text-muted">
              <span>
                {new Date(decision.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {decision.entryEvaluation.convictionScore > 0 && (
                <span>
                  Conviction {decision.entryEvaluation.convictionScore.toFixed(1)}
                </span>
              )}
              {decision.positionStateAtDecision.hasPosition && (
                <span>
                  Position {decision.positionStateAtDecision.direction}
                  {decision.positionStateAtDecision.unrealizedPnl != null && (
                    <>
                      {' '}
                      ({formatPnl(decision.positionStateAtDecision.unrealizedPnl)})
                    </>
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

function TradeHistoryTab({
  trades,
  isLoading,
}: {
  trades: PortfolioTrade[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No trades executed yet"
        description="Trades placed by this session will show up here."
        className="py-6"
      />
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[0.62rem] text-muted">
              <th className="px-2 py-2 font-medium first:pl-0">Type</th>
              <th className="px-2 py-2 font-medium">Side</th>
              <th className="px-2 py-2 text-right font-medium">Size</th>
              <th className="px-2 py-2 text-right font-medium">Price</th>
              <th className="px-2 py-2 text-right font-medium">P&L</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium last:pr-0">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/40"
              >
                <td className="px-2 py-2.5 first:pl-0">
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
                <td className="px-2 py-2.5">
                  <span className={trade.side === 'BUY' ? 'text-yes' : 'text-no'}>
                    {trade.side} {trade.direction}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs text-fg">
                  {trade.size.toFixed(2)}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs text-fg">
                  {(trade.fillPrice ?? trade.price).toFixed(4)}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs">
                  {trade.realizedPnl != null ? (
                    <span
                      className={trade.realizedPnl >= 0 ? 'text-yes' : 'text-no'}
                    >
                      {formatPnl(trade.realizedPnl)}
                    </span>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
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
                <td className="px-2 py-2.5 text-[0.6rem] text-muted last:pr-0">
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

      <div className="divide-y divide-border/60 sm:hidden">
        {trades.map((trade) => (
          <div key={trade.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
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
                <span className="font-mono text-fg">
                  @ {(trade.fillPrice ?? trade.price).toFixed(4)}
                </span>
              </div>
              {trade.realizedPnl != null ? (
                <span
                  className={cn(
                    'font-mono font-medium',
                    trade.realizedPnl >= 0 ? 'text-yes' : 'text-no'
                  )}
                >
                  {formatPnl(trade.realizedPnl)}
                </span>
              ) : (
                <span className="text-muted">-</span>
              )}
            </div>
            <p className="text-[0.6rem] text-muted">
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

function SessionsSkeleton() {
  return (
    <div className="divide-y divide-border/60" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-2" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-1 w-full" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
