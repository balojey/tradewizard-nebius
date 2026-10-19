'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Shield,
  TrendingUp,
  ExternalLink,
} from 'lucide-react';
import {
  usePortfolioActivation,
  usePortfolioPreflightCheck,
} from '@/hooks/usePortfolioActivation';
import { useSubscription } from '@/hooks/useSubscription';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';
import { usePortfolioSessions } from '@/hooks/usePortfolioSessions';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import { useWallet } from '@/providers/WalletContext';

// --- Types ---

interface ActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  marketId: string;
  marketName?: string;
}

type ModalState = 'form' | 'submitting' | 'success' | 'error';

// --- Constants ---

const MIN_INVESTMENT = 5;

const SESSION_LIMITS: Record<string, number> = {
  pro: 3,
  elite: 10,
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  conservative: 'text-green-600 dark:text-green-400',
  moderate: 'text-yellow-600 dark:text-yellow-400',
  aggressive: 'text-red-600 dark:text-red-400',
};

const RISK_LEVEL_BG: Record<string, string> = {
  conservative: 'bg-green-50 dark:bg-green-900/20',
  moderate: 'bg-yellow-50 dark:bg-yellow-900/20',
  aggressive: 'bg-red-50 dark:bg-red-900/20',
};

// --- Main Component ---

export default function ActivationModal({
  isOpen,
  onClose,
  marketId,
  marketName,
}: ActivationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Hooks
  const { eoaAddress } = useWallet();
  const { data: subscription } = useSubscription();
  const { data: personaSettings, isLoading: isPersonaLoading } = usePersonaSettings();
  const { data: sessionsData } = usePortfolioSessions();
  const { usdcBalance, isLoading: isBalanceLoading } = usePolygonBalances(eoaAddress);
  const { canActivate, reason: preflightReason, isLoading: isPreflightLoading } =
    usePortfolioPreflightCheck(isOpen ? marketId : null);
  const activationMutation = usePortfolioActivation();

  // Local state
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [modalState, setModalState] = useState<ModalState>('form');
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Derived values
  const plan = subscription?.plan ?? 'free';
  const sessionLimit = SESSION_LIMITS[plan] ?? 0;
  const activeSessions =
    sessionsData?.sessions?.filter(
      (s) => s.status === 'active' || s.status === 'paused' || s.status === 'exiting'
    ) ?? [];
  const activeSessionCount = activeSessions.length;

  const parsedAmount = parseFloat(investmentAmount);
  const isAmountValid =
    !isNaN(parsedAmount) && parsedAmount >= MIN_INVESTMENT && parsedAmount <= usdcBalance;
  const amountTooLow = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < MIN_INVESTMENT;
  const amountTooHigh = !isNaN(parsedAmount) && parsedAmount > usdcBalance;

  const canSubmit = canActivate && isAmountValid && modalState === 'form';

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setInvestmentAmount('');
      setModalState('form');
      setCreatedSessionId(null);
      setApiError(null);
      activationMutation.reset();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setModalState('submitting');
    setApiError(null);

    try {
      const result = await activationMutation.mutateAsync({
        marketId,
        investmentAmount: parsedAmount,
      });

      setCreatedSessionId(result.sessionId);
      setModalState('success');
    } catch (err: unknown) {
      setModalState('error');

      if (err && typeof err === 'object' && 'message' in err) {
        const error = err as { message: string; code?: string };
        // Map known error codes to user-friendly messages
        if (error.message?.includes('insufficient balance')) {
          setApiError('Insufficient wallet balance to cover this investment amount.');
        } else if (error.message?.includes('session limit')) {
          setApiError(
            `You have reached the maximum of ${sessionLimit} active sessions for your ${plan} plan.`
          );
        } else if (error.message?.includes('recurring analysis')) {
          setApiError(
            'An active recurring analysis subscription is required on this market. Please set up recurring analysis first.'
          );
        } else if (error.message?.includes('resolved')) {
          setApiError('This market has already resolved and is no longer active.');
        } else if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
          setApiError('You already have an active session on this market.');
        } else {
          setApiError(error.message || 'An unexpected error occurred. Please try again.');
        }
      } else {
        setApiError('An unexpected error occurred. Please try again.');
      }
    }
  }, [canSubmit, marketId, parsedAmount, activationMutation, sessionLimit, plan]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={modalRef}
          className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activation-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-500" />
              <h2
                id="activation-modal-title"
                className="text-lg font-semibold text-gray-900 dark:text-white"
              >
                Activate Portfolio Manager
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {modalState === 'success' ? (
              <SuccessState sessionId={createdSessionId} onClose={onClose} />
            ) : (
              <>
                {/* Market Name */}
                {marketName && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Market</p>
                    <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white line-clamp-2">
                      {marketName}
                    </p>
                  </div>
                )}

                {/* Preflight Checks */}
                <PreflightChecks
                  isLoading={isPreflightLoading}
                  canActivate={canActivate}
                  reason={preflightReason}
                  plan={plan}
                  activeSessionCount={activeSessionCount}
                  sessionLimit={sessionLimit}
                />

                {/* Persona Info */}
                <PersonaInfo
                  isLoading={isPersonaLoading}
                  personaName={personaSettings?.persona?.name}
                  riskLevel={personaSettings?.persona?.riskLevel}
                />

                {/* Session Count */}
                <SessionCountDisplay
                  activeCount={activeSessionCount}
                  limit={sessionLimit}
                  plan={plan}
                />

                {/* Investment Amount Input */}
                <InvestmentInput
                  value={investmentAmount}
                  onChange={setInvestmentAmount}
                  walletBalance={usdcBalance}
                  isBalanceLoading={isBalanceLoading}
                  amountTooLow={amountTooLow}
                  amountTooHigh={amountTooHigh}
                  disabled={modalState === 'submitting'}
                />

                {/* API Error */}
                {apiError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-700 dark:text-red-300">{apiError}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {modalState !== 'success' && (
            <div className="border-t border-gray-200 px-6 py-4 dark:border-gray-700">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || modalState !== 'form'}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {modalState === 'submitting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Activating...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Activate
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Sub-Components ---

function PreflightChecks({
  isLoading,
  canActivate,
  reason,
  plan,
  activeSessionCount,
  sessionLimit,
}: {
  isLoading: boolean;
  canActivate: boolean;
  reason?: string;
  plan: string;
  activeSessionCount: number;
  sessionLimit: number;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Running pre-activation checks...
          </span>
        </div>
      </div>
    );
  }

  if (canActivate) {
    return (
      <div className="rounded-lg bg-green-50 px-4 py-3 dark:bg-green-900/20">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-700 dark:text-green-300">
            All pre-activation checks passed
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Cannot activate
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{reason}</p>
        </div>
      </div>
    </div>
  );
}

function PersonaInfo({
  isLoading,
  personaName,
  riskLevel,
}: {
  isLoading: boolean;
  personaName?: string;
  riskLevel?: 'conservative' | 'moderate' | 'aggressive';
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Loading persona...</span>
        </div>
      </div>
    );
  }

  if (!personaName || !riskLevel) return null;

  const colorClass = RISK_LEVEL_COLORS[riskLevel] ?? 'text-gray-600';
  const bgClass = RISK_LEVEL_BG[riskLevel] ?? 'bg-gray-50 dark:bg-gray-800';

  return (
    <div className={`rounded-lg px-4 py-3 ${bgClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">Active Persona</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {personaName}
          </span>
          <span
            className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full ${colorClass} bg-white/50 dark:bg-black/20`}
          >
            {riskLevel}
          </span>
        </div>
      </div>
    </div>
  );
}

function SessionCountDisplay({
  activeCount,
  limit,
  plan,
}: {
  activeCount: number;
  limit: number;
  plan: string;
}) {
  if (plan !== 'pro' && plan !== 'elite') return null;

  const isAtLimit = activeCount >= limit;

  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm text-gray-600 dark:text-gray-400">Active Sessions</span>
      </div>
      <span
        className={`text-sm font-semibold ${
          isAtLimit ? 'text-red-500' : 'text-gray-900 dark:text-white'
        }`}
      >
        {activeCount} / {limit}
      </span>
    </div>
  );
}

