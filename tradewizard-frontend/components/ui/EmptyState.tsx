import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/utils/classNames";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional action slot, e.g. a CTA button or link. */
  action?: ReactNode;
  className?: string;
}

/** Centered placeholder for empty lists/panels. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className
      )}
    >
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
