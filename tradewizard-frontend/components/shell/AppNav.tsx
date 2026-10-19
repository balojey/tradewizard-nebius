'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Menu,
  X,
  TrendingUp,
  Briefcase,
  Bot,
  Lightbulb,
  Settings,
  CreditCard,
  LogOut,
  ChevronRight,
  Wallet,
} from 'lucide-react';
import { APP_NAV_ITEMS } from '@/constants/navigation';
import { TierGate } from '@/components/ui/TierGate';
import { cn } from '@/utils/classNames';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';

import { CreditBadge } from '@/components/shell/CreditBadge';
import { WalletBadge } from '@/components/shell/WalletBadge';
import { ThemeToggle } from '@/components/shell/ThemeToggle';

const PROFILE_IMAGE_URL =
  'https://static-assets.artlogic.net/w_1200,c_limit,f_auto,fl_lossy,q_auto/ws-artlogicwebsite0889/usr/images/news/main_image/6/nft-bored-ape-yacht-club.png';

/** Map nav item labels to icons for the mobile menu */
const NAV_ICONS: Record<string, typeof TrendingUp> = {
  Markets: TrendingUp,
  Portfolio: Briefcase,
  PM: Bot,
  Insights: Lightbulb,
};

/** Descriptive subtitles for mobile nav items */
const NAV_DESCRIPTIONS: Record<string, string> = {
  Markets: 'Browse & trade prediction markets',
  Portfolio: 'Positions, history & performance',
  PM: 'Autonomous AI trading agent',
  Insights: 'AI analysis & intelligence',
};

/** Plan display names */
const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  elite: 'Elite',
};

