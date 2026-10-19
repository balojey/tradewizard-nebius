'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';

export interface PortfolioSession {
  id: string;
  userId: string;
  marketId: string;
  personaId: string;
  personaConfig: {
    id: string;
    name: string;
    riskLevel: 'conservative' | 'moderate' | 'aggressive';
    entryRules: {
      minEdge: number;
      minSignalAlignment: number;
      minConvictionScore: number;
      additionalCriteria?: Record<string, unknown>;
    };
    sizingRules: {
      minAllocationPct: number;
      maxAllocationPct: number;
      scalingFactor: number;
    };
    exitRules: {
      patienceWindowMinutes: number;
    };
    monitoringRules: {
      analysisIntervalMinutes: number;
      positionGuardIntervalMinutes: number;
    };
  };
  investmentAmount: number;
  status: 'active' | 'paused' | 'exiting' | 'completed' | 'terminated';
  currentPosition?: {
    direction: 'YES' | 'NO';
    size: number;
    entryPrice: number;
    entryTimestamp: string;
    stopLossOrderId?: string;
    takeProfitOrderId?: string;
  };
  stats: {
    totalTrades: number;
    winningTrades: number;
    realizedPnl: number;
    unrealizedPnl: number;
    avgHoldDurationMinutes: number;
  };
  capitalBreakdown: {
    investmentAmount: number;
    amountInPositions: number;
    amountInPendingOrders: number;
    amountAvailable: number;
    realizedPnl: number;
  };
  riskState: {
    cumulativeLossPct: number;
    lastLossExitAt: string | null;
    positionSizeReductionActive: boolean;
  };
  utilizationPct: number;
  schedules: {
    positionGuardScheduleArn?: string;
  };
  createdAt: string;
  updatedAt: string;
  terminatedAt?: string;
  terminationReason?: string;
}

export function usePortfolioSession(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  // Invalidate this session's query when relevant WebSocket events arrive
  useEffect(() => {
    if (!lastMessage || !sessionId) return;

    const data = lastMessage.payload as unknown as { type?: string; sessionId?: string };
    const type = (lastMessage as unknown as { type?: string }).type ?? data?.type;
    const eventSessionId = data?.sessionId;

    if (
      eventSessionId === sessionId &&
      (type === 'portfolio.session.updated' ||
        type === 'portfolio.trade.executed' ||
        type === 'portfolio.position.exited')
    ) {
      queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
    }

    // Kill switch affects all sessions
    if (type === 'portfolio.kill_switch.triggered') {
      queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
    }
  }, [lastMessage, sessionId, queryClient]);

  return useQuery<PortfolioSession>({
    queryKey: ['portfolio-session', sessionId],
    queryFn: () => apiClient.get<PortfolioSession>(`/portfolio/sessions/${sessionId}`),
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: 2,
  });
}
