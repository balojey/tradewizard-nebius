'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

export interface SubscriptionData {
  plan: 'free' | 'starter' | 'pro' | 'elite';
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
  creditsRemaining: number;
  creditsMonthlyLimit: number;
  billingCycleEnd: string;
  stripeSubscriptionId: string | null;
}

interface CheckoutResponse {
  checkoutUrl: string;
}

export function useSubscription() {
  const { isAuthenticated } = useAuth();

  return useQuery<SubscriptionData>({
    queryKey: ['subscription'],
    queryFn: () => apiClient.get<SubscriptionData>('/subscriptions'),
    staleTime: 60_000, // 1 minute
    retry: 2,
    enabled: isAuthenticated,
  });
}

export function useChangePlan() {
  return useMutation<CheckoutResponse, Error, string>({
    mutationFn: (planId: string) =>
      apiClient.post<CheckoutResponse>('/subscriptions', { planId }),
  });
}

export function usePurchaseCredits() {
  return useMutation<CheckoutResponse, Error, string>({
    mutationFn: (packId: string) =>
      apiClient.post<CheckoutResponse>('/credits/purchase', { packId }),
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (subscriptionId: string) =>
      apiClient.delete<void>(`/subscriptions/${subscriptionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

export function useOptimisticCreditDecrement() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.setQueryData<SubscriptionData>(['subscription'], (old) => {
      if (!old) return old;
      return {
        ...old,
        creditsRemaining: Math.max(0, old.creditsRemaining - 1),
      };
    });
  };
}
