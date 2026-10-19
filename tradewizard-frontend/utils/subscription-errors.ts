/**
 * Subscription Error Utilities
 *
 * Maps backend error codes and wallet relay errors to user-friendly messages
 * with actionable guidance. Distinguishes between retryable and terminal errors.
 */

import { ApiError } from '@/lib/api-client';
import { InsufficientBalanceError } from '@/hooks/useWalletSubscription';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface SubscriptionError {
  /** User-facing title (short) */
  title: string;
  /** User-facing description (actionable) */
  message: string;
  /** Visual severity - error (red), warning (yellow), info (blue) */
  severity: ErrorSeverity;
  /** Whether the user can retry the same action */
  retryable: boolean;
  /** Backend error code if available */
  code?: string;
}

// ---------------------------------------------------------------------------
// Backend Error Code → User-Friendly Message
// ---------------------------------------------------------------------------

const BACKEND_ERROR_MAP: Record<string, Omit<SubscriptionError, 'code'>> = {
  INVALID_REQUEST: {
    title: 'Invalid request',
    message: 'Something went wrong with the request. Please try again.',
    severity: 'error',
    retryable: true,
  },
  INVALID_PLAN: {
    title: 'Invalid plan',
    message: 'The selected plan is not available. Please choose a different plan.',
    severity: 'error',
    retryable: false,
  },
  INVALID_PACK: {
    title: 'Invalid credit pack',
    message: 'The selected credit pack is not available.',
    severity: 'error',
    retryable: false,
  },
  SAME_PLAN: {
    title: 'Already on this plan',
    message: "You're already subscribed to this plan. No changes needed.",
    severity: 'info',
    retryable: false,
  },
  ALREADY_CANCELLED: {
    title: 'Already cancelled',
    message: 'Your subscription has already been cancelled. It will remain active until the end of your billing period.',
    severity: 'info',
    retryable: false,
  },
  NO_ACTIVE_SUBSCRIPTION: {
    title: 'No active subscription',
    message: 'You need an active subscription to purchase credit packs. Please subscribe to a plan first.',
    severity: 'warning',
    retryable: false,
  },
  CANNOT_CANCEL_FREE: {
    title: 'Cannot cancel free plan',
    message: "The free plan doesn't require cancellation.",
    severity: 'info',
    retryable: false,
  },
  TX_NOT_FOUND: {
    title: 'Transaction not found',
    message: 'Your transaction could not be found on-chain. It may not have been submitted. Please try again.',
    severity: 'error',
    retryable: true,
  },
  TX_PENDING: {
    title: 'Transaction pending',
    message: 'Your payment is still being confirmed on the blockchain. Please wait a moment and try again.',
    severity: 'warning',
    retryable: true,
  },
  TX_REVERTED: {
    title: 'Transaction failed',
    message: 'Your transaction was reverted on-chain. This usually means insufficient balance or a contract error. Please check your wallet balance and try again.',
    severity: 'error',
    retryable: true,
  },
  SENDER_MISMATCH: {
    title: 'Wallet mismatch',
    message: 'The transaction was sent from a different wallet than the one registered to your account. Please use your connected Trading Wallet.',
    severity: 'error',
    retryable: false,
  },
  RECIPIENT_MISMATCH: {
    title: 'Payment routing error',
    message: 'The payment was sent to an incorrect address. Please try again - if the issue persists, contact support.',
    severity: 'error',
    retryable: true,
  },
  AMOUNT_MISMATCH: {
    title: 'Incorrect amount',
    message: 'The transaction amount does not match the expected price. This can happen if prices were updated. Please try again.',
    severity: 'error',
    retryable: true,
  },
  DUPLICATE_TX: {
    title: 'Duplicate transaction',
    message: 'This transaction has already been processed. If your plan or credits were not updated, please contact support.',
    severity: 'warning',
    retryable: false,
  },
  TRIAL_NOT_ELIGIBLE: {
    title: 'Trial not available',
    message: "You've previously had a paid plan, so free trials are no longer available. You can subscribe directly instead.",
    severity: 'info',
    retryable: false,
  },
  TRIAL_PLAN_NOT_ALLOWED: {
    title: 'Plan not eligible for trial',
    message: 'Free trials are only available for Starter and Pro plans.',
    severity: 'info',
    retryable: false,
  },
  INTERNAL_ERROR: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred on our end. Please try again in a few moments.',
    severity: 'error',
    retryable: true,
  },
};

// ---------------------------------------------------------------------------
// Wallet / Relay Error Patterns
// ---------------------------------------------------------------------------

