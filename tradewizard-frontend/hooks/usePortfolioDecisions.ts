'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';

export interface PortfolioDecision {
  id: string;
  sessionId: string;
  analysisResultId?: string;
  action: 'enter' | 'skip' | 'hold' | 'exit';
  entryEvaluation: {
    edgeMet: boolean;
    alignmentMet: boolean;
    convictionScore: number;
    additionalCriteriaMet: boolean;
  };
  positionStateAtDecision: {
    hasPosition: boolean;
    direction?: 'YES' | 'NO';
    unrealizedPnl?: number;
  };
  reasoning: string;
  skipReason?: string;
  createdAt: string;
}

export interface PortfolioDecisionsResponse {
  items: PortfolioDecision[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function usePortfolioDecisions(sessionId: string | null, page: number = 1) {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  // Invalidate decisions query when a new decision is made for this session
  useEffect(() => {
    if (!lastMessage || !sessionId) return;

    const data = lastMessage.payload as unknown as { type?: string; sessionId?: string };
    const type = (lastMessage as unknown as { type?: string }).type ?? data?.type;
    const eventSessionId = data?.sessionId;

    if (
      eventSessionId === sessionId &&
      (type === 'portfolio.trade.executed' || type === 'portfolio.session.updated')
    ) {
      queryClient.invalidateQueries({ queryKey: ['portfolio-decisions', sessionId] });
    }
  }, [lastMessage, sessionId, queryClient]);

  return useQuery<PortfolioDecisionsResponse>({
    queryKey: ['portfolio-decisions', sessionId, page],
    queryFn: () =>
      apiClient.get<PortfolioDecisionsResponse>(
        `/portfolio/sessions/${sessionId}/decisions`,
        { page: String(page), pageSize: '20' }
      ),
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: 2,
  });
}
