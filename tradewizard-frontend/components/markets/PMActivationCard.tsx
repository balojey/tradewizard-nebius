'use client';

import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TierGate } from '@/components/ui/TierGate';
import {
  usePortfolioActivation,
  usePortfolioPreflightCheck,
} from '@/hooks/usePortfolioActivation';
import { useWallet } from '@/providers/WalletContext';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
  ExternalLink,
} from 'lucide-react';

interface PMActivationCardProps {
  slug: string;
  conditionId?: string;
}

// --- Constants ---

const MIN_INVESTMENT = 5;

// --- Error Classification ---

function classifyActivationError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'An unexpected error occurred.';

  const lower = message.toLowerCase();

  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'Insufficient wallet balance to cover this investment. Please add funds to your Trading Wallet.';
  }
  if (lower.includes('session limit') || lower.includes('concurrent session')) {
    return "You've reached the maximum number of active sessions for your plan.";
  }
  if (lower.includes('recurring analysis')) {
    return 'A recurring analysis subscription is required on this market. Please set one up first.';
  }
  if (lower.includes('resolved')) {
    return 'This market has already resolved and cannot be activated.';
  }
  if (lower.includes('already exists') || lower.includes('duplicate')) {
    return 'You already have an active Portfolio Manager session on this market.';
  }
  if (lower.includes('wallet') && lower.includes('connect')) {
    return 'Please connect your wallet before activating the Portfolio Manager.';
  }
  if (lower.includes('upgrade') || lower.includes('pro or elite')) {
    return 'Portfolio Manager requires a Pro or Elite subscription.';
  }

  return message || 'Failed to activate Portfolio Manager. Please try again.';
}

// --- Main Component ---

/**
 * Portfolio Manager Activation Card for market detail page.
 *
 * Includes pre-flight checks (plan, session limits, recurring analysis),
 * wallet balance display, and proper error classification.
 *
 * Wrapped in TierGate plan="pro" - non-pro users see a lock overlay.
 *
 * Requirements: 8.11, 8.12, 8.13
 */
