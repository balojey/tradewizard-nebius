'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';

export interface MarketAnalysisResult {
  analysisId: string;
  marketId: string;
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  expectedValue: number;
  winProbability: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  explanation: {
    summary: string;
    coreThesis: string;
    keyCatalysts: string[];
    failureScenarios: string[];
    uncertaintyNote: string;
    riskPerspectives: string;
  };
  metadata: {
    consensusProbability: number;
    marketProbability: number;
    edge: number;
    confidenceBand: [number, number];
    totalLlmCalls: number;
    executionDurationMs: number;
    agentsUsed: string[];
    marketQuestion?: string;
    disagreementIndex?: number;
  };
  executedAt?: string;
  // Full analysis detail (merged from S3 detail file by results-api)
  agentSignals?: Array<{
    agentName: string;
    direction: string;
    confidence: number;
    fairProbability: number;
    keyDrivers: string[];
    riskFactors: string[];
    timestamp?: string;
  }>;
  fusedSignal?: {
    weightedFairProbability: number;
    fusionConfidence: number;
    signalAlignment: number;
    conflictMap: Array<Record<string, string | number>>;
  };
  bullThesis?: { direction: string; fairProbability: number; keyArguments: string[]; confidence: number };
  bearThesis?: { direction: string; fairProbability: number; keyArguments: string[]; confidence: number };
  crossExamination?: { bullScore: number; bearScore: number };
  consensus?: { probability: number; confidence: number; failed: boolean; disagreementIndex: number };
  webResearchSummary?: string;
  /** Raw risk perspectives output from the 3 risk philosophy agents (with [aggressive]/[conservative]/[neutral] labels and JSON) */
  riskPerspectivesRaw?: string;
}

/**
 * Hook to fetch the latest V2 analysis result for a market.
 * Also listens for WebSocket updates to refresh when new results arrive.
 */
export function useMarketAnalysis(marketId: string | null) {
  const { isAuthenticated } = useAuth();
  const { lastMessage } = useWebSocket();
  const queryClient = useQueryClient();

  // Invalidate when a new analysis_complete arrives for this market
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'analysis_complete') return;
    if (lastMessage.payload.marketId === marketId) {
      queryClient.invalidateQueries({ queryKey: ['market-analysis', marketId] });
    }
  }, [lastMessage, marketId, queryClient]);

  return useQuery<MarketAnalysisResult | null>({
    queryKey: ['market-analysis', marketId],
    queryFn: async () => {
      if (!marketId) return null;
      try {
        // Fetch the latest analysis delivery for this market
        const response = await apiClient.get<{
          items: Array<{
            analysisId: string;
            marketId: string;
            recommendation: string;
            consensusProbability: number;
            confidence: number;
            executedAt: string;
          }>;
          nextCursor: string | null;
          totalCount: number;
        }>('/analysis/history', { marketId, limit: '1' });

        if (!response.items || response.items.length === 0) return null;

        const latest = response.items[0];

        // Fetch full result from S3 via the detail endpoint
        try {
          const detail = await apiClient.get<MarketAnalysisResult>(
            `/analysis/${latest.analysisId}`
          );
          return { ...detail, analysisId: latest.analysisId, executedAt: latest.executedAt };
        } catch {
          // Detail fetch failed - return summary data
          return {
            analysisId: latest.analysisId,
            marketId: marketId,
            action: latest.recommendation as 'LONG_YES' | 'LONG_NO' | 'NO_TRADE',
            entryZone: [0, 0],
            targetZone: [0, 0],
            stopLoss: 0,
            expectedValue: 0,
            winProbability: latest.consensusProbability,
            liquidityRisk: 'medium' as const,
            explanation: {
              summary: '',
              coreThesis: '',
              keyCatalysts: [],
              failureScenarios: [],
              uncertaintyNote: '',
              riskPerspectives: '',
            },
            metadata: {
              consensusProbability: latest.consensusProbability,
              marketProbability: 0,
              edge: 0,
              confidenceBand: [0, 0],
              totalLlmCalls: 0,
              executionDurationMs: 0,
              agentsUsed: [],
            },
            executedAt: latest.executedAt,
          };
        }
      } catch {
        return null;
      }
    },
    enabled: isAuthenticated && !!marketId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}
