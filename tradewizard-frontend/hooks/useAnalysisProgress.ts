'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { useAuth } from './useAuth';
import { apiClient } from '@/lib/api-client';

export interface AnalysisProgress {
  analysisId: string;
  marketId?: string;
  stage: number;
  totalStages: number;
  stageName: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  timestamp: string;
}

interface UseAnalysisProgressOptions {
  analysisId?: string | null;
  marketId?: string | null;
}

interface AnalysisStatusResponse {
  status: 'none' | 'queued' | 'in_progress';
  requestId?: string;
  marketId?: string;
  message?: string;
}

/**
 * Hook that tracks real-time progress of an in-flight analysis request.
 *
 * On mount, queries GET /analysis/status?marketId=X to check if the user has
 * a pending request for this market. This ensures progress survives page reloads.
 * The endpoint only returns status if the current user has an active pending
 * request - it won't leak progress from other users' analyses.
 *
 * After mount, listens for WebSocket `analysis_progress` and `analysis_complete`
 * messages to update in real-time.
 *
 * When called with `marketId: null`, tracks a single analysis (the most recent
 * progress message). For multi-analysis tracking, use `useAllAnalysisProgress`.
 */
export function useAnalysisProgress(
  analysisIdOrOptions?: string | null | UseAnalysisProgressOptions
) {
  const { lastMessage } = useWebSocket();
  const { isAuthenticated } = useAuth();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  // Normalize options
  const options: UseAnalysisProgressOptions = typeof analysisIdOrOptions === 'object' && analysisIdOrOptions !== null
    ? analysisIdOrOptions
    : { analysisId: analysisIdOrOptions };

  const { analysisId, marketId } = options;

  // ─── Seed initial state from backend on mount ───────────────────────────────
  useEffect(() => {
    if (!marketId || !isAuthenticated) return;

    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await apiClient.get<AnalysisStatusResponse>(
          '/analysis/status',
          { marketId: marketId! }
        );

        if (cancelled) return;

        if (res.status === 'in_progress' || res.status === 'queued') {
          // Seed progress state so the UI shows the banner immediately
          setProgress({
            analysisId: res.requestId ?? '',
            marketId: res.marketId ?? marketId!,
            stage: res.status === 'queued' ? 0 : 1,
            totalStages: 11,
            stageName: res.status === 'queued' ? 'Queued' : 'In progress',
            status: 'running',
            progress: res.status === 'queued' ? 0 : 5,
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Non-critical - if the status check fails, we just won't show
        // the banner until a WebSocket message arrives
      }
    }

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [marketId, isAuthenticated]);

  // ─── Real-time WebSocket progress updates ───────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type !== 'analysis_progress') return;

    const payload = lastMessage.payload;
    if (!payload.analysisId || !payload.stageName) return;

    // Match by analysisId if provided
    if (analysisId && payload.analysisId !== analysisId) return;

    // Match by marketId if provided (cross-device support)
    if (marketId && !analysisId && payload.marketId !== marketId) return;

    setProgress({
      analysisId: payload.analysisId,
      marketId: payload.marketId,
      stage: payload.stage ?? 0,
      totalStages: payload.totalStages ?? 11,
      stageName: payload.stageName ?? '',
      status: payload.status ?? 'running',
      progress: payload.progress ?? 0,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }, [lastMessage, analysisId, marketId]);

  // ─── Clear progress when analysis completes ─────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'analysis_complete') {
      const matchesAnalysis = !analysisId || lastMessage.payload.analysisId === analysisId;
      const matchesMarket = !marketId || lastMessage.payload.marketId === marketId;
      if (matchesAnalysis || matchesMarket) {
        setProgress(null);
      }
    }
  }, [lastMessage, analysisId, marketId]);

  return progress;
}

// ─── Multi-Analysis Progress Hook ─────────────────────────────────────────────

/**
 * Hook that tracks real-time progress of ALL in-flight analyses simultaneously.
 *
 * Returns a Map keyed by analysisId (or marketId as fallback) containing
 * progress for every running analysis. Entries are automatically removed
 * when an `analysis_complete` or `analysis_failed` message arrives.
 *
 * Use this on the Insights page to display multiple running analysis cards.
 */
export function useAllAnalysisProgress(): AnalysisProgress[] {
  const { lastMessage } = useWebSocket();
  const progressMapRef = useRef<Map<string, AnalysisProgress>>(new Map());
  const [progressList, setProgressList] = useState<AnalysisProgress[]>([]);

  const syncState = useCallback(() => {
    setProgressList(Array.from(progressMapRef.current.values()));
  }, []);

  // ─── Handle progress updates ──────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'analysis_progress') {
      const payload = lastMessage.payload;
      if (!payload.analysisId || !payload.stageName) return;

      const key = payload.analysisId || payload.marketId || '';
      if (!key) return;

      const entry: AnalysisProgress = {
        analysisId: payload.analysisId!,
        marketId: payload.marketId,
        stage: payload.stage ?? 0,
        totalStages: payload.totalStages ?? 11,
        stageName: payload.stageName ?? '',
        status: payload.status ?? 'running',
        progress: payload.progress ?? 0,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      progressMapRef.current.set(key, entry);
      syncState();
    }

    // ─── Remove on completion or failure ──────────────────────────────────────
    if (lastMessage.type === 'analysis_complete' || lastMessage.type === 'analysis_failed') {
      const payload = lastMessage.payload;
      const analysisId = payload.analysisId;
      const marketId = payload.marketId;

      let removed = false;

      // Try removing by analysisId first
      if (analysisId && progressMapRef.current.has(analysisId)) {
        progressMapRef.current.delete(analysisId);
        removed = true;
      }

      // Also check if any entry matches this marketId (belt and suspenders)
      if (marketId) {
        for (const [key, entry] of progressMapRef.current) {
          if (entry.marketId === marketId) {
            progressMapRef.current.delete(key);
            removed = true;
          }
        }
      }

      if (removed) {
        syncState();
      }
    }
  }, [lastMessage, syncState]);

  return progressList;
}
