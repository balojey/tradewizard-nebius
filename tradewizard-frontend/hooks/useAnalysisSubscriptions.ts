'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AnalysisSubscription {
  id: string;
  marketId: string;
  marketQuestion: string | null;
  requestType: string;
  intervalSeconds: number | null;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  nextScheduledRun: string | null;
}

interface SubscriptionsResponse {
  subscriptions: Array<{
    id: string;
    market_id: string;
    market_question: string | null;
    request_type: string;
    interval_seconds: number | null;
    status: string;
    created_at: string;
    cancelled_at: string | null;
    next_scheduled_run: string | null;
  }>;
}

// ─── Mapper ─────────────────────────────────────────────────────────────────────

function mapSubscription(raw: SubscriptionsResponse['subscriptions'][number]): AnalysisSubscription {
  return {
    id: raw.id,
    marketId: raw.market_id,
    marketQuestion: raw.market_question,
    requestType: raw.request_type,
    intervalSeconds: raw.interval_seconds,
    status: raw.status,
    createdAt: raw.created_at,
    cancelledAt: raw.cancelled_at,
    nextScheduledRun: raw.next_scheduled_run,
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the user's active recurring analysis subscriptions.
 * Returns subscriptions sorted by next_scheduled_run (soonest first).
 */
export function useAnalysisSubscriptions() {
  const { isAuthenticated } = useAuth();

  return useQuery<AnalysisSubscription[]>({
    queryKey: ['analysis-subscriptions'],
    queryFn: async () => {
      const response = await apiClient.get<SubscriptionsResponse>('/analysis/subscriptions');
      return response.subscriptions.map(mapSubscription);
    },
    enabled: isAuthenticated,
    staleTime: 30_000, // 30 seconds
    retry: 2,
  });
}

/**
 * Cancels a recurring analysis subscription.
 */
export function useCancelAnalysisSubscription() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (requestId: string) => {
      await apiClient.delete<unknown>(`/analysis/subscriptions/${requestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis-subscriptions'] });
    },
  });
}
