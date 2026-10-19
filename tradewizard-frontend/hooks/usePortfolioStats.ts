'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuth } from '@/hooks/useAuth';

export interface PortfolioStats {
  totalInvested: number;
  totalCommittedCapital: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  activeSessionCount: number;
}

export function usePortfolioStats() {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();
  const { isAuthenticated } = useAuth();

  // Invalidate stats when any portfolio event arrives
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
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    }
  }, [lastMessage, queryClient]);

  return useQuery<PortfolioStats>({
    queryKey: ['portfolio-stats'],
    queryFn: () => apiClient.get<PortfolioStats>('/portfolio/stats'),
    staleTime: 30_000,
    retry: 2,
    enabled: isAuthenticated,
  });
}
