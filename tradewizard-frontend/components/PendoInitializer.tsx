'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWalletSubscription } from '@/hooks/useWalletSubscription';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';

export function PendoInitializer() {
  const initialized = useRef(false);
  const { user, isAuthenticated } = useAuth();
  const { data: subscription } = useWalletSubscription();
  const { data: notifications } = useNotificationPreferences();
  const { data: persona } = usePersonaSettings();

  useEffect(() => {
    if (!initialized.current) {
      pendo.initialize({ visitor: { id: '' } });
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    pendo.identify({
      visitor: {
        id: user.sub,
        email: user.email,
        plan: subscription?.plan,
        subscriptionStatus: subscription?.status,
        creditsRemaining: subscription?.creditsRemaining,
        creditsMonthlyLimit: subscription?.creditsMonthlyLimit,
        billingCycleEnd: subscription?.billingCycleEnd ?? undefined,
        isTrial: subscription?.isTrial,
        trialEnd: subscription?.trialEnd ?? undefined,
        trialEligible: subscription?.trialEligible,
        walletAddress: subscription?.walletAddress,
        allowanceStatus: subscription?.allowanceStatus,
        personaId: persona?.personaId,
        channelEmail: notifications?.channelEmail,
        channelPush: notifications?.channelPush,
        channelWebhook: notifications?.channelWebhook,
      },
    });
  }, [isAuthenticated, user, subscription, notifications, persona]);

  return null;
}
