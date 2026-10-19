'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api-client';
import { useSubscription } from '@/hooks/useSubscription';
import { usePortfolioSessions } from '@/hooks/usePortfolioSessions';

// --- Types ---

/**
 * Request body for POST /portfolio/sessions.
 * Requirements: 1.1, 1.2
 */
export interface ActivatePortfolioRequest {
  marketId: string;
  investmentAmount: number;
  profitTargetPct?: number;
}

/**
 * Response from POST /portfolio/sessions.
 * Requirements: 1.7
 */
export interface ActivatePortfolioResponse {
  sessionId: string;
  status: 'active';
}

/**
 * Preflight check result indicating whether activation can proceed.
 * Requirements: 1.2, 1.5, 1.8
 */
export interface PreflightCheckResult {
  canActivate: boolean;
  reason?: string;
}

/** Session limits per subscription plan */
const SESSION_LIMITS: Record<string, number> = {
  pro: 3,
  elite: 10,
};

// --- Activation Mutation Hook ---

/**
 * Mutation hook to activate a portfolio manager session on a market.
 *
 * Calls POST /portfolio/sessions with marketId and investmentAmount.
 * On success, invalidates the portfolio sessions query cache.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.8
 */
export function usePortfolioActivation() {
  const queryClient = useQueryClient();

  return useMutation<ActivatePortfolioResponse, ApiError, ActivatePortfolioRequest>({
    mutationFn: (request) =>
      apiClient.post<ActivatePortfolioResponse>('/portfolio/sessions', request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
    },
  });
}

// --- Preflight Check Hook ---

/**
 * Hook that performs pre-flight validation before portfolio activation.
 *
 * Checks:
 * 1. User has Pro or Elite subscription (Requirement 1.2)
 * 2. Active session count is within plan limit (Requirement 1.5)
 * 3. Recurring analysis exists for the target market (Requirement 1.8)
 *
 * Returns { canActivate, reason } indicating whether activation can proceed.
 */
export function usePortfolioPreflightCheck(marketId: string | null) {
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription();
  const { data: sessionsData, isLoading: isSessionsLoading } = usePortfolioSessions();

  // Check if recurring analysis exists for this market
  const { data: recurringAnalysis, isLoading: isRecurringLoading } = useQuery<{
    exists: boolean;
  }>({
    queryKey: ['recurring-analysis-check', marketId],
    queryFn: () =>
      apiClient.get<{ exists: boolean }>('/portfolio/preflight/recurring-analysis', {
        marketId: marketId!,
      }),
    enabled: !!marketId,
    staleTime: 30_000,
    retry: 1,
  });

  const isLoading = isSubscriptionLoading || isSessionsLoading || isRecurringLoading;

  if (isLoading || !marketId) {
    return { canActivate: false, reason: undefined, isLoading };
  }

  // Check 1: Subscription tier (Requirement 1.2)
  const plan = subscription?.plan;
  if (!plan || (plan !== 'pro' && plan !== 'elite')) {
    return {
      canActivate: false,
      reason: 'Portfolio Manager requires a Pro or Elite subscription.',
      isLoading: false,
    };
  }

  // Check 2: Session count vs limit (Requirement 1.5)
  const activeSessions = sessionsData?.sessions?.filter(
    (s) => s.status === 'active' || s.status === 'paused' || s.status === 'exiting'
  ) ?? [];
  const sessionLimit = SESSION_LIMITS[plan] ?? 0;

  if (activeSessions.length >= sessionLimit) {
    return {
      canActivate: false,
      reason: `You have reached the maximum of ${sessionLimit} active sessions for your ${plan} plan.`,
      isLoading: false,
    };
  }

  // Check 3: Recurring analysis exists (Requirement 1.8)
  if (!recurringAnalysis?.exists) {
    return {
      canActivate: false,
      reason:
        'An active recurring analysis subscription is required on this market. Please set up recurring analysis first.',
      isLoading: false,
    };
  }

  return { canActivate: true, reason: undefined, isLoading: false };
}
