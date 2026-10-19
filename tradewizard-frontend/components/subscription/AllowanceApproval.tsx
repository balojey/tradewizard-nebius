'use client';

import { Loader2, CheckCircle, ShieldCheck, AlertCircle } from 'lucide-react';
import { useSubscriptionAllowance } from '@/hooks/useSubscriptionAllowance';
import { USDC_E_DECIMALS } from '@/constants/tokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a bigint USD amount (6 decimals) to a human-readable string. */
function formatUsdc(amount: bigint): string {
  const divisor = BigInt(10 ** USDC_E_DECIMALS);
  const whole = amount / divisor;
  const fractional = amount % divisor;
  const fractionalStr = fractional.toString().padStart(USDC_E_DECIMALS, '0').slice(0, 2);
  return `${whole}.${fractionalStr}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AllowanceApproval - UI for approving/revoking USD allowance for auto-renewal.
 *
 * Displays the current auto-renewal status and provides toggle buttons to
 * enable or disable the allowance. Shows loading states during SafeTransaction
 * execution and inline error messages on failure.
 *
 * Validates: Requirements 2.1, 3.7, 6.10
 */
export default function AllowanceApproval() {
  const {
    allowance,
    isAutoRenewalEnabled,
    isLoading,
    planPrice,
    approveAllowance,
    revokeAllowance,
  } = useSubscriptionAllowance();

  const isApproving = approveAllowance.isPending;
  const isRevoking = revokeAllowance.isPending;
  const isMutating = isApproving || isRevoking;

  const approveError = approveAllowance.error?.message ?? null;
  const revokeError = revokeAllowance.error?.message ?? null;
  const errorMessage = approveError || revokeError;

  // Don't render for free plan (planPrice === 0)
  if (planPrice === BigInt(0)) return null;

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4"
      aria-labelledby="allowance-approval-heading"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0" aria-hidden="true" />
        <h3 id="allowance-approval-heading" className="text-base font-semibold text-white">
          Auto-Renewal
        </h3>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Status:</span>
        {isLoading ? (
          <span className="text-sm text-gray-500">Loading...</span>
        ) : isAutoRenewalEnabled ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-400">
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-yellow-400">
            Disabled
          </span>
        )}
      </div>

      {/* Current allowance amount */}
      {allowance > BigInt(0) && (
        <div className="text-xs text-gray-400 bg-white/5 rounded-lg px-3 py-2">
          Current allowance: <span className="text-white font-medium">{formatUsdc(allowance)} USD</span>
        </div>
      )}

      {/* Explanation */}
      <p className="text-sm text-gray-400 leading-relaxed">
        Auto-renewal allows TradeWizard to automatically renew your subscription at the end of each
        billing cycle without requiring manual action.
      </p>

      {/* Error Message */}
      {errorMessage && (
        <div
          className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-red-300">{errorMessage}</p>
        </div>
      )}

      {/* Action Button */}
      {isAutoRenewalEnabled ? (
        <button
          onClick={() => revokeAllowance.mutate()}
          disabled={isMutating}
          aria-label="Disable auto-renewal by revoking USD allowance"
          className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-white/10 text-gray-300 hover:bg-white/20 border border-white/5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {isRevoking ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Revoking allowance...
            </span>
          ) : (
            'Disable Auto-Renewal'
          )}
        </button>
      ) : (
        <button
          onClick={() => approveAllowance.mutate({})}
          disabled={isMutating}
          aria-label="Enable auto-renewal by approving USD allowance"
          className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {isApproving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Approving allowance...
            </span>
          ) : (
            'Enable Auto-Renewal'
          )}
        </button>
      )}
    </section>
  );
}
