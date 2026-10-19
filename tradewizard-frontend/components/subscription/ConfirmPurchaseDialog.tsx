'use client';

import { useEffect, useRef } from 'react';
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import Portal from '@/components/Portal';
import { cn } from '@/utils/classNames';
import { SUCCESS_STYLES, ERROR_STYLES } from '@/constants/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfirmPurchaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  planName: string;
  planPrice: number;
  currentBalance: number;
  currentPlan?: string;
  onConfirm: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Plan pricing for proration display
// ---------------------------------------------------------------------------

const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 19,
  pro: 49,
  elite: 149,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfirmPurchaseDialog({
  isOpen,
  onClose,
  planId,
  planName,
  planPrice,
  currentBalance,
  currentPlan,
  onConfirm,
  isLoading,
  error,
  success,
}: ConfirmPurchaseDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Determine if this is a plan change (proration applies)
  const isPlanChange =
    currentPlan !== undefined &&
    currentPlan !== 'free' &&
    currentPlan !== planId;

  const currentPlanPrice = currentPlan ? PLAN_PRICES[currentPlan] ?? 0 : 0;

  // Remaining balance after purchase
  const remainingBalance = currentBalance - planPrice;
  const isInsufficientBalance = remainingBalance < 0;

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Focus trap: focus the modal when it opens
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) onClose();
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={handleBackdropClick}
        aria-hidden="true"
      >
        <div
          ref={modalRef}
          className="bg-gray-900 rounded-2xl p-6 max-w-md w-full border border-white/10 shadow-2xl animate-modal-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-purchase-title"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2
              id="confirm-purchase-title"
              className="text-lg font-bold text-white"
            >
              Confirm Purchase
            </h2>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="text-gray-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg p-1"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Success State */}
          {success && (
            <div className="space-y-4">
              <div className={cn(SUCCESS_STYLES, 'flex items-center gap-3')}>
                <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                <p className="text-green-300 font-medium text-sm">
                  Successfully subscribed to <span className="font-bold">{planName}</span>!
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-white text-black hover:bg-gray-200 active:scale-[0.98] transition-all duration-200"
              >
                Close
              </button>
            </div>
          )}

          {/* Main Content (non-success state) */}
          {!success && (
            <div className="space-y-4">
              {/* Plan Details */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Plan</span>
                  <span className="text-white font-semibold">
                    {planName} - {planPrice} USD
                  </span>
                </div>
              </div>

              {/* Proration Info (for plan changes) */}
              {isPlanChange && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                  <p className="text-xs text-indigo-300 font-medium mb-1">
                    Plan Change Proration
                  </p>
                  <p className="text-sm text-gray-300">
                    You&apos;re changing from your current plan ({currentPlanPrice} USD/mo).
                    A prorated credit for unused days will be applied to reduce the charge.
                  </p>
                </div>
              )}

              {/* Balance Breakdown */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    Trading Wallet Balance
                  </span>
                  <span className="text-white font-medium">
                    {currentBalance.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Plan Price</span>
                  <span className="text-white font-medium">
                    −{planPrice.toFixed(2)} USD
                  </span>
                </div>
                <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    Remaining Balance
                  </span>
                  <span
                    className={cn(
                      'font-semibold',
                      isInsufficientBalance ? 'text-red-400' : 'text-green-400'
                    )}
                  >
                    {remainingBalance.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Insufficient Balance Warning */}
              {isInsufficientBalance && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">
                    Insufficient balance. You need{' '}
                    <span className="font-semibold">
                      {Math.abs(remainingBalance).toFixed(2)} USD
                    </span>{' '}
                    more to complete this purchase.
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className={cn(ERROR_STYLES, 'flex items-start gap-2 !p-3')}>
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
                  <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0" />
                  <p className="text-sm text-indigo-300 font-medium">
                    On-chain transfer in progress...
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold bg-white/10 text-gray-300 hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  disabled={isLoading || isInsufficientBalance}
                  className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                  aria-label={`Confirm purchase of ${planName} plan for ${planPrice} USD`}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </span>
                  ) : error ? (
                    'Retry'
                  ) : (
                    'Confirm'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
