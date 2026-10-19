import type { Plan } from '@/constants/plans';

export interface NavItem {
  label: string;
  href: string;
  /** Minimum plan required to see this link. Hidden entirely for users below this tier. */
  requires?: Plan;
}

export const APP_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Markets', href: '/markets' },
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'PM', href: '/portfolio-manager' },
  { label: 'Insights', href: '/insights' },
] as const;
