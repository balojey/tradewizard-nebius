"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/utils/classNames";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export interface MarketingShellProps {
  children: ReactNode;
}

export function MarketingShell({ children }: MarketingShellProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:border focus:border-accent focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-[var(--shadow-md)]"
      >
        Skip to content
      </a>
      {/* Transparent nav that blurs on scroll */}
      <nav
        className={cn(
          "sticky top-0 z-50 border-b pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition-all duration-200",
          scrolled
            ? "border-border bg-bg md:bg-[var(--nav-bg)] md:backdrop-blur-[12px]"
            : "border-transparent bg-transparent"
        )}
      >
        <div className="w-full flex items-center justify-between h-[60px] px-4 sm:px-6">
          <Link
            href="/"
            className="font-display font-bold text-xl flex items-center gap-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/20">
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

          <div className="hidden md:flex gap-8 text-sm text-muted">
            <a href="#how" className="hover:text-fg transition-colors">
              How It Works
            </a>
            <a href="#features" className="hover:text-fg transition-colors">
              Features
            </a>
            <a href="#pricing" className="hover:text-fg transition-colors">
              Pricing
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden sm:inline-flex text-sm font-medium text-muted px-3 py-2 rounded-lg hover:text-fg hover:bg-surface-2 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="bg-gradient-to-b from-accent to-[oklch(55%_0.20_270)] text-white font-semibold text-sm px-4 sm:px-5 py-2 rounded-lg shadow-[0_4px_14px_-4px_oklch(62%_0.20_260_/_0.55)] hover:brightness-110 transition-[filter]"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero / main content area */}
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-surface/40">
        <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4 py-8 px-4 sm:px-6 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 ring-1 ring-accent/20">
              <Image
                src="/favicon.svg"
                alt=""
                width={16}
                height={16}
                className="h-4 w-4"
              />
            </span>
            <span>© {new Date().getFullYear()} TradeWizard</span>
          </div>
          <div className="flex gap-6">
            <Link href="#" className="hover:text-fg transition-colors">
              Terms
            </Link>
            <Link href="#" className="hover:text-fg transition-colors">
              Privacy
            </Link>
            <Link href="#" className="hover:text-fg transition-colors">
              Docs
            </Link>
            <Link href="#" className="hover:text-fg transition-colors">
              Twitter
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
