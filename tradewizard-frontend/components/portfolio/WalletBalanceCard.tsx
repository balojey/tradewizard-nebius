'use client';

import { useMemo } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Wallet,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import { usePortfolioSessions } from '@/hooks/usePortfolioSessions';
import useAddressCopy from '@/hooks/useAddressCopy';
import { useTrading } from '@/providers/TradingProvider';
import { cn } from '@/utils/classNames';

interface WalletBalanceCardProps {
  onWithdraw: () => void;
  onDeposit: () => void;
  onBridgeWithdraw: () => void;
}

export function WalletBalanceCard({
  onWithdraw,
  onDeposit,
  onBridgeWithdraw,
}: WalletBalanceCardProps) {
  const { safeAddress } = useTrading();
  const { usdcBalance, isLoading: balanceLoading } = usePolygonBalances(safeAddress);
  const { data: sessionsData } = usePortfolioSessions();
  const { copied, copyAddress } = useAddressCopy(safeAddress ?? null);

  // Committed capital = sum of investmentAmount across active/paused PM sessions
  const committedCapital = useMemo(() => {
    if (!sessionsData?.sessions) return 0;
    return sessionsData.sessions
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .reduce((sum, s) => sum + s.investmentAmount, 0);
  }, [sessionsData]);

  const available = Math.max(0, usdcBalance - committedCapital);

  if (balanceLoading) {
    return (
      <section className="rounded-2xl border border-border bg-surface">
        <div className="animate-pulse space-y-4 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-4 w-28 rounded bg-surface-2" />
              <div className="h-8 w-40 rounded bg-surface-2" />
            </div>
            <div className="h-10 w-44 rounded-lg bg-surface-2" />
          </div>
          <div className="h-16 rounded-lg bg-surface-2" />
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Wallet className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-fg">Trading wallet</h2>
                <p className="text-[0.6rem] text-muted">USDC on Polygon</p>
              </div>
              <span className="ml-1 rounded-full border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.55rem] text-muted">
                USD
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold leading-none tabular-nums text-fg">
                ${usdcBalance.toFixed(2)}
              </span>
              <span className="text-xs text-muted">total balance</span>
            </div>

            {safeAddress && (
              <button
                type="button"
                onClick={copyAddress}
                className="mt-2 inline-flex max-w-full items-center gap-1.5 text-[0.65rem] text-muted transition-colors hover:text-fg"
                aria-label={copied ? 'Address copied' : 'Copy wallet address'}
              >
                <span className="truncate font-mono">{safeAddress}</span>
                {copied ? (
                  <Check className="h-3 w-3 shrink-0 text-yes" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
              </button>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={onDeposit}>
              <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
              Deposit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onWithdraw}
              disabled={available <= 0}
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              Withdraw
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 divide-x divide-border/60 border-t border-border/60 pt-3 sm:grid-cols-3">
          <div className="pr-3">
            <p className="text-[0.6rem] text-muted">Available</p>
            <p
              className={cn(
                'mt-0.5 font-mono text-sm font-semibold tabular-nums',
                available > 0 ? 'text-yes' : 'text-fg'
              )}
            >
              ${available.toFixed(2)}
            </p>
            <p className="text-[0.55rem] text-muted">Ready to trade</p>
          </div>
          <div className="px-3">
            <p className="text-[0.6rem] text-muted">Committed</p>
            <p
              className={cn(
                'mt-0.5 font-mono text-sm font-semibold tabular-nums',
                committedCapital > 0 ? 'text-warning' : 'text-fg'
              )}
            >
              ${committedCapital.toFixed(2)}
            </p>
            <p className="text-[0.55rem] text-muted">In autopilot sessions</p>
          </div>
          <div className="col-span-2 px-3 pt-3 sm:col-span-1 sm:pt-0">
            <p className="text-[0.6rem] text-muted">Bridge</p>
            <button
              type="button"
              onClick={onBridgeWithdraw}
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-fg"
            >
              Withdraw to another chain
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <p className="text-[0.55rem] text-muted">USDC across chains</p>
          </div>
        </div>
      </div>
    </section>
  );
}
