import { cn } from "@/utils/classNames";

export interface MetricStatProps {
  label: string;
  value: string;
  /** Optional 1-line context below the value. */
  sub?: string;
  tone?: "default" | "profit" | "loss" | "ai" | "warning";
}

const toneStyles: Record<NonNullable<MetricStatProps["tone"]>, string> = {
  default: "text-fg",
  profit: "text-yes",
  loss: "text-no",
  ai: "text-ai",
  warning: "text-warning",
};

export function MetricStat({
  label,
  value,
  sub,
  tone = "default",
}: MetricStatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted font-medium">{label}</span>
      <span className={cn("text-lg font-semibold font-mono", toneStyles[tone])}>
        {value}
      </span>
      {sub && <span className="text-xs text-muted truncate">{sub}</span>}
    </div>
  );
}
