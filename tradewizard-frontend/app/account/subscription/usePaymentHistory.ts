'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentTransaction {
  id: string;
  transactionType: 'subscription_payment' | 'credit_pack_purchase' | 'renewal_payment' | 'proration_credit';
  amountUsdc: number;
  txHash: string;
  sourceAddress: string;
  createdAt: string;
}

interface PaymentHistoryPage {
  transactions: PaymentTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches paginated payment history from GET /payments/history.
 * Uses TanStack Query's useInfiniteQuery for cursor-based pagination.
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */
export function usePaymentHistory(pageSize = 20) {
  const { isAuthenticated } = useAuth();

  return useInfiniteQuery<PaymentHistoryPage>({
    queryKey: ['paymentHistory'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: String(pageSize) };
      if (pageParam) {
        params.cursor = pageParam as string;
      }
      return apiClient.get<PaymentHistoryPage>('/payments/history', params);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: isAuthenticated,
    staleTime: 30_000, // 30 seconds
  });
}
