'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { cn } from '@/utils/classNames';

/**
 * CreditBadge - displays the user's real-time credit balance in the app nav.
 * Elite users see "∞ credits". Others see "X / N credits".
 * Flashes briefly when the balance changes to draw attention.
 * Styled with font-mono and accent tint using OKLch tokens.
 */
export function CreditBadge() {
  const { data: subscription, isLoading } = useSubscription();
  const { plan } = useCurrentPlan();
  const [flash, setFlash] = useState(false);
  const prevCredits = useRef<number | null>(null);

  // Flash animation when credits change
  useEffect(() => {
    if (subscription && prevCredits.current !== null && prevCredits.current !== subscription.creditsRemaining) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(timer);
    }
    if (subscription) {
      prevCredits.current = subscription.creditsRemaining;
    }
  }, [subscription?.creditsRemaining]);

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface-2/50 px-2.5 py-1.5 text-[0.68rem] font-medium font-mono text-muted animate-pulse"
      >
        <Coins className="w-3.5 h-3.5" aria-hidden="true" />
        <span>- credits</span>
      </div>
    );
  }

  if (!subscription) {
    return (
      <Link
        href="/account/subscription"
        className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface-2/50 px-2.5 py-1.5 text-[0.68rem] font-medium font-mono text-muted hover:border-accent/40 hover:text-fg"
      >
        <Coins className="w-3.5 h-3.5" aria-hidden="true" />
        <span>0 credits</span>
      </Link>
    );
  }

  const isElite = plan === 'elite';
  const isZero = !isElite && subscription.creditsRemaining === 0;
  const isLow =
    !isElite &&
    subscription.creditsRemaining <= 3 &&
    subscription.creditsRemaining > 0;

  return (
    <Link
      href="/account/subscription"
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-medium font-mono',
        'transition-all duration-150',
        isElite &&
          'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20',
        isZero &&
          'bg-no/10 border-no/30 text-no hover:bg-no/20',
        isLow &&
          'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20',
        !isElite &&
          !isZero &&
          !isLow &&
          'border-border/70 bg-surface-2/50 text-muted hover:border-accent/40 hover:text-fg',
        flash && 'scale-110 ring-2 ring-accent/50'
      )}
    >
      <Coins className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">
        {isElite
          ? '∞ credits'
          : `${subscription.creditsRemaining} / ${subscription.creditsMonthlyLimit} credits`}
      </span>
      <span className="sm:hidden">
        {isElite
          ? '∞'
          : `${subscription.creditsRemaining}`}
      </span>
    </Link>
  );
}
