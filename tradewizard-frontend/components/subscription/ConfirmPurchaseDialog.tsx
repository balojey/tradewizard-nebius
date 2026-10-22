'use client';

import { useEffect, useRef } from 'react';
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import Portal from '@/components/Portal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';

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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={handleBackdropClick}
        aria-hidden="true"
      >
        <div
          ref={modalRef}
          className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-fg shadow-[var(--shadow-lg)] animate-modal-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-purchase-title"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <h2 id="confirm-purchase-title" className="text-lg font-bold text-fg">
              Confirm Purchase
            </h2>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg p-1 text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Success State */}
          {success && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-yes/30 bg-yes/10 p-3">
                <CheckCircle className="h-5 w-5 shrink-0 text-yes" />
                <p className="text-sm font-medium text-yes">
                  Successfully subscribed to <span className="font-bold">{planName}</span>!
                </p>
              </div>
              <Button type="button" variant="primary" className="w-full" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {/* Main Content (non-success state) */}
          {!success && (
            <div className="space-y-4">
              {/* Plan Details */}
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Plan</span>
                  <span className="font-semibold text-fg">
                    {planName} - {planPrice} USD
                  </span>
                </div>
              </div>

              {/* Proration Info (for plan changes) */}
              {isPlanChange && (
                <div className="rounded-xl border border-ai/20 bg-ai/10 p-4">
                  <p className="mb-1 text-xs font-medium text-ai">
                    Plan Change Proration
                  </p>
                  <p className="text-sm text-muted">
                    You&apos;re changing from your current plan ({currentPlanPrice} USD/mo).
                    A prorated credit for unused days will be applied to reduce the charge.
                  </p>
                </div>
              )}

              {/* Balance Breakdown */}
              <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Trading Wallet Balance</span>
                  <span className="font-medium text-fg">
                    {currentBalance.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Plan Price</span>
                  <span className="font-medium text-fg">
                    −{planPrice.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted">Remaining Balance</span>
                  <span
                    className={cn(
                      'font-semibold',
                      isInsufficientBalance ? 'text-no' : 'text-yes'
                    )}
                  >
                    {remainingBalance.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Insufficient Balance Warning */}
              {isInsufficientBalance && (
                <div className="flex items-start gap-2 rounded-xl border border-no/20 bg-no/10 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-no" />
                  <p className="text-sm text-no">
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
                <div className="flex items-start gap-2 rounded-xl border border-no/20 bg-no/10 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-no" />
                  <p className="text-sm text-no">{error}</p>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/10 p-4">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
                  <p className="text-sm font-medium text-accent">
                    On-chain transfer in progress...
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={onClose}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="flex-1"
                  onClick={onConfirm}
                  loading={isLoading}
                  disabled={isLoading || isInsufficientBalance}
                  aria-label={`Confirm purchase of ${planName} plan for ${planPrice} USD`}
                >
                  {isLoading ? 'Processing...' : error ? 'Retry' : 'Confirm'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
