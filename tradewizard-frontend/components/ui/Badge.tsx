import { type ReactNode } from "react";
import { cn } from "@/utils/classNames";

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "accent" | "ai" | "yes" | "no" | "warning" | "muted";
  size?: "sm" | "md";
  className?: string;
}

const toneStyles: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-surface-2 text-fg border border-border",
  accent: "bg-accent/15 text-accent border border-accent/30",
  ai: "bg-ai/15 text-ai border border-ai/30",
  yes: "bg-yes/15 text-yes border border-yes/30",
  no: "bg-no/15 text-no border border-no/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  muted: "bg-surface-2 text-muted border border-border",
};

const sizeStyles: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-xs",
};

export function Badge({
  children,
  tone = "neutral",
  size = "md",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-md whitespace-nowrap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        toneStyles[tone],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  );
}
