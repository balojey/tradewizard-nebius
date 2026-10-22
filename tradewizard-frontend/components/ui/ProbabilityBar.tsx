import { cn } from "@/utils/classNames";

export interface ProbabilityBarProps {
  /** Value in cents 0–100 (display unit on Polymarket). */
  cents: number;
  /** Optional second marker for AI consensus probability. */
  aiCents?: number;
  variant?: "thin" | "thick";
  className?: string;
}

const heightStyles: Record<NonNullable<ProbabilityBarProps["variant"]>, string> = {
  thin: "h-[4px]",
  thick: "h-[6px]",
};

export function ProbabilityBar({
  cents,
  aiCents,
  variant = "thin",
  className,
}: ProbabilityBarProps) {
  const clampedCents = Math.max(0, Math.min(100, cents));
  const clampedAiCents =
    aiCents != null ? Math.max(0, Math.min(100, aiCents)) : undefined;

  return (
    <div
      className={cn(
        "relative w-full rounded-full bg-surface-2 ring-1 ring-inset ring-border/70 overflow-hidden",
        heightStyles[variant],
        className
      )}
      role="meter"
      aria-valuenow={clampedCents}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Probability ${clampedCents}%`}
    >
      {/* Fill bar */}
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-[oklch(62%_0.20_290)] transition-[width] duration-300 ease-out"
        style={{ width: `${clampedCents}%` }}
      />

      {/* AI marker */}
      {clampedAiCents != null && (
        <div
          className="absolute top-0 bottom-0 w-[2px] rounded-full bg-ai shadow-[0_0_6px_oklch(62%_0.18_295_/_0.8)]"
          style={{ left: `${clampedAiCents}%` }}
          aria-label={`AI probability ${clampedAiCents}%`}
        />
      )}
    </div>
  );
}
