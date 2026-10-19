"use client";

import { type ReactNode } from "react";
import Link from "next/link";

export interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        {/* Logo + tagline */}
        <Link
          href="/"
          className="flex items-center justify-center gap-2 font-display font-bold text-2xl mb-2"
        >
          <span className="w-2 h-2 rounded-full bg-ai shadow-[0_0_8px_var(--ai)]" />
          TradeWizard
        </Link>
        <p className="text-center text-xs text-muted mb-10">
          AI-powered intelligence for prediction markets
        </p>

        {/* Auth card */}
        <div className="bg-surface border border-border rounded-[16px] p-8">
          {children}
        </div>

        {/* Footer note */}
        <p className="text-center text-[0.7rem] text-muted mt-6 leading-relaxed">
          By continuing, you agree to our Terms of Service and Privacy Policy.
          <br />
          No password is stored - authentication is via secure magic link only.
        </p>
      </div>
    </div>
  );
}
