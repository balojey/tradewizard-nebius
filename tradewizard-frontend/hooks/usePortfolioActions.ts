'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface PauseSessionResponse {
  sessionId: string;
  status: 'paused';
}

interface ResumeSessionResponse {
  sessionId: string;
  status: 'active';
}

interface StopSessionResponse {
  sessionId: string;
  status: 'exiting' | 'terminated';
}

interface KillSwitchResponse {
  sessionsTerminated: number;
}

interface ResetKillSwitchResponse {
  message: string;
}

export function usePauseSession() {
  const queryClient = useQueryClient();

  return useMutation<PauseSessionResponse, Error, string>({
    mutationFn: (sessionId) =>
      apiClient.put<PauseSessionResponse>(`/portfolio/sessions/${sessionId}/pause`),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}

export function useResumeSession() {
  const queryClient = useQueryClient();

  return useMutation<ResumeSessionResponse, Error, string>({
    mutationFn: (sessionId) =>
      apiClient.put<ResumeSessionResponse>(`/portfolio/sessions/${sessionId}/resume`),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}

export function useStopSession() {
  const queryClient = useQueryClient();

  return useMutation<StopSessionResponse, Error, string>({
    mutationFn: (sessionId) =>
      apiClient.delete<StopSessionResponse>(`/portfolio/sessions/${sessionId}`),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}

export function useKillSwitch() {
  const queryClient = useQueryClient();

  return useMutation<KillSwitchResponse, Error, { reason?: string } | void>({
    mutationFn: (params) =>
      apiClient.post<KillSwitchResponse>('/portfolio/kill-switch', params ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}

export function useResetKillSwitch() {
  const queryClient = useQueryClient();

  return useMutation<ResetKillSwitchResponse, Error, void>({
    mutationFn: () => apiClient.delete<ResetKillSwitchResponse>('/portfolio/kill-switch'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}
