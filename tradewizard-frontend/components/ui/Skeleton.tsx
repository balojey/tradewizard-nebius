import { cn } from "@/utils/classNames";

export interface SkeletonProps {
  className?: string;
}

/** Pulsing placeholder block for loading states. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
    />
  );
}
