'use client';

import { useSyncExternalStore } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import {
  type Plan,
  type Interval,
  type Channel,
  PLAN_CAPABILITIES,
  planAtLeast,
} from '@/constants/plans';

export interface CurrentPlan {
  plan: Plan;
  isLoading: boolean;
  /** True when the user is at or above the required plan. */
  has(requiredPlan: Plan): boolean;
  /** Available recurring analysis intervals for this plan. */
  intervals: readonly Interval[];
  /** Available notification channels for this plan. */
  channels: readonly Channel[];
  /** PM concurrent session limit for this plan (0 if not entitled). */
  pmSessionLimit: number;
  /** Whether persona customization sliders are unlocked. */
  canCustomizePersona: boolean;
}

const VALID_PLANS: Plan[] = ['free', 'starter', 'pro', 'elite'];
const OVERRIDE_KEY = 'tw-tier-override';

/**
 * Reads the tier override from localStorage (dev-only).
 * Returns null in production or when no valid override is set.
 */
function getTierOverride(): Plan | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(OVERRIDE_KEY) as Plan | null;
  if (value && VALID_PLANS.includes(value)) return value;
  return null;
}

/** Subscribe to tier override changes dispatched by TierSwitcher. */
function subscribeTierOverride(callback: () => void): () => void {
  window.addEventListener('tw-tier-override-change', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('tw-tier-override-change', callback);
    window.removeEventListener('storage', callback);
  };
}

function getSnapshot(): Plan | null {
  return getTierOverride();
}

function getServerSnapshot(): Plan | null {
  return null;
}

export function useCurrentPlan(): CurrentPlan {
  const { data, isLoading } = useSubscription();

  const override = useSyncExternalStore(
    subscribeTierOverride,
    getSnapshot,
    getServerSnapshot,
  );

  const realPlan: Plan = data?.plan ?? 'free';
  const plan: Plan = override ?? realPlan;
  const capabilities = PLAN_CAPABILITIES[plan];

  return {
    plan,
    isLoading,
    has: (requiredPlan: Plan) => planAtLeast(plan, requiredPlan),
    intervals: capabilities.intervals,
    channels: capabilities.channels,
    pmSessionLimit: capabilities.pmSessionLimit,
    canCustomizePersona: capabilities.canCustomizePersona,
  };
}
