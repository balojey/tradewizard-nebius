"use client";

import { useRef, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/utils/classNames";

export interface TabsProps<T extends string> {
  tabs: { id: T; label: string; lockReason?: string }[];
  active: T;
  onChange(id: T): void;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: TabsProps<T>) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    }

    if (nextIndex !== null) {
      const tabList = tabListRef.current;
      if (tabList) {
        const buttons = tabList.querySelectorAll<HTMLButtonElement>(
          '[role="tab"]'
        );
        buttons[nextIndex]?.focus();
      }
      onChange(tabs[nextIndex].id);
    }
  };

  return (
    <div>
      <div
        ref={tabListRef}
        role="tablist"
        className="flex gap-1 border-b border-border"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === active;
          const isLocked = !!tab.lockReason;

          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-disabled={isLocked}
              tabIndex={isActive ? 0 : -1}
              onClick={() => !isLocked && onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "relative px-4 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                isActive && "text-fg",
                !isActive && !isLocked && "text-muted hover:text-fg",
                isLocked && "cursor-not-allowed text-muted opacity-50"
              )}
            >
              {tab.label}
              {isLocked && (
                <span className="ml-1.5 inline-flex align-middle" aria-label={tab.lockReason}>
                  <Lock className="h-3 w-3 text-muted" aria-hidden="true" />
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`tabpanel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
        />
      ))}
    </div>
  );
}
