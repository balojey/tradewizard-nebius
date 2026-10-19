/**
 * Trade Error Utilities
 *
 * Maps CLOB order errors, wallet errors, and API errors to user-friendly messages
 * with actionable guidance for the outcome token trading flow.
 */

import {
  InsufficientCreditsError,
  PlanRestrictionError,
  NotFoundError,
} from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeErrorType =
  | 'insufficient_balance'
  | 'insufficient_credits'
  | 'plan_restriction'
  | 'not_found'
  | 'order_rejected'
  | 'no_liquidity'
  | 'price_moved'
  | 'session_not_ready'
  | 'wallet_not_connected'
  | 'geoblocked'
  | 'sl_tp_failed'
  | 'generic';

export interface TradeError {
  type: TradeErrorType;
  title: string;
  message: string;
  /** Actionable link to resolve the issue */
  action?: {
    label: string;
    href: string;
  };
  /** Whether the user can retry the same action */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

/**
 * Classifies a trade error into a structured object with user-friendly messaging.
 * Handles CLOB API errors, wallet/relay errors, and backend API errors.
 */
export function classifyTradeError(error: unknown): TradeError {
  // Typed API errors from the backend
  if (error instanceof InsufficientCreditsError) {
    return {
      type: 'insufficient_credits',
      title: 'Insufficient credits',
      message: "You don't have enough credits to complete this trade.",
      action: { label: 'Top up credits', href: '/account/subscription#packs' },
      retryable: false,
    };
  }

  if (error instanceof PlanRestrictionError) {
    return {
      type: 'plan_restriction',
      title: 'Plan restriction',
      message: "Your current plan doesn't support this action. Upgrade to unlock full trading.",
      action: { label: 'Upgrade plan', href: '/account/subscription' },
      retryable: false,
    };
  }

  if (error instanceof NotFoundError) {
    return {
      type: 'not_found',
      title: 'Market not found',
      message: 'This market or token could not be found. It may have been resolved or removed.',
      action: { label: 'Back to Markets', href: '/markets' },
      retryable: false,
    };
  }

  // Extract message from various error shapes
  const message = extractErrorMessage(error);
  const lower = message.toLowerCase();

  // Insufficient USD balance (on-chain revert or relay error)
  if (
    lower.includes('failed onchain') ||
    lower.includes('reverted') ||
    lower.includes('insufficient') ||
    lower.includes('exceeds balance') ||
    lower.includes('not enough')
  ) {
    return {
      type: 'insufficient_balance',
      title: 'Insufficient USD balance',
      message: "Your Trading Wallet doesn't have enough USD to cover this trade. Please deposit funds and try again.",
      retryable: false,
    };
  }

  // FOK rejection - no liquidity / order book too thin
  if (
    lower.includes('fill or kill') ||
    lower.includes('fok') ||
    lower.includes('no fill') ||
    lower.includes('not enough liquidity') ||
    lower.includes('unfilled') ||
    lower.includes('order could not be filled')
  ) {
    return {
      type: 'no_liquidity',
      title: 'Order could not be filled',
      message: "There isn't enough liquidity to fill your order at this price. Try a smaller amount or use a limit order.",
      retryable: true,
    };
  }

  // Price moved / stale price
  if (
    lower.includes('unable to get valid market price') ||
    lower.includes('price') && (lower.includes('invalid') || lower.includes('stale'))
  ) {
    return {
      type: 'price_moved',
      title: 'Price unavailable',
      message: 'Could not get a valid market price. The market may be temporarily illiquid. Please try again in a moment.',
      retryable: true,
    };
  }

  // CLOB client / trading session not ready
  if (lower.includes('clob client not initialized') || lower.includes('order submission failed')) {
    return {
      type: 'session_not_ready',
      title: 'Trading session error',
      message: 'Your trading session encountered an issue. Please refresh the page and try again.',
      retryable: true,
    };
  }

  // Wallet not connected
  if (lower.includes('wallet not connected') || lower.includes('connect your wallet')) {
    return {
      type: 'wallet_not_connected',
      title: 'Wallet not connected',
      message: 'Your wallet is not connected. Please connect your wallet to trade.',
      retryable: false,
    };
  }

  // Geoblocking
  if (lower.includes('geoblocked') || lower.includes('not available in your region')) {
    return {
      type: 'geoblocked',
      title: 'Trading unavailable',
      message: 'Trading is not available in your region due to regulatory restrictions.',
      retryable: false,
    };
  }

  // User rejection
  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('rejected by user')) {
    return {
      type: 'generic',
      title: 'Transaction cancelled',
      message: 'You cancelled the transaction. No order was placed.',
      retryable: true,
    };
  }

  // Network errors
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('fetch failed')) {
    return {
      type: 'generic',
      title: 'Network error',
      message: 'Could not reach the trading service. Please check your internet connection and try again.',
      retryable: true,
    };
  }

  // Generic fallback
  return {
    type: 'generic',
    title: 'Trade failed',
    message: message || 'Something went wrong while placing your order. Please try again.',
    retryable: true,
  };
}

/**
 * Creates a structured error for SL/TP order failures.
 * This is a special case - the buy order succeeded but SL/TP failed.
 */
export function createSlTpFailedError(failedType: 'stop-loss' | 'take-profit' | 'both'): TradeError {
  const label = failedType === 'both' ? 'stop-loss and take-profit' : failedType;
  return {
    type: 'sl_tp_failed',
    title: `${failedType === 'both' ? 'SL/TP' : failedType === 'stop-loss' ? 'Stop-loss' : 'Take-profit'} order failed`,
    message: `Your buy order was placed successfully, but the ${label} order could not be set. Please manually set your ${label} from the Positions tab.`,
    retryable: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  if (typeof error === 'string') return error;
  return '';
}
