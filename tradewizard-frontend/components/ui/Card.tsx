import { type ReactNode } from "react";
import { cn } from "@/utils/classNames";

export interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "elevated" | "ai";
  asChild?: boolean;
}

const variantStyles: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "bg-surface border border-border",
  elevated: "bg-surface border border-border shadow-lg",
  ai: "bg-gradient-to-br from-ai/10 to-surface border border-ai/30",
};

export function Card({
  children,
  className,
  variant = "default",
  asChild = false,
}: CardProps) {
  const classes = cn("rounded-[12px]", variantStyles[variant], className);

  if (asChild) {
    return <>{children}</>;
  }

  return <div className={classes}>{children}</div>;
}
