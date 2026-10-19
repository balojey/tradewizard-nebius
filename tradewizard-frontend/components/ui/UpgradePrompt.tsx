'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/classNames';
import { duration, ease } from '@/utils/motion';

export interface UpgradePromptProps {
  variant: 'free-to-starter' | 'starter-to-pro' | 'pro-to-elite';
  message: ReactNode;
  ctaHref?: string;
  dismissible?: boolean;
}

const variantStyles: Record<UpgradePromptProps['variant'], string> = {
  'free-to-starter':
    'border-accent/30 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent',
  'starter-to-pro':
    'border-ai/30 bg-gradient-to-r from-ai/10 via-ai/5 to-transparent',
  'pro-to-elite':
    'border-warning/30 bg-gradient-to-r from-warning/10 via-warning/5 to-transparent',
};

const textStyles: Record<UpgradePromptProps['variant'], string> = {
  'free-to-starter': 'text-accent',
  'starter-to-pro': 'text-ai',
  'pro-to-elite': 'text-warning',
};

const ctaLabels: Record<UpgradePromptProps['variant'], string> = {
  'free-to-starter': 'Upgrade to Starter',
  'starter-to-pro': 'Upgrade to Pro',
  'pro-to-elite': 'Upgrade to Elite',
};

const ctaStyles: Record<UpgradePromptProps['variant'], string> = {
  'free-to-starter':
    'bg-accent hover:bg-accent/90 text-white shadow-sm shadow-accent/25',
  'starter-to-pro':
    'bg-ai hover:bg-ai/90 text-white shadow-sm shadow-ai/25',
  'pro-to-elite':
    'bg-warning hover:bg-warning/90 text-white shadow-sm shadow-warning/25',
};

/** Variant-specific icon - gives instant visual identity to each upgrade tier. */
function VariantIcon({ variant }: { variant: UpgradePromptProps['variant'] }) {
  const iconClass = cn('h-4 w-4 shrink-0 sm:h-5 sm:w-5', textStyles[variant]);

  switch (variant) {
    case 'free-to-starter':
      // Rocket
      return (
        <svg
          className={iconClass}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
          />
        </svg>
      );
    case 'starter-to-pro':
      // Sparkles
      return (
        <svg
          className={iconClass}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
          />
        </svg>
      );
    case 'pro-to-elite':
      // Crown / trophy
      return (
        <svg
          className={iconClass}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-4.5A3.375 3.375 0 0 0 13.125 10.875h-2.25A3.375 3.375 0 0 0 7.5 14.25v4.5m6-12V3.375c0-.621-.504-1.125-1.125-1.125h-.75A1.125 1.125 0 0 0 10.5 3.375V6.75m3 0h-3m3 0a2.25 2.25 0 0 1 2.25 2.25M10.5 6.75a2.25 2.25 0 0 0-2.25 2.25"
          />
        </svg>
      );
  }
}

/**
 * Upgrade prompt banner - displayed across pages to nudge users to higher plans.
 *
 * Responsive behavior:
 * - **Mobile (<480px)**: Stacks vertically, full-width CTA, compact text
 * - **Small (480–639px)**: Two-row layout, icon + text on top, centered CTA below
 * - **Tablet+ (≥640px)**: Single row, icon + text on left, CTA button on right
 *
 * Visual polish:
 * - Gradient background with variant-specific color
 * - Tier-specific icon for instant recognition
 * - Subtle entrance animation (respects prefers-reduced-motion via CSS)
 * - Optional dismiss button (persists per-session via local state)
 */
export function UpgradePrompt({
  variant,
  message,
  ctaHref = '/account/subscription',
  dismissible = false,
}: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
          transition={{ duration: duration.base, ease: [...ease.standard] }}
          className={cn(
            'relative overflow-hidden rounded-[12px] border',
            variantStyles[variant]
          )}
          role="banner"
          aria-label={`Upgrade to ${variant.split('-').pop()} plan`}
        >
          {/* Content wrapper */}
          <div
            className={cn(
              'flex flex-col gap-3 px-4 py-3',
              'xs:flex-row xs:items-center xs:gap-3',
              'sm:gap-4 sm:py-3.5'
            )}
          >
            {/* Icon + Message */}
            <div className="flex items-start gap-2.5 xs:items-center xs:flex-1 min-w-0">
              <VariantIcon variant={variant} />
              <p
                className={cn(
                  'text-xs leading-relaxed font-medium min-w-0',
                  'xs:text-xs',
                  'sm:text-sm sm:leading-snug',
                  textStyles[variant]
                )}
              >
                {message}
              </p>
            </div>

            {/* CTA Button */}
            <Link
              href={ctaHref}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 shrink-0',
                'rounded-lg px-4 py-2.5 text-xs font-semibold',
                'transition-all active:scale-[0.97]',
                'xs:py-2 xs:px-3.5 xs:rounded-md',
                'sm:py-1.5 sm:px-4 sm:text-xs',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                ctaStyles[variant]
              )}
            >
              {ctaLabels[variant]}
              {/* Arrow icon */}
              <svg
                className="h-3 w-3"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
          </div>

          {/* Dismiss button */}
          {dismissible && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className={cn(
                'absolute top-2 right-2 rounded-full p-1 transition-colors',
                'hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                textStyles[variant]
              )}
              aria-label="Dismiss upgrade prompt"
            >
              <svg
                className="h-3.5 w-3.5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
