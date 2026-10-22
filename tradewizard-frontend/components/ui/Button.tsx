import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/utils/classNames";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ai" | "yes" | "no" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-gradient-to-b from-accent to-[oklch(55%_0.20_270)] text-white shadow-[0_1px_0_oklch(100%_0_0_/_0.15)_inset,0_4px_14px_-4px_oklch(62%_0.20_260_/_0.55)] hover:brightness-110 active:brightness-95",
  secondary:
    "bg-surface-2 text-fg border border-border shadow-[var(--shadow-sm)] hover:border-border-strong hover:bg-surface-elevated active:bg-surface-2",
  ai: "bg-gradient-to-b from-ai to-[oklch(52%_0.18_300)] text-white shadow-[0_1px_0_oklch(100%_0_0_/_0.15)_inset,0_4px_14px_-4px_oklch(62%_0.18_295_/_0.5)] hover:brightness-110 active:brightness-95",
  yes: "bg-yes text-white hover:brightness-110 active:brightness-95",
  no: "bg-no text-white hover:brightness-110 active:brightness-95",
  ghost:
    "bg-transparent text-fg hover:bg-surface-2 active:bg-surface-elevated",
  danger:
    "bg-no/15 text-no border border-no/30 hover:bg-no/25 active:bg-no/35",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-xs rounded-md",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-6 py-3 text-base rounded-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,filter,box-shadow,transform] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
        // Ensure 44px min tap target on small mobile (<430px)
        "max-[430px]:min-h-[44px]",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
