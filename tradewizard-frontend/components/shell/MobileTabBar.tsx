'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Briefcase, Lightbulb, TrendingUp } from 'lucide-react';
import { APP_NAV_ITEMS } from '@/constants/navigation';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { cn } from '@/utils/classNames';

const TAB_ICONS: Record<string, typeof TrendingUp> = {
  Markets: TrendingUp,
  Portfolio: Briefcase,
  PM: Bot,
  Insights: Lightbulb,
};

export interface MobileTabBarProps {
  /** Hide the bar (e.g. while the full-screen mobile menu is open). */
  hidden?: boolean;
}

export function MobileTabBar({ hidden = false }: MobileTabBarProps) {
  const pathname = usePathname();
  const { has, isLoading } = useCurrentPlan();

  if (hidden) return null;

  const items = APP_NAV_ITEMS.filter(
    (item) => !item.requires || isLoading || has(item.requires)
  );

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[var(--nav-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = TAB_ICONS[item.label] ?? TrendingUp;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <li key={item.label} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 pb-2 pt-2 text-[0.65rem] font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-muted hover:text-fg'
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                    isActive && 'bg-accent/10'
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