/**
 * Known relay client error patterns and their user-friendly mappings.
 * These errors happen BEFORE the backend verification step.
 */
function matchWalletError(message: string): SubscriptionError | null {
  const lower = message.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('rejected by user')) {
    return {
      title: 'Transaction cancelled',
      message: 'You cancelled the transaction. No payment was made.',
      severity: 'info',
      retryable: true,
    };
  }

  if (lower.includes('failed onchain') || lower.includes('reverted')) {
    return {
      title: 'Transaction failed on-chain',
      message: 'Your transaction was submitted but failed on the blockchain. This usually means insufficient USD balance in your Trading Wallet. Please check your balance and try again.',
      severity: 'error',
      retryable: true,
    };
  }

  if (lower.includes('insufficient') || lower.includes('not enough') || lower.includes('exceeds balance')) {
    return {
      title: 'Insufficient balance',
      message: 'Your wallet does not have enough USD to complete this payment. Please add funds to your Trading Wallet.',
      severity: 'error',
      retryable: false,
    };
  }

  if (lower.includes('network') || lower.includes('timeout') || lower.includes('connection')) {
    return {
      title: 'Network error',
      message: 'Could not connect to the blockchain network. Please check your internet connection and try again.',
      severity: 'error',
      retryable: true,
    };
  }

  if (lower.includes('nonce') || lower.includes('replacement')) {
    return {
      title: 'Transaction conflict',
      message: 'A previous transaction is still pending. Please wait for it to complete and try again.',
      severity: 'warning',
      retryable: true,
    };
  }

  if (lower.includes('trading session not initialized') || lower.includes('connect your wallet')) {
    return {
      title: 'Wallet not connected',
      message: 'Your Trading Wallet is not connected. Please connect your wallet and try again.',
      severity: 'error',
      retryable: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Parses any error from the subscription/credit pack flow into a structured
 * user-friendly error object.
 */
export function parseSubscriptionError(error: unknown): SubscriptionError {
  // Pre-flight insufficient balance (caught before tx submission)
  if (error instanceof InsufficientBalanceError) {
    return {
      title: 'Insufficient balance',
      message: `You need $${error.required.toFixed(2)} USD but only have $${error.available.toFixed(2)} in your Trading Wallet. Please add funds and try again.`,
      severity: 'error',
      retryable: false,
    };
  }

  // Backend API errors with structured body
  if (error instanceof ApiError && error.body) {
    const body = error.body as { error?: string; message?: string; details?: Record<string, unknown> };
    const code = body.error;

    if (code && BACKEND_ERROR_MAP[code]) {
      return { ...BACKEND_ERROR_MAP[code], code };
    }

    // Fallback: use the backend message if available
    if (body.message) {
      return {
        title: 'Request failed',
        message: body.message,
        severity: 'error',
        retryable: error.status >= 500,
        code,
      };
    }
  }

  // ApiError without structured body (e.g. 500 with no JSON)
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return {
        title: 'Server error',
        message: 'Something went wrong on our end. Please try again in a moment.',
        severity: 'error',
        retryable: true,
      };
    }

    return {
      title: 'Request failed',
      message: `An error occurred (${error.status}). Please try again.`,
      severity: 'error',
      retryable: true,
    };
  }

  // Standard Error instances (wallet/relay errors)
  if (error instanceof Error) {
    const walletMatch = matchWalletError(error.message);
    if (walletMatch) {
      return walletMatch;
    }

    // Generic Error fallback
    return {
      title: 'Something went wrong',
      message: error.message || 'An unexpected error occurred. Please try again.',
      severity: 'error',
      retryable: true,
    };
  }

  // Non-Error objects with a message property (some relay libs throw these)
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message: unknown }).message);
    const walletMatch = matchWalletError(msg);
    if (walletMatch) {
      return walletMatch;
    }

    return {
      title: 'Something went wrong',
      message: msg || 'An unexpected error occurred. Please try again.',
      severity: 'error',
      retryable: true,
    };
  }

  // String errors
  if (typeof error === 'string') {
    const walletMatch = matchWalletError(error);
    if (walletMatch) {
      return walletMatch;
    }

    return {
      title: 'Something went wrong',
      message: error || 'An unexpected error occurred. Please try again.',
      severity: 'error',
      retryable: true,
    };
  }

  // Completely unknown error
  return {
    title: 'Unexpected error',
    message: 'An unknown error occurred. Please try again.',
    severity: 'error',
    retryable: true,
  };
}
