'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

export interface NotificationPreferences {
  channelInApp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  channelWebhook: boolean;
  webhookUrl: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  minProbabilityShift: number | null;
}

export function useNotificationPreferences() {
  const { isAuthenticated } = useAuth();

  return useQuery<NotificationPreferences>({
    queryKey: ['notificationPreferences'],
    queryFn: () => apiClient.get<NotificationPreferences>('/user/notifications'),
    staleTime: 60_000,
    retry: 2,
    enabled: isAuthenticated,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, Partial<NotificationPreferences>>({
    mutationFn: (preferences) =>
      apiClient.put<void>('/user/notifications', preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
    },
  });
}
