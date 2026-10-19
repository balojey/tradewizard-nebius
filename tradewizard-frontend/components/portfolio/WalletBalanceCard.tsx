'use client';

import { useMemo } from 'react';
import { Wallet, ArrowUpRight, Lock, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
      <Card className="p-4 sm:p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 bg-surface-2 rounded" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-12 bg-surface-2 rounded" />
            <div className="h-12 bg-surface-2 rounded" />
            <div className="h-12 bg-surface-2 rounded" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-accent" aria-hidden="true" />
          <h3 className="text-sm font-medium text-fg">Wallet Balance</h3>
          <Badge tone="neutral" size="sm">USD</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onDeposit}>
            <ArrowUpRight className="w-3.5 h-3.5 mr-1.5 rotate-180" aria-hidden="true" />
            Deposit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onWithdraw}
            disabled={available <= 0}
          >
            <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Withdraw
          </Button>
        </div>
      </div>

      {/* Safe address */}
      {safeAddress && (
        <button
          onClick={copyAddress}
          className={cn(
            'flex items-center gap-2 mb-4 px-3 py-2 rounded-lg w-full text-left transition-colors',
            'bg-surface-2/50 hover:bg-surface-2 border border-transparent',
            copied && 'border-yes/30 bg-yes/5'
          )}
          aria-label={copied ? 'Address copied' : 'Copy wallet address'}
        >
          <span className="text-xs text-muted shrink-0">Address:</span>
          <span className="text-xs font-mono text-fg truncate">{safeAddress}</span>
          {copied ? (
            <Check className="w-3.5 h-3.5 text-yes shrink-0 ml-auto" aria-hidden="true" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-muted shrink-0 ml-auto" aria-hidden="true" />
          )}
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Total Balance */}
        <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-2/50">
          <span className="text-xs text-muted">Total Balance</span>
          <span className="text-lg font-mono font-semibold text-fg">
            ${usdcBalance.toFixed(2)}
          </span>
        </div>

        {/* Committed */}
        <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-2/50">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">Committed</span>
            <Lock className="w-3 h-3 text-warning" aria-hidden="true" />
          </div>
          <span
            className={cn(
              'text-lg font-mono font-semibold',
              committedCapital > 0 ? 'text-warning' : 'text-fg'
            )}
          >
            ${committedCapital.toFixed(2)}
          </span>
          {committedCapital > 0 && (
            <span className="text-[10px] text-muted">In use by Portfolio Manager</span>
          )}
        </div>

        {/* Available */}
        <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-2/50">
          <span className="text-xs text-muted">Available</span>
          <span
            className={cn(
              'text-lg font-mono font-semibold',
              available > 0 ? 'text-yes' : 'text-fg'
            )}
          >
            ${available.toFixed(2)}
          </span>
          <span className="text-[10px] text-muted">Withdrawable</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onBridgeWithdraw}
        className="mt-4 text-xs text-accent hover:text-fg transition-colors"
      >
        Withdraw to another chain
      </button>
    </Card>
  );
}
