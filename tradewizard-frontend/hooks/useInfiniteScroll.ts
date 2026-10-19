import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

interface UseInfiniteScrollOptions {
  threshold?: number; // Distance from bottom to trigger load (0-1)
  rootMargin?: string; // Intersection observer root margin
  delay?: number; // Debounce delay in ms
}

export default function useInfiniteScroll(
  callback: () => void,
  options: UseInfiniteScrollOptions = {}
) {
  const { threshold = 0.1, rootMargin = "200px", delay = 100 } = options;
  const [isFetching, setIsFetching] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallRef = useRef<number>(0);

  // Debounced callback to prevent rapid-fire calls on mobile
  const debouncedCallback = useCallback(() => {
    const now = Date.now();
    
    // Prevent calls within delay period
    if (now - lastCallRef.current < delay) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (!isFetching) {
        setIsFetching(true);
        lastCallRef.current = Date.now();
        callback();
      }
    }, delay);
  }, [callback, isFetching, delay]);

  // Use battle-tested intersection observer hook
  const { ref: targetRef, inView } = useInView({
    threshold,
    rootMargin,
    triggerOnce: false,
    onChange: (inView) => {
      if (inView && !isFetching) {
        debouncedCallback();
      }
    },
  });

  const resetFetching = useCallback(() => {
    setIsFetching(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    targetRef,
    isFetching,
    resetFetching,
    inView,
  };
}