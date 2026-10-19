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
      {/* Transparent nav that blurs on scroll */}
      <nav
        className={cn(
          "sticky top-0 z-50 border-b transition-all duration-200",
          scrolled
            ? "bg-[var(--nav-bg)] backdrop-blur-[12px] border-border"
            : "bg-transparent border-transparent"
        )}
      >
        <div className="w-full flex items-center justify-between h-[60px] px-4 sm:px-6">
          <Link
            href="/"
            className="font-display font-bold text-xl flex items-center gap-2"
          >
            <Image
              src="/favicon.svg"
              alt="TradeWizard logo"
              width={28}
              height={28}
              className="h-7 w-7"
            />
            TradeWizard
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

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="bg-accent text-bg font-semibold text-sm px-5 py-2 rounded-lg hover:opacity-85 transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero / main content area */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4 py-8 px-4 sm:px-6 text-xs text-muted">
          <span>© {new Date().getFullYear()} TradeWizard</span>
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
