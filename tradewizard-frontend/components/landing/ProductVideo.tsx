"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";

interface ProductVideoProps {
  base: string;
  url: string;
  ariaLabel: string;
  posterAlt: string;
  caption: string;
  meta: string;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MOBILE_QUERY = "(max-width: 767px)";
const THEME_ATTRIBUTE = "data-theme";

function subscribeToReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );
}

function subscribeToMobile(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileServerSnapshot() {
  return false;
}

function useIsMobile() {
  return useSyncExternalStore(
    subscribeToMobile,
    getMobileSnapshot,
    getMobileServerSnapshot
  );
}

function subscribeToTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot() {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === "light"
    ? "light"
    : "dark";
}

function getThemeServerSnapshot() {
  return "dark";
}

function useActiveTheme() {
  return useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );
}

export function ProductVideo({
  base,
  url,
  ariaLabel,
  posterAlt,
  caption,
  meta,
}: ProductVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const theme = useActiveTheme();
  const [playing, setPlaying] = useState(true);

  const suffix = `${isMobile ? "-mobile" : ""}${theme === "light" ? "-light" : ""}`;
  const activeSrc = `/videos/${base}${suffix}.mp4`;
  const activePoster = `/videos/${base}${suffix}-poster.jpg`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (reducedMotion) {
      video.pause();
      return;
    }

    video.play().catch(() => {});
  }, [reducedMotion, activeSrc]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  return (
    <figure className="group relative">
      <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-lg)] md:rounded-2xl">
        <div className="hidden items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 md:flex md:px-4 md:py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(65%_0.18_25)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(78%_0.14_85)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(72%_0.16_155)]" />
          </div>
          <div className="flex flex-1 justify-center">
            <div className="w-full max-w-[320px] truncate rounded border border-border bg-bg px-3 py-1 text-center font-mono text-[0.62rem] text-muted">
              {url}
            </div>
          </div>
          <span className="hidden items-center gap-1.5 font-mono text-[0.6rem] text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yes" />
            demo
          </span>
          <span className="w-[18px] sm:w-[52px]" aria-hidden="true" />
        </div>

        <div className="relative aspect-[4/5] bg-bg md:aspect-[16/10]">
          {reducedMotion ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={activePoster}
              src={activePoster}
              alt={posterAlt}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <video
              key={activeSrc}
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              poster={activePoster}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={ariaLabel}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            >
              <source src={activeSrc} type="video/mp4" />
            </video>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-bg/75 via-bg/10 to-transparent" />

          {!reducedMotion && (
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={playing ? "Pause the product demo" : "Play the product demo"}
              className="absolute bottom-3 right-3 z-10 hidden h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-bg/70 text-fg backdrop-blur transition-[opacity,background-color] hover:bg-bg/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            >
              {playing ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      <figcaption className="mt-3 flex flex-col gap-2 px-0.5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>{caption}</span>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="font-mono text-[0.68rem] text-muted/80">{meta}</span>
          {!reducedMotion && (
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={playing ? "Pause the product demo" : "Play the product demo"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
            >
              {playing ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
