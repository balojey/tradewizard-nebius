'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/hooks/useWebSocket';

export type PortfolioEventType =
  | 'portfolio.session.updated'
  | 'portfolio.trade.executed'
  | 'portfolio.position.exited'
  | 'portfolio.risk.alert'
  | 'portfolio.kill_switch.triggered';

export interface PortfolioWebSocketEvent {
  type: PortfolioEventType;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Subscribes to portfolio-related WebSocket events and invalidates
 * relevant TanStack Query caches when events arrive.
 *
 * Use this hook at the portfolio dashboard layout level to ensure
 * all portfolio queries stay fresh with real-time updates.
 */
export function usePortfolioWebSocket() {
  const queryClient = useQueryClient();
  const { lastMessage, isConnected } = useWebSocket();

  useEffect(() => {
    if (!lastMessage) return;

    const data = lastMessage.payload as unknown as { type?: string; sessionId?: string };
    const type = (lastMessage as unknown as { type?: string }).type ?? data?.type;
    const sessionId = data?.sessionId;

    // Only handle portfolio events
    if (!type || !type.startsWith('portfolio.')) return;

    switch (type) {
      case 'portfolio.session.updated':
        queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
        }
        break;

      case 'portfolio.trade.executed':
        queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
          queryClient.invalidateQueries({ queryKey: ['portfolio-trades', sessionId] });
        }
        break;

      case 'portfolio.position.exited':
        queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
          queryClient.invalidateQueries({ queryKey: ['portfolio-trades', sessionId] });
        }
        break;

      case 'portfolio.risk.alert':
        queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
        break;

      case 'portfolio.kill_switch.triggered':
        queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
        // Invalidate all individual session queries
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'portfolio-session' ||
            query.queryKey[0] === 'portfolio-trades',
        });
        break;

      default:
        // Handle session.paused, session.terminated, risk.loss_warning, daily_summary, etc.
        if (type.startsWith('portfolio.')) {
          queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
          queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
          if (sessionId) {
            queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
          }
        }
        break;
    }
  }, [lastMessage, queryClient]);

  return { isConnected };
}
