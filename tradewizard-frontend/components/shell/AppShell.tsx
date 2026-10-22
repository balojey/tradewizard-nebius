'use client';

import { type ReactNode } from 'react';
import { AppNav } from '@/components/shell/AppNav';

export interface AppShellProps {
  children: ReactNode;
  /** Optional banner slot rendered above the nav (e.g. Beta, Geoblock). */
  banner?: ReactNode;
}

/**
 * Product app shell that wraps every authenticated page.
 * Composes AppNav + main content area + optional banner slot.
 */
export function AppShell({ children, banner }: AppShellProps) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:border focus:border-accent focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-[var(--shadow-md)]"
      >
        Skip to content
      </a>
      {banner}
      <AppNav />
      <main
        id="main-content"
        tabIndex={-1}
        className="w-full max-w-full px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] sm:px-6 md:pb-6"
      >
        {children}
      </main>
    </div>
  );
}
