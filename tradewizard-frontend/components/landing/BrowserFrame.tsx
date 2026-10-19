"use client";

interface BrowserFrameProps {
  src: string;
  title: string;
  height?: number;
  priority?: boolean;
}

/**
 * Renders an iframe inside a macOS-style browser chrome frame.
 * Used on the landing page to display design mockups as "screenshots".
 */
export function BrowserFrame({
  src,
  title,
  height = 600,
  priority = false,
}: BrowserFrameProps) {
  return (
    <div
      className="rounded-xl sm:rounded-[16px] border border-border overflow-hidden bg-surface shadow-2xl"
      role="img"
      aria-label={title}
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2.5 bg-surface-2 border-b border-border">
        {/* Traffic lights */}
        <div className="flex gap-1 sm:gap-1.5">
          <span className="w-[7px] h-[7px] sm:w-[10px] sm:h-[10px] rounded-full bg-[oklch(65%_0.18_25)]" />
          <span className="w-[7px] h-[7px] sm:w-[10px] sm:h-[10px] rounded-full bg-[oklch(78%_0.14_85)]" />
          <span className="w-[7px] h-[7px] sm:w-[10px] sm:h-[10px] rounded-full bg-[oklch(72%_0.16_155)]" />
        </div>

        {/* URL bar */}
        <div className="flex-1 flex justify-center">
          <div className="bg-bg border border-border rounded px-2 sm:px-3 py-0.5 sm:py-1 text-[0.5rem] sm:text-[0.65rem] text-muted font-mono max-w-[160px] sm:max-w-[300px] w-full text-center truncate">
            tradewizard.live
          </div>
        </div>

        {/* Spacer for symmetry */}
        <div className="w-6 sm:w-[52px]" />
      </div>

      {/* Iframe content */}
      <div className="overflow-hidden relative h-[500px] sm:h-[600px] lg:h-[var(--frame-h)]" style={{ "--frame-h": `${height}px` } as React.CSSProperties}>
        <iframe
          src={src}
          title={title}
          className="w-full border-0 scrollbar-none"
          loading={priority ? "eager" : "lazy"}
          tabIndex={-1}
          aria-hidden="true"
          sandbox="allow-same-origin allow-scripts"
          scrolling="no"
          style={{
            height: "200%",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        />
        {/* Invisible overlay to block all interaction including scroll */}
        <div className="absolute inset-0 z-10" />
        {/* Fade-out gradient at the bottom */}
        <div className="absolute inset-x-0 bottom-0 h-12 sm:h-20 bg-gradient-to-t from-surface to-transparent pointer-events-none z-20" />
      </div>
    </div>
  );
}
