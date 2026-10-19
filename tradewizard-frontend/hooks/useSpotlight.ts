'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

export interface SpotlightItem {
  analysisId: string;
  marketId: string;
  marketQuestion: string;
  recommendation: 'LONG_YES' | 'LONG_NO';
  consensusProbability: number;
  confidence: number;
  edge: number;
  marketProbability: number;
  executedAt: string;
}

interface SpotlightResponse {
  items: SpotlightItem[];
}

/**
 * Fetches the AI Spotlight - recent high-edge analyses across all users.
 * Shows markets where the AI found a significant edge in the last 24h.
 */
export function useSpotlight(limit = 5) {
  const { isAuthenticated } = useAuth();

  return useQuery<SpotlightResponse>({
    queryKey: ['analysis-spotlight', limit],
    queryFn: () =>
      apiClient.get<SpotlightResponse>('/analysis/spotlight', { limit: String(limit) }),
    staleTime: 5 * 60_000, // 5 minutes - spotlight doesn't change frequently
    retry: 2,
    refetchOnWindowFocus: false,
    enabled: isAuthenticated,
  });
}
