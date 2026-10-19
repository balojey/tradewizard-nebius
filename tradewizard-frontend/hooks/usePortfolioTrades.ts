'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';

export interface PortfolioTrade {
  id: string;
  sessionId: string;
  analysisResultId?: string;
  direction: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  orderType: 'limit' | 'market';
  size: number;
  price: number;
  fillPrice?: number;
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'failed';
  clobOrderId?: string;
  tradePurpose: 'entry' | 'exit' | 'stop_loss' | 'take_profit' | 'partial_exit' | 'emergency_exit';
  reasoning?: string;
  convictionScore?: number;
  createdAt: string;
  filledAt?: string;
  cancelledAt?: string;
  realizedPnl?: number;
  holdDurationMinutes?: number;
  exitReason?: string;
}

export interface PortfolioTradesResponse {
  items: PortfolioTrade[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function usePortfolioTrades(sessionId: string | null, page: number = 1) {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  // Invalidate trades query when a new trade is executed for this session
  useEffect(() => {
    if (!lastMessage || !sessionId) return;

    const data = lastMessage.payload as unknown as { type?: string; sessionId?: string };
    const type = (lastMessage as unknown as { type?: string }).type ?? data?.type;
    const eventSessionId = data?.sessionId;

    if (
      eventSessionId === sessionId &&
      (type === 'portfolio.trade.executed' || type === 'portfolio.position.exited')
    ) {
      queryClient.invalidateQueries({ queryKey: ['portfolio-trades', sessionId] });
    }
  }, [lastMessage, sessionId, queryClient]);

  return useQuery<PortfolioTradesResponse>({
    queryKey: ['portfolio-trades', sessionId, page],
    queryFn: () =>
      apiClient.get<PortfolioTradesResponse>(
        `/portfolio/sessions/${sessionId}/trades`,
        { page: String(page), pageSize: '20' }
      ),
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: 2,
  });
}
