"use client";

import { cn } from "@/utils/classNames";

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange(next: number): void;
  label?: string;
  format?: (v: number) => string;
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  format,
}: SliderProps) {
  const displayValue = format ? format(value) : String(value);
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-2">
      {(label || format) && (
        <div className="flex items-center justify-between">
          {label && (
            <label className="text-sm font-medium text-fg">{label}</label>
          )}
          <span className="text-sm font-mono text-muted">{displayValue}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={displayValue}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-sm"
        )}
        style={{
          background: `linear-gradient(to right, oklch(62% 0.20 260) 0%, oklch(62% 0.20 260) ${percentage}%, var(--surface-2) ${percentage}%, var(--surface-2) 100%)`,
        }}
      />
    </div>
  );
}
