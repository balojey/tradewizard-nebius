'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { TierGate } from '@/components/ui/TierGate';
import {
  usePortfolioActivation,
  usePortfolioPreflightCheck,
} from '@/hooks/usePortfolioActivation';
import { useWallet } from '@/providers/WalletContext';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';
import {
  Bot,
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
  const { data: personaSettings, isLoading: isPersonaLoading } = usePersonaSettings();
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

  const personaName =
    personaSettings?.persona?.name ??
    personaSettings?.description?.name ??
    'your persona';
  const personaRisk =
    personaSettings?.persona?.riskLevel ??
    personaSettings?.description?.riskLevel ??
    null;
  const personaTagline =
    personaSettings?.description?.tagline ??
    personaSettings?.description?.entryPhilosophy ??
    'Follows your selected entry, sizing, monitoring, and exit rules on this market.';
  const riskTone =
    personaRisk === 'aggressive'
      ? 'border-no/30 bg-no/10 text-no'
      : personaRisk === 'conservative'
        ? 'border-yes/30 bg-yes/10 text-yes'
        : 'border-warning/30 bg-warning/10 text-warning';
  const ctaLabel =
    !isNaN(parsedAmount) && parsedAmount >= MIN_INVESTMENT
      ? `Start autopilot · $${parsedAmount.toFixed(0)}`
      : 'Start autopilot';
  const preflightLabel = isPreflightLoading
    ? 'Checking'
    : canActivate
      ? 'Ready'
      : 'Action needed';

  return (
    <TierGate plan="pro" feature="Portfolio Manager" showLocked={true}>
      <section className="relative overflow-hidden rounded-2xl border border-dashed border-accent/35 bg-surface">
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent via-accent/50 to-transparent"
          aria-hidden="true"
        />
        <div className="flex items-center gap-2.5 border-b border-dashed border-accent/15 px-4 py-3.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white shadow-[0_6px_18px_-8px_oklch(62%_0.20_260_/_0.8)]">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Autopilot</h2>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-accent">
                Pro
              </span>
            </div>
            <p className="text-[0.6rem] text-muted">
              Portfolio Manager · session ticket
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.55rem] font-medium',
              isPreflightLoading
                ? 'border-border bg-surface-2 text-muted'
                : canActivate
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-warning/30 bg-warning/10 text-warning'
            )}
          >
            <span
              className={cn(
                'h-1 w-1 rounded-full',
                isPreflightLoading
                  ? 'bg-muted'
                  : canActivate
                    ? 'bg-accent'
                    : 'bg-warning'
              )}
              aria-hidden="true"
            />
            {preflightLabel}
          </span>
        </div>

        <div className="bg-gradient-to-b from-accent/[0.04] to-transparent p-4">
          {isPersonaLoading ? (
            <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ) : (
            <div className="rounded-lg border border-accent/15 bg-accent/[0.04] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg">{personaName}</span>
                {personaRisk && (
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[0.55rem] font-medium capitalize',
                      riskTone
                    )}
                  >
                    {personaRisk}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">
                {personaTagline}
              </p>
            </div>
          )}

          <p className="mt-2 text-[0.62rem] leading-relaxed text-muted">
            Watches each new analysis · executes with hard stop-loss and
            take-profit rails.
          </p>

          <div className="mt-3">
            <PreflightStatus
              isLoading={isPreflightLoading}
              canActivate={canActivate}
              reason={preflightReason}
            />
          </div>

          {activation.isSuccess ? (
            <div className="mt-3 rounded-xl border border-yes/20 bg-yes/[0.05] p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-yes" aria-hidden="true" />
                <p className="text-xs font-medium text-yes">Autopilot is live</p>
              </div>
              <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">
                Your session is watching this market. Every decision is logged.
              </p>
              <a
                href="/portfolio-manager"
                className="mt-2 inline-flex items-center gap-1 text-[0.68rem] font-medium text-accent hover:underline"
              >
                Open dashboard
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="pm-investment"
                    className="mb-1 block text-[0.65rem] font-medium text-muted"
                  >
                    Stake
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted">
                      $
                    </span>
                    <input
                      id="pm-investment"
                      type="number"
                      min={MIN_INVESTMENT}
                      step="any"
                      placeholder={String(MIN_INVESTMENT)}
                      value={investmentAmount}
                      onChange={(e) => {
                        setInvestmentAmount(e.target.value);
                        setValidationError(null);
                        if (activation.isError) activation.reset();
                      }}
                      disabled={activation.isPending}
                      className="w-full rounded-lg border border-border bg-bg py-2 pl-6 pr-2 font-mono text-xs text-fg placeholder:text-muted/40 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="pm-profit-target"
                    className="mb-1 block text-[0.65rem] font-medium text-muted"
                  >
                    Target <span className="text-muted/60">(optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="pm-profit-target"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="25"
                      value={profitTarget}
                      onChange={(e) => setProfitTarget(e.target.value)}
                      disabled={activation.isPending}
                      className="w-full rounded-lg border border-border bg-bg py-2 pl-2 pr-6 font-mono text-xs text-fg placeholder:text-muted/40 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted">
                      %
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[0.6rem]">
                <div>
                  {amountTooLow && (
                    <span className="text-no">Min ${MIN_INVESTMENT}</span>
                  )}
                  {amountTooHigh && (
                    <span className="text-no">Exceeds balance</span>
                  )}
                  {!amountTooLow && !amountTooHigh && (
                    <span className="text-muted">Min ${MIN_INVESTMENT}</span>
                  )}
                </div>
                <span className="text-muted">
                  Wallet{' '}
                  {isBalanceLoading ? (
                    <span className="inline-block h-2.5 w-10 animate-pulse rounded bg-surface-2 align-middle" />
                  ) : (
                    <span className="font-mono text-fg">${usdcBalance.toFixed(2)}</span>
                  )}
                </span>
              </div>

              {validationError && (
                <div className="flex items-start gap-2 rounded-lg border border-no/20 bg-no/[0.05] p-2.5">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-no" aria-hidden="true" />
                  <p className="text-xs text-no">{validationError}</p>
                </div>
              )}

              {activation.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-no/20 bg-no/[0.05] p-2.5">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-no" aria-hidden="true" />
                  <p className="text-xs text-no">
                    {classifyActivationError(activation.error)}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={activation.isPending}
                disabled={!canSubmit}
                className="w-full"
              >
                {ctaLabel}
              </Button>
            </form>
          )}
        </div>
      </section>
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
      <div className="flex items-center gap-2 text-[0.65rem] text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
        Checking plan, wallet, and analysis…
      </div>
    );
  }

  if (canActivate) {
    return (
      <div className="flex items-center gap-2 text-[0.65rem] text-yes">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        All checks passed
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-[0.65rem] leading-relaxed text-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{reason}</span>
    </div>
  );
}
