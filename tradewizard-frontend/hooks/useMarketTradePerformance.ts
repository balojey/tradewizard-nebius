'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface TradeOutcome {
  analysisId: string;
  recommendation: 'LONG_YES' | 'LONG_NO';
  consensusProbability: number;
  marketProbability: number;
  edge: number;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLossPrice: number | null;
  outcomeStatus: 'success' | 'failure' | 'expired' | 'pending';
  outcomeHitPrice: number | null;
  outcomeResolvedAt: string | null;
  executedAt: string;
}

export interface MarketPerformanceSummary {
  totalRecommendations: number;
  resolved: number;
  successes: number;
  failures: number;
  expired: number;
  pending: number;
  winRate: number | null;
  avgEdgeCaptured: number | null;
}

interface MarketPerformanceResponse {
  marketId: string;
  summary: MarketPerformanceSummary;
  recommendations: TradeOutcome[];
}

/**
 * Fetches trade recommendation performance (TP/SL outcomes) for a specific market.
 * Shows win rate based on actual TP/SL hits, not just price direction.
 */
export function useMarketTradePerformance(marketId: string | null) {
  return useQuery<MarketPerformanceResponse>({
    queryKey: ['market-trade-performance', marketId],
    queryFn: () =>
      apiClient.get<MarketPerformanceResponse>('/analysis/market-performance', {
        marketId: marketId!,
      }),
    enabled: !!marketId,
    staleTime: 5 * 60_000, // 5 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });
}