/** Plan badge colors */
const PLAN_BADGE_STYLES: Record<string, string> = {
  free: 'bg-surface-2 text-muted border-border',
  starter: 'bg-accent/10 text-accent border-accent/30',
  pro: 'bg-ai/10 text-ai border-ai/30',
  elite: 'bg-warning/10 text-warning border-warning/30',
};

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { plan } = useCurrentPlan();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileOpen]);

  const handleSignOut = useCallback(() => {
    setMobileOpen(false);
    signOut();
    router.push('/login');
  }, [signOut, router]);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 w-full border-b border-border bg-[var(--nav-bg)] pt-[env(safe-area-inset-top)] backdrop-blur-md"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
        {/* Brand mark */}
        <Link
          href="/markets"
          className="flex shrink-0 items-center gap-2 text-fg font-semibold text-lg select-none"
        >
          <Image
            src="/favicon.svg"
            alt="TradeWizard logo"
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span>TradeWizard</span>
        </Link>

        {/* Desktop nav links - visible from lg (1024px) */}
        <ul className="hidden lg:flex items-center gap-1">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            const linkEl = (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                    isActive
                      ? 'text-fg font-semibold'
                      : 'text-muted hover:text-fg'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );

            if (item.requires) {
              return (
                <TierGate
                  key={item.label}
                  plan={item.requires}
                  feature={item.label}
                  showLocked={false}
                >
                  {linkEl}
                </TierGate>
              );
            }

            return linkEl;
          })}
        </ul>

        {/* Tablet nav links - compact, visible at md only (768-1023px) */}
        <ul className="hidden md:flex lg:hidden items-center gap-0.5">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            const linkEl = (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    'px-2 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors',
                    isActive
                      ? 'text-fg font-semibold'
                      : 'text-muted hover:text-fg'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );

            if (item.requires) {
              return (
                <TierGate
                  key={item.label}
                  plan={item.requires}
                  feature={item.label}
                  showLocked={false}
                >
                  {linkEl}
                </TierGate>
              );
            }

            return linkEl;
          })}
        </ul>

        {/* Right cluster - desktop (lg+) */}
        <div className="hidden lg:flex items-center gap-3">
          <WalletBadge />
          <CreditBadge />
          <ThemeToggle />
          <Link href="/account" aria-label="Settings">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="User avatar"
              width={32}
              height={32}
              className="h-8 w-8 rounded-full border border-border object-cover"
            />
          </Link>
        </div>

        {/* Right cluster - tablet (md to lg): condensed, hide wallet badge */}
        <div className="hidden md:flex lg:hidden items-center gap-2">
          <CreditBadge />
          <ThemeToggle />
          <Link href="/account" aria-label="Settings">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="User avatar"
              width={28}
              height={28}
              className="h-7 w-7 rounded-full border border-border object-cover"
            />
          </Link>
        </div>

        {/* Mobile hamburger - visible below md (< 768px) */}
        <div className="flex md:hidden items-center gap-2">
          <CreditBadge />
          <button
            className={cn(
              'relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200',
              mobileOpen
                ? 'bg-accent/10 text-accent'
                : 'text-muted hover:text-fg hover:bg-surface'
            )}
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            <span
              className={cn(
                'transition-transform duration-200',
                mobileOpen && 'rotate-90'
              )}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile full-screen menu */}
      {mobileOpen && (
        <>
          {/* Backdrop overlay */}
          <div
            className="md:hidden fixed inset-0 top-14 z-30 bg-black/50 backdrop-blur-sm transition-opacity duration-200"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Menu panel */}
          <div
            ref={menuRef}
            id="mobile-nav-menu"
            role="menu"
            className="md:hidden fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-0 right-0 z-40 bg-bg border-b border-border max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] overflow-y-auto overscroll-contain animate-in slide-in-from-top-2 duration-200"
          >
            <div className="flex flex-col safe-left safe-right">
              {/* ─── User identity section ─── */}
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Image
                    src={PROFILE_IMAGE_URL}
                    alt="User avatar"
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full border-2 border-accent/30 object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">
                      {user?.email ?? 'Trader'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide border',
                          PLAN_BADGE_STYLES[plan] ?? PLAN_BADGE_STYLES.free
                        )}
                      >
                        {PLAN_LABELS[plan] ?? 'Free'}
                      </span>
                    </div>
                  </div>
                  <ThemeToggle />
                </div>
              </div>

              {/* ─── Wallet & credits row ─── */}
              <div className="px-5 pb-4">
                <div className="rounded-xl bg-surface border border-border p-3 *:w-full *:*:w-full *:*:justify-center *:*:rounded-lg *:*:py-2.5 *:*:text-sm">
                  <WalletBadge />
                </div>
              </div>

              {/* ─── Navigation section ─── */}
              <div className="px-3 pb-2">
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Navigate
                </p>
                <ul className="flex flex-col gap-0.5" role="none">
                  {APP_NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    const Icon = NAV_ICONS[item.label] ?? TrendingUp;
                    const description = NAV_DESCRIPTIONS[item.label];

                    const linkEl = (
                      <li key={item.label} role="none">
                        <Link
                          href={item.href}
                          role="menuitem"
                          className={cn(
                            'flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150',
                            isActive
                              ? 'bg-accent/8 text-fg'
                              : 'text-muted hover:text-fg hover:bg-surface active:bg-surface-2'
                          )}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <span
                            className={cn(
                              'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
                              isActive
                                ? 'bg-accent/15 text-accent'
                                : 'bg-surface-2 text-muted'
                            )}
                          >
                            <Icon size={18} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p
                              className={cn(
                                'text-sm leading-tight',
                                isActive ? 'font-semibold text-fg' : 'font-medium'
                              )}
                            >
                              {item.label}
                            </p>
                            {description && (
                              <p className="text-xs text-muted mt-0.5 truncate">
                                {description}
                              </p>
                            )}
                          </div>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                          )}
                        </Link>
                      </li>
                    );

                    if (item.requires) {
                      return (
                        <TierGate
                          key={item.label}
                          plan={item.requires}
                          feature={item.label}
                          showLocked={false}
                        >
                          {linkEl}
                        </TierGate>
                      );
                    }

                    return linkEl;
                  })}
                </ul>
              </div>

              {/* ─── Account section ─── */}
              <div className="px-3 pt-2 pb-2 border-t border-border mx-3">
                <p className="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Account
                </p>
                <ul className="flex flex-col gap-0.5" role="none">
                  <li role="none">
                    <Link
                      href="/account"
                      role="menuitem"
                      className="flex items-center gap-3 px-3 py-3 rounded-xl text-muted hover:text-fg hover:bg-surface active:bg-surface-2 transition-all duration-150"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-2 text-muted shrink-0">
                        <Settings size={18} />
                      </span>
                      <span className="text-sm font-medium flex-1">Settings</span>
                      <ChevronRight size={16} className="text-muted/50" />
                    </Link>
                  </li>
                  <li role="none">
                    <Link
                      href="/account/subscription"
                      role="menuitem"
                      className="flex items-center gap-3 px-3 py-3 rounded-xl text-muted hover:text-fg hover:bg-surface active:bg-surface-2 transition-all duration-150"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-2 text-muted shrink-0">
                        <CreditCard size={18} />
                      </span>
                      <span className="text-sm font-medium flex-1">Subscription & Credits</span>
                      <ChevronRight size={16} className="text-muted/50" />
                    </Link>
                  </li>
                </ul>
              </div>

              {/* ─── Sign out ─── */}
              <div className="px-3 pt-2 pb-5 border-t border-border mx-3">
                <button
                  onClick={handleSignOut}
                  role="menuitem"
                  className="flex items-center gap-3 w-full px-3 py-3 mt-2 rounded-xl text-no/80 hover:text-no hover:bg-no/5 active:bg-no/10 transition-all duration-150"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-no/8 text-no/70 shrink-0">
                    <LogOut size={18} />
                  </span>
                  <span className="text-sm font-medium">Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
