'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { AnalysisResultSummary } from '@/hooks/useAnalysisResults';

interface MarketAnalysisHistoryPage {
  items: AnalysisResultSummary[];
  nextCursor: string | null;
  totalCount: number;
}

/**
 * Fetches paginated analysis history filtered by a specific market.
 * Uses the `?marketId=X` query param supported by `GET /analysis/history`.
 */
export function useMarketAnalysisHistory(marketId: string | null, limit = 10) {
  return useInfiniteQuery<MarketAnalysisHistoryPage>({
    queryKey: ['market-analysis-history', marketId, limit],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = {
        limit: String(limit),
        marketId: marketId!,
      };
      if (pageParam) {
        params.cursor = pageParam as string;
      }
      return apiClient.get<MarketAnalysisHistoryPage>('/analysis/history', params);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!marketId,
    staleTime: 30_000,
    retry: 2,
  });
}
