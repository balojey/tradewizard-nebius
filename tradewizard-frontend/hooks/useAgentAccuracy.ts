'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

export interface AgentAccuracyItem {
  name: string;
  accuracy: number;
  totalSignals: number;
  correctSignals: number;
  avgConfidence: number;
  lastUpdatedAt: string;
}

interface AgentAccuracyResponse {
  agents: AgentAccuracyItem[];
  marketId?: string | null;
}

/**
 * Fetches the agent accuracy leaderboard.
 * When marketId is provided, scopes accuracy to that specific market.
 * Otherwise returns global 30-day accuracy across all markets.
 */
export function useAgentAccuracy(marketId?: string | null) {
  const { isAuthenticated } = useAuth();
  const params: Record<string, string> = {};
  if (marketId) params.marketId = marketId;

  return useQuery<AgentAccuracyResponse>({
    queryKey: ['agent-accuracy', marketId ?? 'global'],
    queryFn: () => apiClient.get<AgentAccuracyResponse>('/analysis/agent-accuracy', params),
    staleTime: 10 * 60_000, // 10 minutes - accuracy doesn't change rapidly
    retry: 2,
    refetchOnWindowFocus: false,
    enabled: isAuthenticated,
  });
}