export function PMActivationCard({ slug, conditionId }: PMActivationCardProps) {
  const marketId = conditionId || slug;

  // Hooks
  const { eoaAddress } = useWallet();
  const { usdcBalance, isLoading: isBalanceLoading } = usePolygonBalances(eoaAddress);
  const { canActivate, reason: preflightReason, isLoading: isPreflightLoading } =
    usePortfolioPreflightCheck(marketId);
  const activation = usePortfolioActivation();

  // Local state
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [profitTarget, setProfitTarget] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Derived
  const parsedAmount = parseFloat(investmentAmount);
  const isAmountValid =
    !isNaN(parsedAmount) && parsedAmount >= MIN_INVESTMENT && parsedAmount <= usdcBalance;
  const amountTooLow =
    !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < MIN_INVESTMENT;
  const amountTooHigh = !isNaN(parsedAmount) && parsedAmount > usdcBalance;

  const canSubmit =
    canActivate && isAmountValid && !activation.isPending && !activation.isSuccess;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError(null);

      if (!investmentAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        setValidationError('Please enter an investment amount.');
        return;
      }

      if (parsedAmount < MIN_INVESTMENT) {
        setValidationError(`Minimum investment is $${MIN_INVESTMENT}.`);
        return;
      }

      if (parsedAmount > usdcBalance) {
        setValidationError(
          `Insufficient balance. You have $${usdcBalance.toFixed(2)} available.`
        );
        return;
      }

      const payload: {
        marketId: string;
        investmentAmount: number;
        profitTargetPct?: number;
      } = {
        marketId,
        investmentAmount: parsedAmount,
      };

      const target = parseFloat(profitTarget);
      if (profitTarget && !isNaN(target) && target > 0) {
        payload.profitTargetPct = target;
      }

      activation.mutate(payload);
    },
    [investmentAmount, parsedAmount, profitTarget, marketId, usdcBalance, activation]
  );

  return (
    <TierGate plan="pro" feature="Portfolio Manager" showLocked={true}>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-1">
          Portfolio Manager
        </h3>
        <p className="text-sm text-muted mb-4">
          Activate autonomous trading for this market
        </p>

        {/* Pre-flight status */}
        <PreflightStatus
          isLoading={isPreflightLoading}
          canActivate={canActivate}
          reason={preflightReason}
        />

        <form onSubmit={handleSubmit} className="space-y-3 mt-3">
          {/* Investment Amount */}
          <div>
            <label
              htmlFor="pm-investment"
              className="block text-xs font-medium text-muted mb-1"
            >
              Investment Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                $
              </span>
              <input
                id="pm-investment"
                type="number"
                min={MIN_INVESTMENT}
                step="any"
                placeholder={`Min $${MIN_INVESTMENT}`}
                value={investmentAmount}
                onChange={(e) => {
                  setInvestmentAmount(e.target.value);
                  setValidationError(null);
                  if (activation.isError) activation.reset();
                }}
                disabled={activation.isPending || activation.isSuccess}
                className="w-full pl-7 pr-3 py-2 text-sm bg-surface-2 border border-border rounded-lg text-fg placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            {/* Balance + validation hints */}
            <div className="mt-1 flex items-center justify-between">
              <div>
                {amountTooLow && (
                  <p className="text-[11px] text-no">Min ${MIN_INVESTMENT}</p>
                )}
                {amountTooHigh && (
                  <p className="text-[11px] text-no">Exceeds balance</p>
                )}
              </div>
              <p className="text-[11px] text-muted">
                Balance:{' '}
                {isBalanceLoading ? (
                  <span className="inline-block w-10 h-2.5 bg-surface-2 rounded animate-pulse align-middle" />
                ) : (
                  <span className="font-medium">${usdcBalance.toFixed(2)}</span>
                )}
              </p>
            </div>
          </div>

          {/* Profit Target (optional) */}
          <div>
            <label
              htmlFor="pm-profit-target"
              className="block text-xs font-medium text-muted mb-1"
            >
              Profit Target (optional)
            </label>
            <div className="relative">
              <input
                id="pm-profit-target"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 25"
                value={profitTarget}
                onChange={(e) => setProfitTarget(e.target.value)}
                disabled={activation.isPending || activation.isSuccess}
                className="w-full pl-3 pr-7 py-2 text-sm bg-surface-2 border border-border rounded-lg text-fg placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                %
              </span>
            </div>
          </div>

          {/* Validation error */}
          {validationError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-no/5 border border-no/20">
              <XCircle className="w-3.5 h-3.5 text-no mt-0.5 shrink-0" />
              <p className="text-xs text-no">{validationError}</p>
            </div>
          )}

          {/* Mutation error */}
          {activation.isError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-no/5 border border-no/20">
              <XCircle className="w-3.5 h-3.5 text-no mt-0.5 shrink-0" />
              <p className="text-xs text-no">
                {classifyActivationError(activation.error)}
              </p>
            </div>
          )}

          {/* Success message */}
          {activation.isSuccess && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yes/5 border border-yes/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-yes mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs text-yes font-medium">
                  Portfolio Manager activated!
                </p>
                <a
                  href="/portfolio-manager"
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  Go to Dashboard
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="ai"
            size="md"
            loading={activation.isPending}
            disabled={!canSubmit}
            className="w-full"
          >
            Activate
          </Button>
        </form>
      </Card>
    </TierGate>
  );
}

// --- Pre-flight Status Sub-Component ---

function PreflightStatus({
  isLoading,
  canActivate,
  reason,
}: {
  isLoading: boolean;
  canActivate: boolean;
  reason?: string;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        <span className="text-xs text-muted">Checking requirements...</span>
      </div>
    );
  }

  if (canActivate) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-yes/5 border border-yes/20">
        <CheckCircle2 className="w-3.5 h-3.5 text-yes" />
        <span className="text-xs text-yes">Ready to activate</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning/5 border border-warning/20">
      <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
      <p className="text-xs text-warning">{reason}</p>
    </div>
  );
}
