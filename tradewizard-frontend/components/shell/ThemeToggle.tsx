'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/utils/classNames';

const STORAGE_KEY = 'tw-theme';

type Theme = 'dark' | 'light';

/**
 * ThemeToggle - toggles data-theme on <html> between 'dark' and 'light'.
 * Persists choice to localStorage under 'tw-theme'.
 * Defaults to dark unless prefers-color-scheme: light.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  // Sync initial state from DOM (set by inline script in layout.tsx)
  useEffect(() => {
    const current =
      (document.documentElement.getAttribute('data-theme') as Theme) || 'dark';
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg',
        'border border-border/70 bg-surface-2/50 text-muted',
        'hover:text-fg hover:border-accent/40 transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
      )}
    >
      {theme === 'dark' ? (
        <Sun className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}
