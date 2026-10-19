import { type ReactNode } from "react";
import { cn } from "@/utils/classNames";

export interface ExpandableProps {
  summary: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Expandable({
  summary,
  meta,
  defaultOpen = false,
  children,
}: ExpandableProps) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group rounded-[12px] border border-border bg-surface"
    >
      <summary
        className={cn(
          "flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-fg",
          "list-none [&::-webkit-details-marker]:hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "rounded-[12px]"
        )}
      >
        <span className="flex items-center gap-2">
          <svg
            className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          {summary}
        </span>
        {meta && <span className="text-xs text-muted">{meta}</span>}
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}
