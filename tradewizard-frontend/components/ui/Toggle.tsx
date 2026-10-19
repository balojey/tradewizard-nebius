"use client";

import { type ReactNode } from "react";
import { cn } from "@/utils/classNames";

export interface ToggleProps {
  checked: boolean;
  onChange(next: boolean): void;
  label?: string;
  description?: string;
  disabled?: boolean;
  children?: ReactNode;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  children,
}: ToggleProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          checked ? "bg-accent" : "bg-surface-2",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-fg shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </button>
      {(label || description || children) && (
        <div className="flex flex-col gap-0.5">
          {label && (
            <span
              className={cn(
                "text-sm font-medium text-fg",
                disabled && "opacity-50"
              )}
            >
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-muted">{description}</span>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
