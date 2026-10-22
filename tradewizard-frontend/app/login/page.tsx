"use client";

import { AuthShell } from "@/components/shell/AuthShell";
import { useAuthContext } from "@/providers/AuthProvider";
import getMagic from "@/lib/magic";
import {
  LoginWithEmailOTPEventOnReceived,
  LoginWithEmailOTPEventEmit,
} from "magic-sdk";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

/** Protected route prefixes that are valid targets for the ?next param. */
const PROTECTED_PREFIXES = [
  "/markets",
  "/insights",
  "/portfolio",
  "/portfolio-manager",
  "/account",
];

function isValidNextPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  return PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

/**
 * Sync Magic auth to Cognito by calling the backend magic-sync endpoint.
 * Returns true if tokens were successfully stored.
 */
async function syncMagicToCognito(email: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const response = await fetch(`${baseUrl}/auth/magic-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    console.error("Magic-Cognito sync failed:", response.status);
    return false;
  }

  const tokens = await response.json();

  if (typeof window !== "undefined" && tokens.idToken) {
    localStorage.setItem("tw_id_token", tokens.idToken);
    localStorage.setItem("tw_access_token", tokens.accessToken);
    localStorage.setItem("tw_refresh_token", tokens.refreshToken);
    localStorage.setItem(
      "tw_expires_at",
      String(Date.now() + (tokens.expiresIn ?? 3600) * 1000)
    );
    return true;
  }

  return false;
}

function LoginContent() {
  const { isAuthenticated, isLoading: authLoading, refreshFromStorage } =
    useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendConfirm, setResendConfirm] = useState(false);

  // Keep a ref to the Magic login handle so we can emit events to it
  const handleRef = useRef<any>(null);

  const navigateAfterAuth = useCallback(() => {
    const next = searchParams.get("next");
    if (next && isValidNextPath(next)) {
      router.replace(next);
    } else {
      router.replace("/markets");
    }
  }, [searchParams, router]);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigateAfterAuth();
    }
  }, [authLoading, isAuthenticated, navigateAfterAuth]);

  /**
   * Step 1: User submits email → Magic sends OTP email.
   * We use showUI: false so Magic doesn't show its own modal.
   */
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const magic = getMagic();

      const handle = magic.auth.loginWithEmailOTP({
        email,
        showUI: false,
        deviceCheckUI: false,
      });

      handleRef.current = handle;

      handle
        .on(LoginWithEmailOTPEventOnReceived.EmailOTPSent, () => {
          // OTP has been sent - show the code input
          setStep("otp");
          setIsSubmitting(false);
        })
        .on(LoginWithEmailOTPEventOnReceived.InvalidEmailOtp, () => {
          // User entered wrong code
          setError("Invalid code. Please try again.");
          setOtp("");
          setIsSubmitting(false);
        })
        .on("done", async () => {
          // Magic login complete - sync to Cognito
          setIsSubmitting(true);
          const synced = await syncMagicToCognito(email);

          if (synced) {
            refreshFromStorage();
            navigateAfterAuth();
          } else {
            setError(
              "Login succeeded but backend sync failed. Please try again."
            );
          }
          setIsSubmitting(false);
        })
        .on("error", (reason: any) => {
          console.error("Magic login error:", reason);
          setError(
            reason?.message || "Login failed. Please try again."
          );
          setIsSubmitting(false);
          setStep("email");
        });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send code. Please try again."
      );
      setIsSubmitting(false);
    }
  }

  /**
   * Step 2: User submits the OTP code → emit it to Magic for verification.
   */
  function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!handleRef.current) {
      setError("Session expired. Please start over.");
      setStep("email");
      return;
    }

    setIsSubmitting(true);
    handleRef.current.emit(LoginWithEmailOTPEventEmit.VerifyEmailOtp, otp);
  }

  /**
   * Resend: cancel current flow and restart.
   */
  async function handleResend() {
    if (handleRef.current) {
      handleRef.current.emit(LoginWithEmailOTPEventEmit.Cancel);
      handleRef.current = null;
    }
    setOtp("");
    setError(null);
    setResendConfirm(true);
    setTimeout(() => setResendConfirm(false), 3000);

    // Restart the flow
    setStep("email");
    // Simulate form submit
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    await handleSendCode(fakeEvent);
  }

  // Show nothing while checking auth state
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  // Already authenticated - will redirect via useEffect
  if (isAuthenticated) {
    return null;
  }

  return (
    <AuthShell>
      {step === "email" && (
        <>
          <h2 className="font-display text-lg font-bold mb-1">
            Sign in to TradeWizard
          </h2>
          <p className="text-xs text-muted mb-6">
            No password needed - we&apos;ll send you a verification code
          </p>

          {error && (
            <div className="rounded-lg bg-no/10 border border-no/20 px-4 py-3 text-sm text-no mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSendCode}>
            <div className="mb-5">
              <label
                htmlFor="email"
                className="block text-xs text-muted font-medium mb-1.5"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-sm text-fg placeholder:text-muted outline-none focus:border-ai transition-colors"
                disabled={isSubmitting}
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !email}
              className="w-full py-3 rounded-lg text-sm font-semibold bg-ai text-bg hover:opacity-85 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending code...</span>
                </>
              ) : (
                "Send Verification Code"
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 mb-4">
            <span className="flex-1 h-px bg-border" />
            <span className="text-[0.7rem] text-muted">or</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <p className="text-center text-xs text-muted">
            New here? Enter your email above - we&apos;ll create your account
            automatically with{" "}
            <strong className="text-fg">20 free credits</strong>
          </p>
        </>
      )}

      {step === "otp" && (
        <>
          <div className="text-center mb-6">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-ai/30 bg-ai/10 text-ai">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold mb-1.5">
              Check your inbox
            </h3>
            <p className="text-xs text-muted leading-relaxed">
              We sent a code to{" "}
              <span className="font-mono text-fg">{email}</span>
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-no/10 border border-no/20 px-4 py-3 text-sm text-no mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleVerifyCode}>
            <div className="mb-5">
              <label
                htmlFor="otp"
                className="block text-xs text-muted font-medium mb-1.5"
              >
                Verification code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit code"
                className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-sm text-fg placeholder:text-muted outline-none focus:border-ai transition-colors tracking-widest text-center font-mono"
                disabled={isSubmitting}
                autoFocus
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !otp}
              className="w-full py-3 rounded-lg text-sm font-semibold bg-ai text-bg hover:opacity-85 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                "Verify & Sign In"
              )}
            </button>
          </form>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (handleRef.current) {
                  handleRef.current.emit(LoginWithEmailOTPEventEmit.Cancel);
                  handleRef.current = null;
                }
                setStep("email");
                setOtp("");
                setError(null);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Change email
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={isSubmitting || resendConfirm}
              className="text-xs text-muted hover:text-fg transition-colors disabled:opacity-50"
            >
              {resendConfirm ? "Sent!" : "Resend code"}
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