function InvestmentInput({
  value,
  onChange,
  walletBalance,
  isBalanceLoading,
  amountTooLow,
  amountTooHigh,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  walletBalance: number;
  isBalanceLoading: boolean;
  amountTooLow: boolean;
  amountTooHigh: boolean;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor="investment-amount"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
      >
        Investment Amount (USD)
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
        <input
          id="investment-amount"
          type="number"
          min={MIN_INVESTMENT}
          max={walletBalance}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={`Min $${MIN_INVESTMENT}`}
          className={`w-full rounded-lg border pl-7 pr-4 py-2.5 text-sm transition-colors
            ${
              amountTooLow || amountTooHigh
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500 dark:border-red-700'
                : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600'
            }
            bg-white dark:bg-gray-800 text-gray-900 dark:text-white
            placeholder:text-gray-400 dark:placeholder:text-gray-500
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-offset-0`}
          aria-describedby="investment-hint"
        />
      </div>

      {/* Wallet balance hint */}
      <div id="investment-hint" className="mt-1.5 flex items-center justify-between">
        <div>
          {amountTooLow && (
            <p className="text-xs text-red-500">Minimum investment is ${MIN_INVESTMENT}</p>
          )}
          {amountTooHigh && (
            <p className="text-xs text-red-500">Exceeds wallet balance</p>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Balance:{' '}
          {isBalanceLoading ? (
            <span className="inline-block w-12 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : (
            <span className="font-medium">${walletBalance.toFixed(2)}</span>
          )}
        </p>
      </div>

      {/* Max button */}
      {!isBalanceLoading && walletBalance > 0 && (
        <button
          type="button"
          onClick={() => onChange(walletBalance.toFixed(2))}
          disabled={disabled}
          className="mt-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium disabled:opacity-50"
        >
          Use max ({walletBalance.toFixed(2)})
        </button>
      )}
    </div>
  );
}

function SuccessState({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  return (
    <div className="text-center py-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
        Portfolio Manager Activated
      </h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Your autonomous trading session is now active. The portfolio manager will begin
        evaluating opportunities on the next analysis delivery.
      </p>
      {sessionId && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          Session ID: <span className="font-mono">{sessionId.slice(0, 8)}...</span>
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <a
          href="/portfolio"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Go to Portfolio Dashboard
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
