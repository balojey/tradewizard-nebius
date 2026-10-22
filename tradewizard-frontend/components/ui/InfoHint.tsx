"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/utils/classNames";

export interface InfoHintProps {
  children: ReactNode;
  label?: string;
  className?: string;
}

/**
 * Small ⓘ affordance that reveals a plain-language explanation on hover
 * (desktop) or tap (mobile). Safe to use inside a <summary> element.
 */
export function InfoHint({ children, label = "More information", className }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          // Prevent the surrounding <summary> from toggling.
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent/40 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-2.5 w-2.5" aria-hidden="true" />
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal leading-relaxed text-muted shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
