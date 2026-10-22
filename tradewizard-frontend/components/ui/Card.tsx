import { type ReactNode } from "react";
import { cn } from "@/utils/classNames";

export interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "elevated" | "ai";
  /** Adds hover elevation for cards that act as links or contain actions. */
  interactive?: boolean;
  asChild?: boolean;
}

const variantStyles: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "bg-surface border border-border",
  elevated: "bg-surface border border-border shadow-[var(--shadow-md)]",
  ai: "bg-gradient-to-br from-ai/10 via-surface to-surface border border-ai/30",
};

export function Card({
  children,
  className,
  variant = "default",
  interactive = false,
  asChild = false,
}: CardProps) {
  const classes = cn(
    "rounded-[12px]",
    variantStyles[variant],
    interactive &&
      "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]",
    className
  );

  if (asChild) {
    return <>{children}</>;
  }

  return <div className={classes}>{children}</div>;
}
