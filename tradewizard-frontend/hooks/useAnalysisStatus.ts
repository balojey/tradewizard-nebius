'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAnalysisProgress, type AnalysisProgress } from '@/hooks/useAnalysisProgress';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type AnalysisStatusState = 'none' | 'queued' | 'in_progress' | 'completed' | 'failed';

interface ServerStatus {
  status: 'none' | 'queued' | 'in_progress';
  requestId?: string;
  marketId?: string;
  message?: string;
}

export interface AnalysisStatus {
  /** Overall state of the analysis for this market (from the user's perspective). */
  state: AnalysisStatusState;
  /** Real-time progress data from WebSocket (null if not yet receiving updates). */
  progress: AnalysisProgress | null;
  /** The request ID if an analysis is pending/in-progress. */
  requestId: string | null;
  /** Whether the status is still loading from the server. */
  isLoading: boolean;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Server-driven analysis status hook.
 *
 * Polls GET /analysis/status?marketId=X to determine if the current user has
 * a pending analysis for this market. Combines with WebSocket progress events
 * for real-time stage updates.
 *
 * This works across devices because the status is backed by RDS (analysis_requests
 * + analysis_deliveries tables), not localStorage. Any device with the same
 * authenticated user will see the same status.
 *
 * The hook:
 * - Returns 'none' if the user has no pending request (nothing to show)
 * - Returns 'queued' if the user has a pending request but execution hasn't started
 * - Returns 'in_progress' with real-time progress from WebSocket
 * - Returns 'completed' briefly when analysis_complete arrives, then transitions to 'none'
 * - Returns 'failed' briefly when analysis fails, then transitions to 'none'
 * - Refetches every 15s while in queued/in_progress state (in case WS disconnects)
 * - Invalidates on analysis_complete WebSocket message
 */
export function useAnalysisStatus(marketId: string | null): AnalysisStatus {
  const { isAuthenticated } = useAuth();
  const { lastMessage } = useWebSocket();
  const queryClient = useQueryClient();

  // Real-time progress from WebSocket
  const progress = useAnalysisProgress({ marketId });

  // Server-side status query
  const { data: serverStatus, isLoading } = useQuery<ServerStatus>({
    queryKey: ['analysis-status', marketId],
    queryFn: async () => {
      if (!marketId) return { status: 'none' as const };
      return apiClient.get<ServerStatus>('/analysis/status', { marketId });
    },
    enabled: isAuthenticated && !!marketId,
    staleTime: 10_000, // 10 seconds
    refetchInterval: (query) => {
      // Poll every 15s while queued or in_progress; stop when none
      const status = query.state.data?.status;
      if (status === 'queued' || status === 'in_progress') return 15_000;
      return false;
    },
    retry: 1,
  });

  // Invalidate status query when analysis_complete arrives for this market
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'analysis_complete' && lastMessage.payload?.marketId === marketId) {
      // Small delay to let the backend update the delivery record
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['analysis-status', marketId] });
        queryClient.invalidateQueries({ queryKey: ['market-analysis', marketId] });
      }, 1000);
    }
  }, [lastMessage, marketId, queryClient]);

  // Derive the combined state
  const serverState = serverStatus?.status ?? 'none';
  const requestId = serverStatus?.requestId ?? null;

  // If WebSocket says completed/failed, override server state temporarily
  if (progress?.status === 'completed') {
    return { state: 'completed', progress, requestId, isLoading: false };
  }
  if (progress?.status === 'failed') {
    return { state: 'failed', progress, requestId, isLoading: false };
  }

  // If we're getting real-time progress, we're in_progress regardless of server poll lag
  if (progress && progress.status === 'running') {
    return { state: 'in_progress', progress, requestId: requestId || progress.analysisId, isLoading: false };
  }

  // Otherwise, trust the server state
  if (serverState === 'in_progress') {
    return { state: 'in_progress', progress, requestId, isLoading: false };
  }
  if (serverState === 'queued') {
    return { state: 'queued', progress: null, requestId, isLoading: false };
  }

  return { state: 'none', progress: null, requestId: null, isLoading };
}
