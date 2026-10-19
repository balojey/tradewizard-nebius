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
      {banner}
      <AppNav />
      <main className="w-full max-w-full px-4 sm:px-6 py-6 pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)]">
        {children}
      </main>
    </div>
  );
}
