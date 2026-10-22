'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Menu,
  X,
  Settings,
  CreditCard,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { APP_NAV_ITEMS } from '@/constants/navigation';
import { TierGate } from '@/components/ui/TierGate';
import { cn } from '@/utils/classNames';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';

import { CreditBadge } from '@/components/shell/CreditBadge';
import { WalletBadge } from '@/components/shell/WalletBadge';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { MobileTabBar } from '@/components/shell/MobileTabBar';

const PROFILE_IMAGE_URL =
  'https://static-assets.artlogic.net/w_1200,c_limit,f_auto,fl_lossy,q_auto/ws-artlogicwebsite0889/usr/images/news/main_image/6/nft-bored-ape-yacht-club.png';

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
    <>
    <nav
      className="fixed top-0 left-0 right-0 z-50 w-full border-b border-border/70 bg-[var(--nav-bg)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-xl"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
        {/* Brand mark */}
        <Link
          href="/markets"
          className="group flex shrink-0 items-center gap-2 text-fg font-semibold text-lg select-none"
        >
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/20 transition-colors group-hover:bg-accent/15">
            <Image
              src="/favicon.svg"
              alt="TradeWizard logo"
              width={28}
              height={28}
              className="h-6 w-6"
            />
          </span>
          <span className="tracking-tight">
            Trade<span className="text-accent">Wizard</span>
          </span>
        </Link>

        {/* Desktop nav links - visible from lg (1024px) */}
        <ul className="hidden items-center gap-0.5 rounded-xl border border-border/60 bg-surface-2/40 p-0.5 lg:flex">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            const linkEl = (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-[0.8rem] whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-surface text-fg font-semibold shadow-[var(--shadow-sm)]'
                      : 'text-muted hover:bg-surface/60 hover:text-fg'
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
        <ul className="hidden items-center gap-0.5 rounded-xl border border-border/60 bg-surface-2/40 p-0.5 md:flex lg:hidden">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            const linkEl = (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-[0.72rem] whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-surface text-fg font-semibold shadow-[var(--shadow-sm)]'
                      : 'text-muted hover:bg-surface/60 hover:text-fg'
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
        <div className="hidden lg:flex items-center gap-2">
          <WalletBadge />
          <CreditBadge />
          <span className="mx-0.5 h-5 w-px bg-border/70" aria-hidden="true" />
          <ThemeToggle />
          <Link href="/account" aria-label="Settings">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="User avatar"
              width={32}
              height={32}
              className="h-8 w-8 rounded-full object-cover ring-1 ring-border transition-[box-shadow] hover:ring-2 hover:ring-accent/50"
            />
          </Link>
        </div>

        {/* Right cluster - tablet (md to lg): condensed, hide wallet badge */}
        <div className="hidden md:flex lg:hidden items-center gap-2">
          <CreditBadge />
          <span className="mx-0.5 h-5 w-px bg-border/70" aria-hidden="true" />
          <ThemeToggle />
          <Link href="/account" aria-label="Settings">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="User avatar"
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover ring-1 ring-border transition-[box-shadow] hover:ring-2 hover:ring-accent/50"
            />
          </Link>
        </div>

        {/* Mobile hamburger - visible below md (< 768px) */}
        <div className="flex md:hidden items-center gap-1.5">
          <CreditBadge />
          <button
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200',
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
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setMobileOpen(false);
            }}
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

              {/* ─── Account section ─── */}
              <div className="px-3 pt-2 pb-2 border-t border-border mx-3">
                <p className="px-3 pb-2 pt-3 text-xs font-medium text-muted">
                  Account
                </p>
                <ul className="flex flex-col gap-0.5" role="none">
                  <li role="none">
                    <Link
                      href="/account"
                      role="menuitem"
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-muted transition-colors hover:bg-surface-2/60 hover:text-fg active:bg-surface-2"
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
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-muted transition-colors hover:bg-surface-2/60 hover:text-fg active:bg-surface-2"
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
    <MobileTabBar hidden={mobileOpen} />
    </>
  );
}
