'use client';

import { type ReactNode } from 'react';
import { type Plan } from '@/constants/plans';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { LockOverlay } from './LockOverlay';

export interface TierGateProps {
  /** Minimum plan required to unlock this region. */
  plan: Plan;
  /** Human-readable label for the gated feature. */
  feature: string;
  /** When true, render children behind a lock overlay; when false, hide entirely. */
  showLocked?: boolean;
  /** Link target for the upgrade CTA. */
  upgradeHref?: string;
  children: ReactNode;
}

/**
 * Conditionally renders or locks a region based on the user's plan.
 *
 * Resolution:
 *   1. If current plan satisfies `plan` → render children
 *   2. Else if showLocked → render children inside relative wrapper with LockOverlay
 *   3. Else → render nothing
 */
export function TierGate({
  plan,
  feature,
  showLocked = true,
  upgradeHref = '/account/subscription',
  children,
}: TierGateProps) {
  const { has, isLoading } = useCurrentPlan();

  // While loading subscription data, render children without gating
  // to avoid layout shift. Backend enforces the real gate.
  if (isLoading) {
    return <>{children}</>;
  }

  // 1. User's plan satisfies the requirement - render normally
  if (has(plan)) {
    return <>{children}</>;
  }

  // 2. Show locked overlay over the content
  if (showLocked) {
    return (
      <div className="relative overflow-hidden rounded-[12px]">
        <div className="pointer-events-none select-none opacity-40" aria-hidden="true">
          {children}
        </div>
        <LockOverlay feature={feature} upgradeHref={upgradeHref} />
      </div>
    );
  }

  // 3. Hide entirely
  return null;
}
