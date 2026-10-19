"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/classNames";

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  /** On mobile: bottom sheet that hugs content. On desktop: centered dialog. */
  mobileSheet?: boolean;
}

const sizeClasses: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const sheetSizeClasses: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  mobileSheet = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = title ? "modal-title" : undefined;

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => {
        if (contentRef.current) {
          const focusable =
            contentRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          if (focusable) focusable.focus();
          else contentRef.current.focus();
        }
      }, 0);
      return () => clearTimeout(timer);
    } else {
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !contentRef.current) return;
    const els =
      contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!mounted || !open) return null;

  // ─── Standard centered dialog (no mobileSheet) ────────────────────
  if (!mobileSheet) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="presentation"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={contentRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={cn(
            "relative z-10 w-full rounded-[var(--radius)] border border-border bg-surface p-6 shadow-lg mx-4 focus:outline-none",
            sizeClasses[size]
          )}
        >
          {title && (
            <h2 id={titleId} className="mb-4 text-lg font-semibold text-fg">
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>,
      document.body
    );
  }

  // ─── Mobile bottom sheet / Desktop centered dialog ─────────────────
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / Dialog */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative z-10 w-full bg-surface shadow-lg focus:outline-none",
          // Mobile: bottom-anchored, rounded top, content-hugging, full width
          "rounded-t-[16px] border-t border-x border-border",
          // Desktop: centered card with max-width
          "sm:rounded-[var(--radius)] sm:border sm:mx-4",
          sheetSizeClasses[size]
        )}
      >
        {/* Drag indicator - mobile only */}
        <div className="flex justify-center pt-3 pb-2 sm:hidden" aria-hidden="true">
          <div className="w-9 h-1 rounded-full bg-muted/40" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
          {title ? (
            <h2
              id={titleId}
              className="text-base font-semibold text-fg sm:text-lg"
            >
              {title}
            </h2>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-muted hover:text-fg hover:bg-surface-2 transition-colors"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
