'use client';

import { useRouter } from 'next/navigation';

export interface LockOverlayProps {
  feature: string;
  upgradeHref?: string;
}

export function LockOverlay({
  feature,
  upgradeHref = '/account/subscription',
}: LockOverlayProps) {
  const router = useRouter();

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-[12px] bg-bg/60 backdrop-blur-sm">
      {/* Lock icon */}
      <svg
        className="h-4 w-4 text-muted"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      </svg>

      <span className="text-sm font-medium text-muted">{feature}</span>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          router.push(upgradeHref);
        }}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Upgrade
      </button>
    </div>
  );
}
