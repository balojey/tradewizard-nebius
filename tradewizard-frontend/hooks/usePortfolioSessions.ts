'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuth } from '@/hooks/useAuth';

export interface PortfolioSessionSummary {
  id: string;
  marketId: string;
  personaId: string;
  personaName: string;
  investmentAmount: number;
  status: 'active' | 'paused' | 'exiting' | 'completed' | 'terminated';
  realizedPnl: number;
  unrealizedPnl: number;
  utilizationPct: number;
  amountInPositions: number;
  amountAvailable: number;
  totalTrades: number;
  createdAt: string;
  updatedAt: string;
}

interface PortfolioSessionsResponse {
  sessions: PortfolioSessionSummary[];
}

export function usePortfolioSessions() {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  // Invalidate sessions query when relevant WebSocket events arrive
  useEffect(() => {
    if (!lastMessage) return;

    const data = lastMessage.payload as unknown as { type?: string };
    const type = (lastMessage as unknown as { type?: string }).type ?? data?.type;

    if (
      type === 'portfolio.session.updated' ||
      type === 'portfolio.trade.executed' ||
      type === 'portfolio.position.exited' ||
      type === 'portfolio.kill_switch.triggered'
    ) {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
    }
  }, [lastMessage, queryClient]);

  const { isAuthenticated } = useAuth();

  return useQuery<PortfolioSessionsResponse>({
    queryKey: ['portfolio-sessions'],
    queryFn: () => apiClient.get<PortfolioSessionsResponse>('/portfolio/sessions'),
    staleTime: 30_000,
    retry: 2,
    enabled: isAuthenticated,
  });
}
